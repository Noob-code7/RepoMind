import { describe, expect, it } from 'vitest';
import { locateAnchor, patchSource } from '../agents/executor/ast_patcher.js';

describe('ast_patcher', () => {
  it('patches one function without touching neighbors', () => {
    const src =
      'export function keep(): number { return 1; }\nexport function fix(): number { return 0; }\n';
    const out = patchSource(src, 'fix', 'export function fix(): number { return 2; }');
    expect(out).toContain('return 1');
    expect(out).toContain('return 2');
    expect(out).not.toContain('return 0');
  });

  it('patches an explicit braid block', () => {
    const src = '// <braid:block name="cfg">\nold\n// </braid:block>\nrest\n';
    const out = patchSource(src, 'cfg', 'new');
    expect(out).toContain('new');
    expect(out).toContain('rest');
    expect(out).not.toContain('old');
  });

  it('throws on unknown anchors and no-op patches', () => {
    expect(() => locateAnchor('export const x = 1;\n', 'nope')).toThrow();
    const src = 'export function f(): number { return 1; }\n';
    expect(() =>
      patchSource(src, 'f', 'export function f(): number { return 1; }'),
    ).toThrow();
  });
});
