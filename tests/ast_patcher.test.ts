/**
 * tests/ast_patcher.test.ts
 * Verifies AST-aware, block-level and function-level targeted patching.
 */
import { describe, expect, it } from 'vitest';
import { AstPatcher } from '../agents/executor/ast_patcher.js';

describe('AstPatcher', () => {
  it('patches explicit <braid:block> tagged comments without touching surrounding code', () => {
    const original = `import { foo } from './foo.js';

// <braid:block name="calculateTotal">
export function calculateTotal(items: number[]): number {
  return 0;
}
// </braid:block>

export function otherFunction(): string {
  return 'untouched';
}
`;

    const replacement = `export function calculateTotal(items: number[]): number {
  return items.reduce((sum, n) => sum + n, 0);
}`;

    const res = AstPatcher.patch(original, {
      path: 'src/calc.ts',
      anchor: 'calculateTotal',
      replacement,
      reason: 'Implement summation',
    });

    expect(res.success).toBe(true);
    expect(res.strategy).toBe('block_comment');
    expect(res.patched).toContain('items.reduce');
    expect(res.patched).toContain('otherFunction');
    expect(res.patched).toContain("return 'untouched'");
  });

  it('patches a function declaration by matching balanced braces', () => {
    const original = `export function greet(name: string): string {
  if (!name) {
    return 'Anonymous';
  }
  return 'Hello ' + name;
}

export function untouched(): boolean {
  return true;
}
`;

    const replacement = `export function greet(name: string): string {
  return \`Welcome, \${name || 'Guest'}!\`;
}`;

    const res = AstPatcher.patch(original, {
      path: 'src/greet.ts',
      anchor: 'greet',
      replacement,
      reason: 'Update greeting message',
    });

    expect(res.success).toBe(true);
    expect(res.strategy).toBe('function_declaration');
    expect(res.patched).toContain('Welcome, ${name ||');
    expect(res.patched).toContain('untouched(): boolean');
  });

  it('falls back to append if function does not exist yet', () => {
    const original = `export const VERSION = '1.0.0';\n`;
    const replacement = `export function newFeature(): string { return 'new'; }`;

    const res = AstPatcher.patch(original, {
      path: 'src/feature.ts',
      anchor: 'newFeature',
      replacement,
      reason: 'Add feature',
    });

    expect(res.success).toBe(true);
    expect(res.strategy).toBe('append');
    expect(res.patched).toContain("VERSION = '1.0.0'");
    expect(res.patched).toContain('newFeature(): string');
  });
});
