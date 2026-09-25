/**
 * tests/manifest_diff.test.ts
 * Verifies deterministic manifest diffing and requeueing.
 */
import fs from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ManifestDiff } from '../orchestrator/manifest_diff.js';
import { FileManifest } from '../shared/types.js';

describe('ManifestDiff', () => {
  const testDir = path.resolve('./dist/test_manifest_diff_tmp');

  beforeEach(() => {
    fs.mkdirSync(testDir, { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(testDir, { recursive: true, force: true });
  });

  const manifest: FileManifest = {
    project: 'diff-test',
    files: [
      {
        path: 'src/a.ts',
        purpose: 'File A',
        expectedExports: ['a'],
        dependencies: [],
        status: 'planned',
      },
      {
        path: 'src/b.ts',
        purpose: 'File B',
        expectedExports: ['b'],
        dependencies: [],
        status: 'planned',
      },
      {
        path: 'src/c.ts',
        purpose: 'File C',
        expectedExports: ['c'],
        dependencies: [],
        status: 'planned',
      },
    ],
  };

  it('detects all files missing initially', () => {
    const diff = ManifestDiff.diff(testDir, manifest, 'skeleton');
    expect(diff.missing.length).toBe(3);
    expect(diff.valid.length).toBe(0);
    expect(diff.completenessPercentage).toBe(0);
  });

  it('detects valid and empty files accurately', () => {
    // Write a valid file and an empty file
    fs.mkdirSync(path.join(testDir, 'src'), { recursive: true });
    fs.writeFileSync(path.join(testDir, 'src/a.ts'), 'export const a = 1;', 'utf-8');
    fs.writeFileSync(path.join(testDir, 'src/b.ts'), '', 'utf-8'); // empty

    const diff = ManifestDiff.diff(testDir, manifest, 'skeleton');
    expect(diff.valid.map((f) => f.path)).toEqual(['src/a.ts']);
    expect(diff.empty.map((f) => f.path)).toEqual(['src/b.ts']);
    expect(diff.missing.map((f) => f.path)).toEqual(['src/c.ts']);
    expect(diff.completenessPercentage).toBe(33);
  });

  it('detects SKELETON_ONLY placeholders during implemented pass', () => {
    fs.mkdirSync(path.join(testDir, 'src'), { recursive: true });
    fs.writeFileSync(
      path.join(testDir, 'src/a.ts'),
      '// SKELETON_ONLY\nexport function a() {}',
      'utf-8',
    );

    const diff = ManifestDiff.diff(testDir, manifest, 'implemented');
    expect(diff.empty.map((f) => f.path)).toContain('src/a.ts');
  });

  it('requeues missing files back to planned status', () => {
    const mutableManifest = JSON.parse(JSON.stringify(manifest)) as FileManifest;
    mutableManifest.files[0].status = 'skeleton';
    mutableManifest.files[1].status = 'skeleton';

    ManifestDiff.requeueMissing(mutableManifest, ['src/a.ts'], 'planned');
    expect(mutableManifest.files[0].status).toBe('planned');
    expect(mutableManifest.files[1].status).toBe('skeleton');
  });
});
