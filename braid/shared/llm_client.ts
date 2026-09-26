/**
 * shared/llm_client.ts — Thin, reusable router: one function per stage.
 * Real API keys (per build decision). Provider is chosen by model prefix:
 *   claude-* → Anthropic SDK, everything else → OpenAI SDK.
 * Tests inject a deterministic mock via setMockHandler (no network).
 */
import Anthropic from '@anthropic-ai/sdk';
import OpenAI from 'openai';
import { apiKeyFor, config } from './config.js';

export type LlmStage = 'chat' | 'plan' | 'review' | 'execute' | 'triage' | 'report';

export interface LlmRequest {
  stage: LlmStage;
  systemPrompt: string;
  userPrompt: string;
  maxTokens?: number;
  temperature?: number;
}

const MODEL_FOR: Record<LlmStage, () => string> = {
  chat: () => config.chatModel,
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

/**
 * Runtime per-stage model overrides (REPL /model command). Values must be
 * model names; provider routing still follows the claude-* prefix rule.
 */
const modelOverrides = new Map<LlmStage, string>();

export function setModelOverride(stage: LlmStage, model: string): void {
  if (!model.trim()) throw new Error('[llm_client] model name is required');
  modelOverrides.set(stage, model.trim());
}
export function clearModelOverride(stage: LlmStage): void {
  modelOverrides.delete(stage);
}
export function clearAllModelOverrides(): void {
  modelOverrides.clear();
}
/** Effective model for a stage: runtime override wins, else env config. */
export function effectiveModel(stage: LlmStage): string {
  return modelOverrides.get(stage) ?? MODEL_FOR[stage]();
}

function modelFor(req: LlmRequest): string {
  return effectiveModel(req.stage);
}

import {
  completeOllamaChat,
  getOllamaBaseUrl,
  streamOllamaChat,
} from './ollama_client.js';

export function isOllama(model: string): boolean {
  const low = model.toLowerCase().trim();
  if (low.startsWith('ollama/') || low.startsWith('local/')) return true;
  if (low.includes('/')) return false; // Vendor slugs like google/gemma route to OpenRouter
  return (
    low.startsWith('qwen') ||
    low.startsWith('llama') ||
    low.startsWith('mistral') ||
    low.startsWith('codellama') ||
    low.startsWith('phi') ||
    low.includes(':')
  );
}

function isClaude(model: string): boolean {
  return model.toLowerCase().startsWith('claude');
}

function requireKey(stage: LlmStage): string {
  const model = effectiveModel(stage);
  if (isOllama(model)) return 'ollama';
  const key = apiKeyFor(stage);
  if (!key) {
    throw new Error(
      `[llm_client] Missing API key for stage "${stage}". ` +
        `Set ${stage.toUpperCase()}_API_KEY (or GEMINI/OPENAI fallback) in .env. ` +
        `For offline tests use setMockHandler().`,
    );
  }
  return key;
}

interface ProviderConfig {
  baseURL?: string;
  defaultHeaders?: Record<string, string>;
}

function resolveProvider(model: string, key: string): ProviderConfig {
  const low = model.toLowerCase();

  // Local Ollama
  if (isOllama(model)) {
    return {
      baseURL: `${getOllamaBaseUrl()}/v1`,
    };
  }

  // 1. OpenRouter — model-slug match wins (reliable even when stage keys
  //    still hold a stale DeepSeek/Gemini value). All '/' slugs route here.
  if (
    low.startsWith('google/') ||
    low.startsWith('nvidia/') ||
    low.startsWith('deepseek/') ||
    low.startsWith('moonshotai/') ||
    low.startsWith('qwen/') ||
    model.includes('/')
  ) {
    return {
      baseURL: process.env.OPENROUTER_BASE_URL || 'https://openrouter.ai/api/v1',
      defaultHeaders: {
        'HTTP-Referer': 'https://github.com/braid',
        'X-Title': 'Braid',
      },
    };
  }
  // Explicit OpenRouter keys always route here.
  if (key.startsWith('sk-or-v1-')) {
    return {
      baseURL: process.env.OPENROUTER_BASE_URL || 'https://openrouter.ai/api/v1',
      defaultHeaders: {
        'HTTP-Referer': 'https://github.com/braid',
        'X-Title': 'Braid',
      },
    };
  }

  // 2. DeepSeek (direct). deepseek-reasoner / deepseek-chat are billed here;
  //    a 402 means the account is out of credit, not a routing bug.
  if (low.startsWith('deepseek')) {
    return {
      baseURL: process.env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com',
    };
  }
  if (key === process.env.DEEPSEEK_API_KEY && key) {
    return {
      baseURL: process.env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com',
    };
  }

  // 3. Google Gemini / Gemma (via OpenAI-compatible endpoint).
  //    NOTE: gemini-2.5-* is sunset (404) — use gemini-3.x or gemma-4.
  if (
    low.startsWith('gemini') ||
    low.startsWith('gemma') ||
    key.startsWith('AQ.') ||
    (key === process.env.GEMINI_API_KEY && key)
  ) {
    return {
      baseURL:
        process.env.GEMINI_BASE_URL ||
        'https://generativelanguage.googleapis.com/v1beta/openai/',
    };
  }

  // 4. Default OpenAI
  return {
    baseURL: process.env.OPENAI_BASE_URL || undefined,
  };
}

const openaiClients = new Map<string, OpenAI>();
let anthropicCache: { key: string; client: Anthropic } | null = null;

function getOpenAIClient(
  key: string,
  baseURL?: string,
  defaultHeaders?: Record<string, string>,
): OpenAI {
  const cacheKey = `${key}::${baseURL ?? 'default'}`;
  let client = openaiClients.get(cacheKey);
  if (!client) {
    client = new OpenAI({
      apiKey: key,
      baseURL: baseURL || undefined,
      defaultHeaders,
    });
    openaiClients.set(cacheKey, client);
  }
  return client;
}

function anthropic(key: string): Anthropic {
  if (!anthropicCache || anthropicCache.key !== key)
    anthropicCache = { key, client: new Anthropic({ apiKey: key }) };
  return anthropicCache.client;
}

export interface LlmStreamRequest extends LlmRequest {
  onToken: (token: string) => void;
  signal?: AbortSignal;
}

/** Streaming text completion for any stage (particularly chat). */
export async function completeStream(req: LlmStreamRequest): Promise<string> {
  if (mockHandler) {
    const full = await mockHandler(req);
    const tokens = full.split(/(\s+)/);
    for (const t of tokens) {
      if (req.signal?.aborted) throw new Error('Request aborted');
      req.onToken(t);
    }
    return full;
  }
  const model = modelFor(req);
  if (isOllama(model)) {
    return streamOllamaChat({
      model,
      messages: [
        { role: 'system', content: req.systemPrompt },
        { role: 'user', content: req.userPrompt },
      ],
      temperature: req.temperature,
      maxTokens: req.maxTokens,
      signal: req.signal,
      onToken: req.onToken,
    });
  }
  const res = await complete(req);
  req.onToken(res);
  return res;
}

/** Raw text completion for a stage. Reusable by all agents. */
export async function complete(req: LlmRequest): Promise<string> {
  if (mockHandler) return mockHandler(req);
  const model = modelFor(req);
  const key = requireKey(req.stage);

  if (isOllama(model)) {
    return completeOllamaChat({
      model,
      messages: [
        { role: 'system', content: req.systemPrompt },
        { role: 'user', content: req.userPrompt },
      ],
      temperature: req.temperature,
      maxTokens: req.maxTokens,
    });
  }

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

  const provider = resolveProvider(model, key);
  const client = getOpenAIClient(key, provider.baseURL, provider.defaultHeaders);

  const params: OpenAI.Chat.Completions.ChatCompletionCreateParamsNonStreaming = {
    model,
    messages: [
      { role: 'system', content: req.systemPrompt },
      { role: 'user', content: req.userPrompt },
    ],
    max_tokens: req.maxTokens ?? 4096,
  };

  // DeepSeek-reasoner does not support custom temperature
  if (model !== 'deepseek-reasoner') {
    params.temperature = req.temperature ?? 0.2;
  }

  try {
    const res = await client.chat.completions.create(params);
    const msg = res.choices[0]?.message as
      | { content?: unknown; reasoning?: unknown; reasoning_details?: unknown }
      | undefined;
    if (typeof msg?.content === 'string' && msg.content.trim()) return msg.content;
    // Reasoning models (Nemotron Ultra / Lightning) may put the answer in
    // `reasoning` with null content when max_tokens clips thinking. Fall back
    // so execute/plan stages don't see "Empty output".
    if (typeof msg?.reasoning === 'string' && msg.reasoning.trim()) return msg.reasoning;
    return (msg?.content as string) ?? '';
  } catch (err) {
    if (model.toLowerCase().startsWith('gemini') && process.env.OPENROUTER_API_KEY) {
      const fallbackModel = 'nvidia/nemotron-3-ultra-550b-a55b';
      const fallbackProvider = resolveProvider(fallbackModel, process.env.OPENROUTER_API_KEY);
      const fallbackClient = getOpenAIClient(process.env.OPENROUTER_API_KEY, fallbackProvider.baseURL, fallbackProvider.defaultHeaders);
      const fallbackRes = await fallbackClient.chat.completions.create({
        ...params,
        model: fallbackModel,
        max_tokens: Math.min(params.max_tokens ?? 4096, 4096),
      });
      const fallbackMsg = fallbackRes.choices[0]?.message as
        | { content?: unknown; reasoning?: unknown }
        | undefined;
      if (typeof fallbackMsg?.content === 'string' && fallbackMsg.content.trim()) return fallbackMsg.content;
      if (typeof fallbackMsg?.reasoning === 'string' && fallbackMsg.reasoning.trim()) return fallbackMsg.reasoning;
    }
    throw err;
  }
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
