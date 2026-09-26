/** shared/config.ts — Single typed view over env. No LLM calls. */
import 'dotenv/config';

function intEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

function boolEnv(name: string, fallback: boolean): boolean {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  return raw === 'true' || raw === '1' || raw === 'yes';
}

function strEnv(name: string, fallback = ''): string {
  const v = process.env[name];
  return v && v.length > 0 ? v : fallback;
}

export interface BraidConfig {
  chatModel: string;
  planModel: string;
  reviewModel: string;
  executeModel: string;
  triageModel: string;
  reportModel: string;
  maxSelfLoopIterations: number;
  generatedRoot: string;
  /** Tiger Data / TimescaleDB telemetry configuration */
  tigerDatabaseUrl: string;
  tigerTelemetryEnabled: boolean;
  tigerBatchSize: number;
  tigerFlushIntervalMs: number;
  /** Resolve the API key for a stage, falling back to generic keys. */
  apiKeyFor(stage: string): string;
}

const STAGE_KEYS: Record<string, string[]> = {
  chat: ['CHAT_API_KEY', 'OPENROUTER_API_KEY', 'GEMINI_API_KEY', 'DEEPSEEK_API_KEY', 'OPENAI_API_KEY'],
  plan: ['PLAN_API_KEY', 'OPENROUTER_API_KEY', 'GEMINI_API_KEY', 'DEEPSEEK_API_KEY', 'ANTHROPIC_API_KEY', 'OPENAI_API_KEY'],
  review: ['REVIEW_API_KEY', 'OPENROUTER_API_KEY', 'GEMINI_API_KEY', 'OPENAI_API_KEY', 'ANTHROPIC_API_KEY'],
  execute: ['EXECUTE_API_KEY', 'OPENROUTER_API_KEY', 'OPENAI_API_KEY'],
  triage: ['TRIAGE_API_KEY', 'OPENROUTER_API_KEY', 'DEEPSEEK_API_KEY', 'GEMINI_API_KEY', 'OPENAI_API_KEY'],
  report: ['REPORT_API_KEY', 'OPENROUTER_API_KEY', 'GEMINI_API_KEY', 'DEEPSEEK_API_KEY', 'OPENAI_API_KEY'],
};

export function apiKeyFor(stage: string): string {
  const names = STAGE_KEYS[stage] ?? ['OPENAI_API_KEY', 'OPENROUTER_API_KEY', 'DEEPSEEK_API_KEY', 'GEMINI_API_KEY'];
  for (const n of names) {
    const v = process.env[n];
    if (v && v.length > 0) return v;
  }
  return '';
}

const tigerDbUrl = strEnv('TIGER_DATABASE_URL', '');
const tigerTelemetryEnabled = Boolean(
  tigerDbUrl && boolEnv('TIGER_TELEMETRY_ENABLED', true),
);

export const config: BraidConfig = {
  chatModel: strEnv('CHAT_MODEL', 'google/gemma-4-26b-a4b-it'),
  planModel: strEnv('PLAN_MODEL', 'google/gemma-4-26b-a4b-it'),
  reviewModel: strEnv('REVIEW_MODEL', 'nvidia/nemotron-3-ultra-550b-a55b'),
  executeModel: strEnv('EXECUTE_MODEL', 'nvidia/nemotron-3-ultra-550b-a55b'),
  triageModel: strEnv('TRIAGE_MODEL', 'nvidia/nemotron-3.5-lightning'),
  reportModel: strEnv('REPORT_MODEL', 'google/gemma-4-26b-a4b-it'),
  maxSelfLoopIterations: intEnv('MAX_SELF_LOOP_ITERATIONS', 3),
  generatedRoot: strEnv('GENERATED_ROOT', './generated_projects'),
  tigerDatabaseUrl: tigerDbUrl,
  tigerTelemetryEnabled,
  tigerBatchSize: intEnv('TIGER_BATCH_SIZE', 20),
  tigerFlushIntervalMs: intEnv('TIGER_FLUSH_INTERVAL_MS', 500),
  apiKeyFor,
};

export const MAX_SELF_LOOP_ITERATIONS = config.maxSelfLoopIterations;

