/**
 * tests/orchestrator.test.ts
 * Unit tests for ManifestStore, LoopController, and end-to-end BraidStateMachine.
 */
import fs from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { setGateReportHandler } from '../human_gate/gate_report.js';
import { setGateReviewHandler } from '../human_gate/gate_review.js';
import { LoopController } from '../orchestrator/loop_controller.js';
import { ManifestStore } from '../orchestrator/manifest_store.js';
import { BraidStateMachine } from '../orchestrator/state_machine.js';
import { LlmRequest, setMockHandler } from '../shared/llm_client.js';
import { FileManifest } from '../shared/types.js';

describe('ManifestStore', () => {
  const tmpDir = path.resolve('./dist/test_manifest_store_tmp');

  beforeEach(() => {
    fs.mkdirSync(tmpDir, { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  const manifest: FileManifest = {
    project: 'store-test',
    files: [
      {
        path: 'src/index.ts',
        purpose: 'Main entry',
        expectedExports: ['run'],
        dependencies: [],
        status: 'planned',
      },
    ],
  };

  it('saves and reloads manifest properly', () => {
    ManifestStore.save(tmpDir, manifest);
    const loaded = ManifestStore.load(tmpDir);
    expect(loaded).not.toBeNull();
    expect(loaded?.project).toBe('store-test');
    expect(loaded?.files[0].path).toBe('src/index.ts');
  });

  it('updates file status and computes completeness', () => {
    ManifestStore.save(tmpDir, manifest);
    ManifestStore.updateStatus(manifest, 'src/index.ts', 'verified');
    expect(ManifestStore.completeness(manifest)).toBe(100);
  });
});

describe('LoopController', () => {
  it('caps self-loops at configured maximum', () => {
    const ctrl = new LoopController(2);
    expect(ctrl.canSelfLoop()).toBe(true);
    ctrl.recordSelfLoop('fail 1');
    expect(ctrl.canSelfLoop()).toBe(true);
    ctrl.recordSelfLoop('fail 2');
    expect(ctrl.canSelfLoop()).toBe(false);
  });

  it('increments agile cycles and resets self-loop count', () => {
    const ctrl = new LoopController(2);
    ctrl.recordSelfLoop('fail');
    ctrl.startNewAgileCycle('needs more features');
    expect(ctrl.agileCycle).toBe(2);
    expect(ctrl.currentSelfLoop).toBe(0);
    expect(ctrl.canSelfLoop()).toBe(true);
  });
});

describe('BraidStateMachine End-to-End Pipeline', () => {
  const tmpPipelineDir = path.resolve('./dist/test_pipeline_tmp');

  beforeEach(() => {
    fs.mkdirSync(tmpPipelineDir, { recursive: true });

    // Inject mock LLM responses for all stages
    setMockHandler((req: LlmRequest) => {
      switch (req.stage) {
        case 'plan':
          return JSON.stringify({
            taskGraph: {
              nodes: [
                {
                  id: 'task-1',
                  title: 'Build Math Lib',
                  dependsOn: [],
                  files: ['src/math.ts'],
                },
              ],
            },
            manifest: {
              project: 'e2e-math',
              files: [
                {
                  path: 'src/math.ts',
                  purpose: 'Basic math utility',
                  expectedExports: ['add'],
                  dependencies: [],
                  status: 'planned',
                },
              ],
            },
            testStubs: [
              {
                file: 'tests/math.test.ts',
                name: 'adds two numbers',
                code: `import { describe, it, expect } from 'vitest';
import { add } from '../src/math.js';
describe('add', () => {
  it('adds numbers', () => {
    expect(add(2, 3)).toBe(5);
  });
});`,
              },
            ],
          });

        case 'review':
          return JSON.stringify({
            critiques: ['Looks clean and minimal.'],
            risks: [],
            riskScore: 0.05,
          });

        case 'execute':
          if (req.userPrompt.includes('skeletons for the following files')) {
            return JSON.stringify({
              files: {
                'src/math.ts': `// SKELETON_ONLY\nexport function add(a: number, b: number): number;`,
              },
            });
          }
          // Implementation pass
          return `export function add(a: number, b: number): number {\n  return a + b;\n}\n`;

        case 'triage':
          return JSON.stringify({
            summary: 'No failures',
            patches: [],
          });

        case 'report':
          return JSON.stringify({
            manifestCompleteness: 100,
            diffSummary: 'Created src/math.ts with add function.',
            flaggedRisks: [],
            prdCoverage: [
              {
                requirement: 'Math Addition',
                status: 'implemented',
                files: ['src/math.ts'],
              },
            ],
          });

        default:
          return '{}';
      }
    });

    // Auto-approve gates for deterministic testing
    setGateReviewHandler(() => ({ approved: true }));
    setGateReportHandler(() => ({ approved: true }));
  });

  afterEach(() => {
    setMockHandler(null);
    setGateReviewHandler(null);
    setGateReportHandler(null);
    fs.rmSync(tmpPipelineDir, { recursive: true, force: true });
  });

  it('runs complete Plan → Review → Gate 1 → Execute → Debug → Report → Gate 2 → Done lifecycle', async () => {
    const pipeline = new BraidStateMachine({
      prd: 'Build a math library with add(a, b)',
      projectName: 'e2e-math',
      projectRoot: tmpPipelineDir,
    });

    const transitions: string[] = [];
    pipeline.onTransition((state) => {
      transitions.push(state);
    });

    const report = await pipeline.run();

    expect(transitions).toEqual([
      'REVIEW',
      'GATE_REVIEW',
      'EXECUTE',
      'DEBUG',
      'REPORT',
      'GATE_REPORT',
      'DONE',
    ]);
    expect(report.manifestCompleteness).toBe(100);
    expect(fs.existsSync(path.join(tmpPipelineDir, 'src/math.ts'))).toBe(true);

    const generatedCode = fs.readFileSync(
      path.join(tmpPipelineDir, 'src/math.ts'),
      'utf-8',
    );
    expect(generatedCode).toContain('return a + b');
  });
});
