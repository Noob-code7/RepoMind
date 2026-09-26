/**
 * tui/slash_commands.ts — Slash command registry + searchable filtering.
 * Pure functions (no fs, no LLM) so they are trivially unit-testable.
 * Handlers live in tui/app.ts and must call existing pipeline modules
 * (cli.ts / agents / orchestrator) — never duplicate orchestration logic.
 */

import type { Mode } from './modes.js';

export interface SlashCommand {
  name: string;
  description: string;
  usage: string;
  /** Modes this command is most relevant in (informational only). */
  modes?: Mode[];
}

export const SLASH_COMMANDS: SlashCommand[] = [
  { name: 'help', description: 'Display available commands and keyboard shortcuts', usage: '/help' },
  { name: 'plan', description: 'Generate or inspect the current plan', usage: '/plan' },
  { name: 'review', description: 'Review the current plan', usage: '/review' },
  { name: 'build', description: 'Execute the approved plan', usage: '/build' },
  { name: 'test', description: 'Run the test suite', usage: '/test' },
  { name: 'debug', description: 'Inspect failures and initiate repairs', usage: '/debug' },
  { name: 'report', description: 'Display the latest execution report', usage: '/report' },
  { name: 'model', description: 'View or change model assignments', usage: '/model [chat|slot] [name]' },
  { name: 'status', description: 'Show pipeline state + diagnostics', usage: '/status' },
  { name: 'config', description: 'Show models, flags and paths (diagnostics)', usage: '/config' },
  { name: 'files', description: 'Inspect the file manifest', usage: '/files' },
  { name: 'clear', description: 'Clear the conversation display', usage: '/clear' },
  { name: 'exit', description: 'Exit the application', usage: '/exit' },
  // Backward-compatible extras (kept out of the primary help grid spotlight
  // but still searchable so existing muscle memory keeps working).
  { name: 'run', description: 'Run the full pipeline loop (plan → report)', usage: '/run' },
  { name: 'telemetry', description: 'Show recorded run telemetry', usage: '/telemetry <run-id>' },
  { name: 'execute', description: 'Alias of /build', usage: '/execute' },
  { name: 'mode', description: 'Show or set the active mode', usage: '/mode [chat|plan|review|build|debug|report]' },
  { name: 'prd', description: 'Load a PRD file into the buffer', usage: '/prd <file>' },
  { name: 'project', description: 'Switch project (output dir)', usage: '/project <name>' },
  { name: 'mock', description: 'Toggle offline demo models', usage: '/mock' },
  { name: 'smoke', description: 'Toggle vitest skipping (smoke-only)', usage: '/smoke' },
  { name: 'voice', description: 'Toggle voice conversation mode (STT / ElevenLabs TTS)', usage: '/voice [on|off]' },
  { name: 'quit', description: 'Alias of /exit', usage: '/quit' },
];

/** Primary 12 commands shown in /help. */
export const PRIMARY_COMMANDS: string[] = [
  'help', 'plan', 'review', 'build', 'test',
  'debug', 'report', 'model', 'status', 'files',
  'clear', 'exit',
];

export function findCommand(name: string): SlashCommand | undefined {
  const n = name.toLowerCase().replace(/^\//, '');
  return SLASH_COMMANDS.find((c) => c.name === n);
}

/**
 * Searchable filter for the `/` menu. Matches prefix first, then substring
 * against name + description. Empty query returns the primary commands.
 */
export function filterCommands(query: string): SlashCommand[] {
  const q = query.toLowerCase().replace(/^\//, '').trim();
  if (!q) return SLASH_COMMANDS.filter((c) => PRIMARY_COMMANDS.includes(c.name));
  const prefix = SLASH_COMMANDS.filter((c) => c.name.startsWith(q));
  const rest = SLASH_COMMANDS.filter(
    (c) =>
      !c.name.startsWith(q) &&
      (c.name.includes(q) || c.description.toLowerCase().includes(q)),
  );
  return [...prefix, ...rest];
}

export function helpText(): string {
  const rows = SLASH_COMMANDS.filter((c) =>
    PRIMARY_COMMANDS.includes(c.name),
  ).map((c) => `  /${c.name.padEnd(8)} ${c.description}`);
  return [
    'Commands:',
    ...rows,
    '',
    'Aliases: /execute (= /build), /run (full loop), /quit (= /exit),',
    '         /mode, /prd <file>, /project <name>, /mock, /smoke, /config,',
    '         /telemetry <run-id> (recorded run summary)',
    '',
    'Keyboard:',
    '  Tab / Shift+Tab   cycle modes (history + context preserved)',
    '  Up / Down         history · suggestion / menu navigation',
    '  1-4               run a home suggestion (empty input only)',
    '  Enter             submit (selects menu item when open)',
    '  Ctrl+J            insert newline (multiline input)',
    '  PgUp / PgDn       scroll conversation',
    '  Ctrl+T            mode-selection menu',
    '  Ctrl+P            model selector (beneath input)',
    '  Ctrl+O            expand / collapse tool details',
    '  Ctrl+C            cancel running op · press again to exit',
    '  Esc               dismiss menu / dialog',
  ].join('\n');
}
