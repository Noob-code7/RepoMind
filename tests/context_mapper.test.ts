/**
 * tests/context_mapper.test.ts
 * Unit tests for repository scanning, AST symbol extraction, dependency mapping, and test discovery.
 */
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { CodebaseDigestBuilder } from '../context/digest.js';
import { buildRepositoryContext } from '../context/mapper.js';
import { RepositoryScanner } from '../context/scanner.js';

describe('Context Mapper Subsystem', () => {
  const fixtureRoot = path.resolve('tests/fixtures/task-manager');

  it('scans files, detects languages, and categorizes types correctly', () => {
    const { metadata, files } = RepositoryScanner.scan(fixtureRoot);

    expect(metadata.name).toBe('fixture-task-manager');
    expect(metadata.languages).toContain('TypeScript');
    expect(metadata.frameworks).toContain('Express');
    expect(metadata.testFramework).toBe('vitest');

    const paths = files.map((f) => f.path);
    expect(paths).toContain('src/index.ts');
    expect(paths).toContain('src/services/task.service.ts');
    expect(paths).toContain('src/utils/validation.ts');
    expect(paths).toContain('tests/task.service.test.ts');

    const testFile = files.find((f) => f.path.includes('task.service.test.ts'));
    expect(testFile?.type).toBe('test');
  });

  it('builds complete RepositoryContext with AST symbols and dependency edges', async () => {
    const context = await buildRepositoryContext({ root: fixtureRoot });

    expect(context.repository.name).toBe('fixture-task-manager');
    expect(context.files.length).toBeGreaterThanOrEqual(4);

    // Verify Symbol Extraction
    const symbolNames = context.symbols.map((s) => s.name);
    expect(symbolNames).toContain('validateNonEmptyString');
    expect(symbolNames).toContain('validateTaskPriority');
    expect(symbolNames).toContain('TaskService');
    expect(symbolNames).toContain('startApp');

    // Verify Dependency Graph
    const serviceEdge = context.dependencies.find(
      (d) => d.source === 'src/services/task.service.ts' && !d.isExternal,
    );
    expect(serviceEdge).toBeDefined();
    expect(serviceEdge?.target).toBe('src/utils/validation.ts');

    // Verify Test Context
    expect(context.tests.length).toBe(1);
    expect(context.tests[0].file).toBe('tests/task.service.test.ts');
    expect(context.tests[0].framework).toBe('vitest');
    expect(context.tests[0].suites).toContain('TaskService');
    expect(context.tests[0].testCases).toContain('creates and retrieves tasks');

    // Verify Compact Digest
    const digest = CodebaseDigestBuilder.buildDigest(context);
    expect(digest).toContain('REPOSITORY: fixture-task-manager');
    expect(digest).toContain('validateNonEmptyString()');
    expect(digest).toContain('TaskService');
  });
});
