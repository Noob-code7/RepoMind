/**
 * tui/modes.ts — Interactive mode definitions + cycling.
 * Presentation-layer only: no LLM calls, no orchestrator imports.
 * Modes preserve conversation history / project context by design —
 * the TuiApp keeps a single Session + message list across switches.
 */

export const MODES = [
  'chat',
  'plan',
  'review',
  'build',
  'debug',
  'report',
] as const;

export type Mode = (typeof MODES)[number];

/** Executor-stage alias: build mode drives the `execute` pipeline modules. */
export function modeToStage(mode: Mode): string {
  if (mode === 'build') return 'execute';
  if (mode === 'chat') return 'plan';
  return mode;
}

export function isValidMode(m: unknown): m is Mode {
  return (
    typeof m === 'string' &&
    (MODES as readonly string[]).includes(m)
  );
}

/** Tab cycles forward; Shift+Tab (or `prev`) cycles backward. */
export function cycleMode(current: Mode, dir: 1 | -1 = 1): Mode {
  const i = MODES.indexOf(current);
  const n = MODES.length;
  return MODES[(i + dir + n) % n]!;
}

export const MODE_DESCRIPTIONS: Record<Mode, string> = {
  chat: 'Discuss requirements, ask questions, interact with the AI',
  plan: 'Generate and inspect the task graph, file manifest and test specs',
  review: 'Inspect architectural critiques, risks and approval requests',
  build: 'Execute approved plans and monitor code generation',
  debug: 'Run tests, inspect failures and initiate targeted repairs',
  report: 'View PRD coverage, test results, file completeness and summaries',
};

export const MODE_HINTS: Record<Mode, string> = {
  chat: 'Type a PRD, a file path, or a question. Enter sends.',
  plan: 'Empty Enter runs the planner. PRD text appends to the buffer.',
  review: 'Empty Enter re-reviews the current plan.',
  build: 'Empty Enter executes the approved plan (Gate 1 must pass).',
  debug: 'Empty Enter runs the test suite (+ capped repair loop).',
  report: 'Empty Enter regenerates the execution report.',
};
