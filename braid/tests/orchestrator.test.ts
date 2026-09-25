import { describe, expect, it } from 'vitest';
import {
  StateMachine,
  isTerminal,
  nextState,
  requiresGate,
} from '../orchestrator/state_machine.js';
import { ManifestStore } from '../orchestrator/manifest_store.js';
import { DigestStore, extractSignatures } from '../orchestrator/digest_store.js';
import type { FileManifest } from '../shared/types.js';
import { mkdtempSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

describe('state_machine', () => {
  it('walks the happy path PLAN → DONE', () => {
    const sm = new StateMachine();
    expect(sm.state).toBe('PLAN');
    expect(sm.advance()).toBe('REVIEW');
    expect(sm.advance()).toBe('GATE_REVIEW');
    expect(sm.advance({ approved: true })).toBe('EXECUTE');
    expect(sm.advance()).toBe('DEBUG');
    expect(sm.advance()).toBe('REPORT');
    expect(sm.advance()).toBe('GATE_REPORT');
    expect(sm.advance({ approved: true })).toBe('DONE');
    expect(sm.done).toBe(true);
    expect(isTerminal(sm.state)).toBe(true);
  });

  it('loops back to PLAN on gate rejection and counts cycles', () => {
    const sm = new StateMachine();
    sm.advance();
    sm.advance();
    expect(sm.advance({ approved: false, feedback: 'revise' })).toBe('PLAN');
    expect(sm.cycleCount).toBe(1);
    // Drive to report gate and reject (agile loop)
    sm.advance();
    sm.advance();
    sm.advance({ approved: true });
    sm.advance();
    sm.advance();
    sm.advance();
    expect(sm.advance({ approved: false, feedback: 'not satisfied' })).toBe(
      'PLAN',
    );
    expect(sm.cycleCount).toBe(2);
  });

  it('requires a decision at gates and stays DONE once terminal', () => {
    expect(requiresGate('GATE_REVIEW')).toBe(true);
    expect(requiresGate('GATE_REPORT')).toBe(true);
    expect(requiresGate('EXECUTE')).toBe(false);
    expect(() => nextState('GATE_REVIEW')).toThrow();
    expect(nextState('DONE')).toBe('DONE');
  });
});

describe('manifest_store', () => {
  const initial: FileManifest = {
    project: 'demo',
    files: [
      {
        path: 'src/a.ts',
        purpose: 'a',
        expectedExports: ['a'],
        dependencies: [],
        status: 'planned',
      },
      {
        path: 'src/b.ts',
        purpose: 'b',
        expectedExports: ['b'],
        dependencies: ['src/a.ts'],
        status: 'planned',
      },
    ],
  };

  it('persists JSON, tracks statuses and dependencies', () => {
    const dir = mkdtempSync(join(tmpdir(), 'braid-'));
    const p = join(dir, 'manifest.json');
    const store = new ManifestStore(p, initial);
    expect(store.project).toBe('demo');
    expect(store.dependenciesOf('src/b.ts')).toEqual(['src/a.ts']);
    expect(store.dependentsOf('src/a.ts')).toEqual(['src/b.ts']);

    store.setStatus('src/a.ts', 'skeleton');
    expect(store.get('src/a.ts')?.status).toBe('skeleton');
    expect(store.byStatus('planned')).toEqual(['src/b.ts']);

    const raw = JSON.parse(readFileSync(p, 'utf8'));
    expect(raw.files).toHaveLength(2);

    const reloaded = ManifestStore.load(p);
    expect(reloaded.get('src/a.ts')?.status).toBe('skeleton');
    expect(() =>
      reloaded.setStatus('src/nope.ts', 'verified'),
    ).toThrow();
  });
});

describe('digest_store', () => {
  it('extracts exports and renders a compact prompt', () => {
    expect(
      extractSignatures(
        'export function foo() {}\nexport class Bar {}\nexport const x = 1;',
      ),
    ).toEqual(['Bar', 'foo', 'x']);
    const store = new DigestStore();
    store.upsert('src/a.ts', '/** Auth helper */\nexport function login() {}', 'auth');
    store.upsert('src/b.ts', 'export const VERSION = 1;');
    expect(store.size).toBe(2);
    const prompt = store.toPrompt();
    expect(prompt).toContain('src/a.ts');
    expect(prompt).toContain('login');
  });
});
