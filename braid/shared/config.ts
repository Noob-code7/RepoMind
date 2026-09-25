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
  plan: ['PLAN_API_KEY', 'DEEPSEEK_API_KEY', 'ANTHROPIC_API_KEY', 'OPENAI_API_KEY'],
  review: ['REVIEW_API_KEY', 'GEMINI_API_KEY', 'OPENAI_API_KEY', 'ANTHROPIC_API_KEY'],
  execute: ['EXECUTE_API_KEY', 'OPENROUTER_API_KEY', 'OPENAI_API_KEY'],
  triage: ['TRIAGE_API_KEY', 'DEEPSEEK_API_KEY', 'GEMINI_API_KEY', 'OPENAI_API_KEY'],
  report: ['REPORT_API_KEY', 'GEMINI_API_KEY', 'DEEPSEEK_API_KEY', 'OPENAI_API_KEY'],
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
  planModel: strEnv('PLAN_MODEL', 'deepseek-reasoner'),
  reviewModel: strEnv('REVIEW_MODEL', 'gemini-2.5-flash'),
  executeModel: strEnv('EXECUTE_MODEL', 'nvidia/llama-3.1-nemotron-70b-instruct'),
  triageModel: strEnv('TRIAGE_MODEL', 'deepseek-chat'),
  reportModel: strEnv('REPORT_MODEL', 'gemini-2.5-flash'),
  maxSelfLoopIterations: intEnv('MAX_SELF_LOOP_ITERATIONS', 3),
  generatedRoot: strEnv('GENERATED_ROOT', './generated_projects'),
  tigerDatabaseUrl: tigerDbUrl,
  tigerTelemetryEnabled,
  tigerBatchSize: intEnv('TIGER_BATCH_SIZE', 20),
  tigerFlushIntervalMs: intEnv('TIGER_FLUSH_INTERVAL_MS', 500),
  apiKeyFor,
};

export const MAX_SELF_LOOP_ITERATIONS = config.maxSelfLoopIterations;

