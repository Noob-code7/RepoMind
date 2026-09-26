/**
 * tui/session_store.ts — Session persistence for resume-after-restart.
 * The TUI saves lightweight session state (project, mode, PRD buffer,
 * flags) to `~/.braid_session.json` (overridable via BRAID_SESSION_FILE).
 * Pipeline artifacts (plan.json, manifest.json, report.json) already live
 * under generated_projects/<project>/ and are reloaded on demand — this
 * store only remembers how to find them again.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import type { Mode } from './modes.js';
import { isValidMode } from './modes.js';

export interface PersistedSession {
  version: 1;
  project: string;
  prdPath: string;
  prdBuffer: string;
  feedback?: string;
  mock: boolean;
  smokeOnly: boolean;
  mode: Mode;
  /** Active chat model id (selector beneath input). Defaults to plan model. */
  chatModel?: string;
  voiceEnabled?: boolean;
  updatedAt: string;
}

export function sessionFilePath(): string {
  return (
    process.env['BRAID_SESSION_FILE'] ||
    join(homedir(), '.braid_session.json')
  );
}

export function defaultSession(): PersistedSession {
  return {
    version: 1,
    project: 'demo',
    prdPath: '',
    prdBuffer: '',
    mock: false,
    smokeOnly: false,
    mode: 'chat',
    voiceEnabled: false,
    updatedAt: new Date().toISOString(),
  };
}

/** Best-effort load: missing/corrupt files yield defaults, never throw. */
export function loadSession(file?: string): PersistedSession {
  const path = file ?? sessionFilePath();
  try {
    if (!existsSync(path)) return defaultSession();
    const raw: unknown = JSON.parse(readFileSync(path, 'utf8'));
    if (typeof raw !== 'object' || raw === null) return defaultSession();
    const o = raw as Record<string, unknown>;
    const base = defaultSession();
    const mode =
      typeof o['mode'] === 'string' && isValidMode(o['mode'])
        ? o['mode']
        : base.mode;
    return {
      version: 1,
      project: typeof o['project'] === 'string' && o['project'] ? o['project'] : base.project,
      prdPath: typeof o['prdPath'] === 'string' ? o['prdPath'] : '',
      prdBuffer: typeof o['prdBuffer'] === 'string' ? (o['prdBuffer'] as string).slice(0, 200_000) : '',
      feedback: typeof o['feedback'] === 'string' ? (o['feedback'] as string).slice(0, 20_000) : undefined,
      mock: o['mock'] === true,
      smokeOnly: o['smokeOnly'] === true,
      mode,
      chatModel: typeof o['chatModel'] === 'string' && o['chatModel'] ? (o['chatModel'] as string).slice(0, 200) : undefined,
      voiceEnabled: o['voiceEnabled'] === true,
      updatedAt: typeof o['updatedAt'] === 'string' ? o['updatedAt'] : base.updatedAt,
    };
  } catch {
    return defaultSession();
  }
}

/** Best-effort save: never throws (session loss must not crash the TUI). */
export function saveSession(s: PersistedSession, file?: string): void {
  try {
    const path = file ?? sessionFilePath();
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(
      path,
      JSON.stringify({ ...s, updatedAt: new Date().toISOString() }, null, 2) + '\n',
      'utf8',
    );
  } catch {
    /* session persistence is best-effort */
  }
}
