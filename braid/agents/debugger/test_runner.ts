/**
 * agents/debugger/test_runner.ts — Deterministic verification (never an LLM).
 * - smoke: every manifest file exists on disk.
 * - stubs: planner stubs are written into the project and executed one-by-one
 *   with the braid root's own vitest (generated_projects/ lives under braid,
 *   so `vitest` imports resolve via braid's node_modules).
 * - regression: v1 keeps the prior cycle's stub tally when provided;
 *   defaults to 0/0 on the first cycle.
 */
import { execFile } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { promisify } from 'node:util';
import type { FileManifest, TestResults, TestStub } from '../../shared/types.js';
import { emptyTestResults } from '../../shared/types.js';

const execFileAsync = promisify(execFile);

export interface TestRunOptions {
  /** Repo root of braid (owns node_modules + vitest). */
  braidRoot: string;
  /** generated_projects/<project>/ directory. */
  projectRoot: string;
  manifest: FileManifest;
  stubs: TestStub[];
  /** Prior cycle tally, reused as the regression bucket. */
  priorStubs?: { passed: number; failed: number };
}

function writeStubs(projectRoot: string, stubs: TestStub[]): string[] {
  const absPaths: string[] = [];
  for (const s of stubs) {
    const abs = resolve(join(projectRoot, s.file));
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, s.code.endsWith('\n') ? s.code : s.code + '\n', 'utf8');
    absPaths.push(abs);
  }
  return absPaths;
}

async function runOneStub(
  braidRoot: string,
  absStub: string,
  timeoutMs = 60_000,
): Promise<boolean> {
  const rel = relative(braidRoot, absStub);
  try {
    await execFileAsync(
      'npx',
      ['vitest', 'run', rel, '--reporter=basic'],
      { cwd: braidRoot, timeout: timeoutMs, maxBuffer: 4 * 1024 * 1024 },
    );
    return true;
  } catch {
    return false;
  }
}

export async function runTests(opts: TestRunOptions): Promise<TestResults> {
  const results = emptyTestResults();

  // Smoke: manifest enforcement on disk (real fs check).
  let missing = 0;
  const { existsSync } = await import('node:fs');
  for (const f of opts.manifest.files) {
    if (!existsSync(join(opts.projectRoot, f.path))) missing++;
  }
  results.smoke = missing === 0 ? { passed: 1, failed: 0 } : { passed: 0, failed: missing };

  // Stubs: write + execute each with the real runner.
  if (opts.stubs.length === 0) {
    results.stubs = { passed: 0, failed: 0 };
  } else {
    const absPaths = writeStubs(opts.projectRoot, opts.stubs);
    let passed = 0;
    for (const abs of absPaths) {
      if (await runOneStub(opts.braidRoot, abs)) passed++;
    }
    results.stubs = { passed, failed: absPaths.length - passed };
  }

  // Regression: prior cycle's stub tally (v1 wiring; loop_controller feeds it).
  results.regression = opts.priorStubs
    ? { ...opts.priorStubs }
    : { passed: 0, failed: 0 };

  return results;
}
