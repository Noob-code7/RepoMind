/** shared/config.ts — Single typed view over env. No LLM calls. */
import 'dotenv/config';

function intEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

function strEnv(name: string, fallback = ''): string {
  const v = process.env[name];
  return v && v.length > 0 ? v : fallback;
}

export interface BraidConfig {
  planModel: string;
  reviewModel: string;
  executeModel: string;
  triageModel: string;
  reportModel: string;
  maxSelfLoopIterations: number;
  generatedRoot: string;
  /** Resolve the API key for a stage, falling back to generic keys. */
  apiKeyFor(stage: string): string;
}

const STAGE_KEYS: Record<string, string[]> = {
  plan: ['PLAN_API_KEY', 'ANTHROPIC_API_KEY'],
  review: ['REVIEW_API_KEY', 'OPENAI_API_KEY'],
  execute: ['EXECUTE_API_KEY', 'OPENAI_API_KEY'],
  triage: ['TRIAGE_API_KEY', 'OPENAI_API_KEY'],
  report: ['REPORT_API_KEY', 'OPENAI_API_KEY'],
};

export function apiKeyFor(stage: string): string {
  const names = STAGE_KEYS[stage] ?? ['OPENAI_API_KEY'];
  for (const n of names) {
    const v = process.env[n];
    if (v && v.length > 0) return v;
  }
  return '';
}

export const config: BraidConfig = {
  planModel: strEnv('PLAN_MODEL', 'claude-opus-4-1'),
  reviewModel: strEnv('REVIEW_MODEL', 'gpt-5'),
  executeModel: strEnv('EXECUTE_MODEL', 'gpt-5-codex'),
  triageModel: strEnv('TRIAGE_MODEL', 'gpt-5-mini'),
  reportModel: strEnv('REPORT_MODEL', 'gpt-5-mini'),
  maxSelfLoopIterations: intEnv('MAX_SELF_LOOP_ITERATIONS', 3),
  generatedRoot: strEnv('GENERATED_ROOT', './generated_projects'),
  apiKeyFor,
};

export const MAX_SELF_LOOP_ITERATIONS = config.maxSelfLoopIterations;
