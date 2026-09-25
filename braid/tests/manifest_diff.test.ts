import { describe, expect, it } from 'vitest';
import type { FileManifest } from '../shared/types.js';
import {
  diffManifest,
  getMissingFiles,
  statusCompleteness,
} from '../orchestrator/manifest_diff.js';

function manifest(paths: string[]): FileManifest {
  return {
    project: 'demo',
    files: paths.map((p) => ({
      path: p,
      purpose: p,
      expectedExports: [],
      dependencies: [],
      status: 'planned' as const,
    })),
  };
}

describe('manifest_diff', () => {
  it('reports complete when all planned files are written', () => {
    const m = manifest(['src/a.ts', 'src/b.ts']);
    const d = diffManifest(m, ['src/a.ts', 'src/b.ts']);
    expect(d.complete).toBe(true);
    expect(d.missing).toEqual([]);
    expect(d.extra).toEqual([]);
    expect(d.completeness).toBe(100);
  });

  it('requeues missing files and ignores duplicate written entries', () => {
    const m = manifest(['src/a.ts', 'src/b.ts', 'src/c.ts']);
    const d = diffManifest(m, ['src/a.ts', 'src/a.ts']);
    expect(d.complete).toBe(false);
    expect(d.missing).toEqual(['src/b.ts', 'src/c.ts']);
    expect(getMissingFiles(m, ['src/a.ts'])).toEqual(['src/b.ts', 'src/c.ts']);
    expect(d.completeness).toBeCloseTo(33.33, 1);
  });

  it('flags extra files not in the manifest', () => {
    const m = manifest(['src/a.ts']);
    const d = diffManifest(m, ['src/a.ts', 'src/drift.ts']);
    expect(d.complete).toBe(true);
    expect(d.extra).toEqual(['src/drift.ts']);
  });

  it('normalizes ./ prefixes and backslashes', () => {
    const m = manifest(['src/a.ts']);
    const d = diffManifest(m, ['.\\src\\a.ts']);
    expect(d.complete).toBe(true);
  });

  it('statusCompleteness counts only implemented/verified', () => {
    const m = manifest(['a.ts', 'b.ts', 'c.ts', 'd.ts']);
    m.files[0]!.status = 'implemented';
    m.files[1]!.status = 'verified';
    m.files[2]!.status = 'skeleton';
    expect(statusCompleteness(m)).toBe(50);
  });
});
