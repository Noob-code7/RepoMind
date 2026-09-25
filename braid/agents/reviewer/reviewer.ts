/**
 * agents/reviewer/reviewer.ts — Independent plan critique (stage 'review').
 * Must run on an architecturally different model family from the planner
 * (see .env.example) to reduce correlated blind spots.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { completeJson } from '../../shared/llm_client.js';
import type { PlanOutput, ReviewOutput } from '../../shared/types.js';

const PROMPT_PATH = join(
  dirname(fileURLToPath(import.meta.url)),
  'prompts',
  'review_prompt.md',
);

export function loadReviewPrompt(): string {
  return readFileSync(PROMPT_PATH, 'utf8');
}

/** Pure validator — riskScore clamped to [0,1], arrays required. */
export function parseReviewPayload(raw: unknown): ReviewOutput {
  const obj = raw as Record<string, unknown>;
  if (!obj || !Array.isArray(obj['critiques']) || !Array.isArray(obj['risks'])) {
    throw new Error('[reviewer] Expected { critiques: [], risks: [], riskScore: number }');
  }
  const score = Number(obj['riskScore']);
  if (!Number.isFinite(score)) throw new Error('[reviewer] riskScore must be a number');
  return {
    critiques: (obj['critiques'] as unknown[]).map(String),
    risks: (obj['risks'] as unknown[]).map(String),
    riskScore: Math.min(1, Math.max(0, score)),
  };
}

export async function reviewPlan(
  prd: string,
  plan: PlanOutput,
): Promise<ReviewOutput> {
  const raw = await completeJson<unknown>({
    stage: 'review',
    systemPrompt: loadReviewPrompt(),
    userPrompt: JSON.stringify({ prd, plan }),
    maxTokens: 3000,
    temperature: 0.3,
  });
  return parseReviewPayload(raw);
}
