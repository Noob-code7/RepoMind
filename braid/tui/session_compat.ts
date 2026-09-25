/**
 * tui/session_compat.ts — Backward-compatible `Session` shape.
 * The legacy repl.ts exported `Session` (modes plan|review|execute|debug|report).
 * The new TUI uses PersistedSession + TuiApp internally; this alias keeps
 * existing importers compiling while they migrate to the new modes
 * (chat|plan|review|build|debug|report).
 */
import type { PersistedSession } from './session_store.js';

export interface Session {
  project: string;
  prdPath: string;
  prdBuffer: string;
  feedback?: string;
  mock: boolean;
  mockProject: string;
  smokeOnly: boolean;
  mode: 'plan' | 'review' | 'execute' | 'debug' | 'report';
}

export function toCompat(s: PersistedSession): Session {
  const modeMap: Record<PersistedSession['mode'], Session['mode']> = {
    chat: 'plan',
    plan: 'plan',
    review: 'review',
    build: 'execute',
    debug: 'debug',
    report: 'report',
  };
  return {
    project: s.project,
    prdPath: s.prdPath,
    prdBuffer: s.prdBuffer,
    feedback: s.feedback,
    mock: s.mock,
    mockProject: '',
    smokeOnly: s.smokeOnly,
    mode: modeMap[s.mode],
  };
}
