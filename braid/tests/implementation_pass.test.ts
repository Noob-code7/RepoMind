import { describe, expect, it } from 'vitest';
import { validateImplementation } from '../agents/executor/implementation_pass.js';

const entry = {
  path: 'src/a.ts',
  purpose: 'a',
  expectedExports: ['greet'],
  dependencies: [],
  status: 'implemented' as const,
};

describe('validateImplementation', () => {
  it('accepts source that preserves all expected exports', () => {
    expect(() =>
      validateImplementation(entry, 'export function greet(): string { return "hi"; }\n'),
    ).not.toThrow();
  });

  it('rejects skeleton-pass JSON protocol echoes', () => {
    const echo = JSON.stringify({
      files: [{ path: 'src/a.ts', code: 'export function greet(): string { return "hi"; }' }],
    });
    expect(() => validateImplementation(entry, echo)).toThrow(/Protocol echo/);
  });

  it('rejects output that drops expected exports', () => {
    expect(() =>
      validateImplementation(entry, 'export function other(): string { return "x"; }\n'),
    ).toThrow(/dropped expected exports: greet/);
  });

  it('rejects empty output', () => {
    expect(() => validateImplementation(entry, '   \n')).toThrow(/Empty output/);
  });
});
