/**
 * repl.ts — `braid` entry point (interactive TUI-first, per task §1).
 * Bare `braid` → full-screen interactive TUI (TuiApp in tui/app.ts).
 * `braid plan|run …` is routed by bin/braid.js to cli.ts (scripting/CI).
 *
 * This module is a thin launcher: all presentation lives in tui/,
 * all orchestration in agents/ + orchestrator/ + human_gate/.
 * Non-TTY stdin falls back to a cooked line loop; --script replays a file.
 */
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { TuiApp, runFallback, runScript } from './tui/app.js';

/** Best-effort terminal restore for fatal paths (mirrors TuiApp teardown). */
function hardRestore(leaveAltScreen: boolean): void {
  try {
    if (process.stdin.isTTY) process.stdin.setRawMode(false);
  } catch { /* ignore */ }
  if (process.stdout.isTTY) {
    process.stdout.write('\x1b[?1006l\x1b[?1002l\x1b[?1000l');
  }
  if (leaveAltScreen && process.stdout.isTTY) {
    process.stdout.write('\x1b[?1049l');
  }
  process.stdout.write('\x1b[?25h');
}

function parseReplFlags(argv: string[]): {
  project: string;
  prdPath: string;
  mock: boolean;
  smokeOnly: boolean;
  script: string;
  noAltScreen: boolean;
} {
  const get = (name: string): string | undefined => {
    const i = argv.indexOf(`--${name}`);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  return {
    project: get('project') ?? '',
    prdPath: get('prd') ?? '',
    mock: argv.includes('--mock'),
    smokeOnly: argv.includes('--smoke-only'),
    script: get('script') ?? '',
    noAltScreen: argv.includes('--no-alt-screen'),
  };
}

async function replMain(): Promise<void> {
  const f = parseReplFlags(process.argv.slice(2));
  const opts: {
    project?: string;
    prdPath?: string;
    mock?: boolean;
    smokeOnly?: boolean;
    noAltScreen?: boolean;
  } = {};
  if (f.project) opts.project = f.project;
  if (f.prdPath) {
    const abs = resolve(f.prdPath);
    if (!existsSync(abs)) throw new Error(`PRD file not found: ${f.prdPath}`);
    opts.prdPath = abs;
  } else if (existsSync(resolve('prd.txt')) && !process.stdin.isTTY) {
    // Piped convenience: do nothing — the user can /prd explicitly.
  }
  if (f.mock) opts.mock = true;
  if (f.smokeOnly) opts.smokeOnly = true;
  if (f.noAltScreen) opts.noAltScreen = true;

  const app = new TuiApp(opts);
  if (f.script) {
    await runScript(app, f.script);
    return;
  }
  if (process.stdin.isTTY && process.stdout.isTTY) {
    const leaveAlt = !f.noAltScreen;
    const restore = (): void => hardRestore(leaveAlt);
    process.once('SIGINT', () => {
      restore();
      process.exit(130);
    });
    process.once('uncaughtException', (err) => {
      restore();
      console.error(`Fatal: ${(err as Error).message}`);
      process.exit(1);
    });
    await app.runInteractive();
    restore();
    console.log('\nGoodbye — session saved. Re-run `braid` to resume.');
  } else {
    await runFallback(app);
  }
}

// Only auto-run as the entry point — bin/braid.js spawns this module.
if (
  typeof process.argv[1] === 'string' &&
  (process.argv[1].endsWith('repl.ts') || process.argv[1].endsWith('repl.js'))
) {
  void replMain().catch((err) => {
    hardRestore(!process.argv.slice(2).includes('--no-alt-screen'));
    console.error(`Fatal: ${(err as Error).message}`);
    process.exit(1);
  });
}

export { replMain };
export type { Mode } from './tui/modes.js';
export type { Session } from './tui/session_compat.js';
