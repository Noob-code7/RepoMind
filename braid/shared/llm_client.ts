/**
 * shared/llm_client.ts — Thin, reusable router: one function per stage.
 * Real API keys (per build decision). Provider is chosen by model prefix:
 *   claude-* → Anthropic SDK, everything else → OpenAI SDK.
 * Tests inject a deterministic mock via setMockHandler (no network).
 */
import Anthropic from '@anthropic-ai/sdk';
import OpenAI from 'openai';
import { apiKeyFor, config } from './config.js';

export type LlmStage = 'plan' | 'review' | 'execute' | 'triage' | 'report';

export interface LlmRequest {
  stage: LlmStage;
  systemPrompt: string;
  userPrompt: string;
  maxTokens?: number;
  temperature?: number;
}

const MODEL_FOR: Record<LlmStage, () => string> = {
  plan: () => config.planModel,
  review: () => config.reviewModel,
  execute: () => config.executeModel,
  triage: () => config.triageModel,
  report: () => config.reportModel,
};

type MockHandler = (req: LlmRequest) => Promise<string> | string;
let mockHandler: MockHandler | null = null;

/** Tests / demos without keys call this to stub all LLM traffic. */
export function setMockHandler(fn: MockHandler | null): void {
  mockHandler = fn;
}
export function hasMockHandler(): boolean {
  return mockHandler !== null;
}

function modelFor(req: LlmRequest): string {
  return MODEL_FOR[req.stage]();
}

function isClaude(model: string): boolean {
  return model.toLowerCase().startsWith('claude');
}

function requireKey(stage: LlmStage): string {
  const key = apiKeyFor(stage);
  if (!key) {
    throw new Error(
      `[llm_client] Missing API key for stage "${stage}". ` +
        `Set ${stage.toUpperCase()}_API_KEY (or OPENAI/ANTHROPIC fallback) in .env. ` +
        `For offline tests use setMockHandler().`,
    );
  }
  return key;
}

let openaiCache: { key: string; client: OpenAI } | null = null;
let anthropicCache: { key: string; client: Anthropic } | null = null;

function openai(key: string): OpenAI {
  if (!openaiCache || openaiCache.key !== key)
    openaiCache = { key, client: new OpenAI({ apiKey: key }) };
  return openaiCache.client;
}

function anthropic(key: string): Anthropic {
  if (!anthropicCache || anthropicCache.key !== key)
    anthropicCache = { key, client: new Anthropic({ apiKey: key }) };
  return anthropicCache.client;
}

/** Raw text completion for a stage. Reusable by all agents. */
export async function complete(req: LlmRequest): Promise<string> {
  if (mockHandler) return mockHandler(req);
  const model = modelFor(req);
  const key = requireKey(req.stage);
  if (isClaude(model)) {
    const res = await anthropic(key).messages.create({
      model,
      max_tokens: req.maxTokens ?? 4096,
      temperature: req.temperature ?? 0.2,
      system: req.systemPrompt,
      messages: [{ role: 'user', content: req.userPrompt }],
    });
    const block = res.content[0];
    if (!block || block.type !== 'text') throw new Error('[llm_client] Empty Anthropic response');
    return block.text;
  }
  const res = await openai(key).chat.completions.create({
    model,
    temperature: req.temperature ?? 0.2,
    max_tokens: req.maxTokens ?? 4096,
    messages: [
      { role: 'system', content: req.systemPrompt },
      { role: 'user', content: req.userPrompt },
    ],
  });
  return res.choices[0]?.message?.content ?? '';
}

/** Strip code fences and parse JSON. Retries once with a repair nudge. */
export async function completeJson<T>(req: LlmRequest): Promise<T> {
  const raw = await complete(req);
  try {
    return parseJson<T>(raw);
  } catch {
    const repaired = await complete({
      ...req,
      userPrompt:
        req.userPrompt +
        '\n\nYour previous reply was not valid JSON. Reply with ONLY the JSON object, no fences, no prose.',
    });
    return parseJson<T>(repaired);
  }
}

export function parseJson<T>(raw: string): T {
  const stripped = raw
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/, '')
    .trim();
  const start = stripped.search(/[{[]/);
  const json = start > 0 ? stripped.slice(start) : stripped;
  return JSON.parse(json) as T;
}
