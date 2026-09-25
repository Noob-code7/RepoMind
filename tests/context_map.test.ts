/**
 * tests/context_map.test.ts
 * Comprehensive test suite for Braid Context Map (3-Layer Semantic Context Graph).
 *
 * Verifies:
 *  1. Simple repository mapping (repository-wide)
 *  2. PRD-aware relevance
 *  3. Dependency expansion
 *  4. Requirement → file traceability
 *  5. File → symbol mapping
 *  6. Test detection
 *  7. Context gaps detection
 *  8. Change impact analysis
 *  9. Low-confidence relevance
 *  10. Repository change detection
 */
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { ContextMapBuilder } from '../context/context_map.js';
import { ImpactAnalyzer } from '../context/impact_analyzer.js';
import { buildRepositoryContext } from '../context/mapper.js';
import { renderContextMap } from '../context/renderer.js';
import { ContextMapSchema } from '../context/schemas.js';

describe('Braid Context Map Subsystem', () => {
  const fixtureRoot = path.resolve('tests/fixtures/context-map-fixture');
  const prdPath = path.resolve(fixtureRoot, 'PRD.md');
  const prdContent = fs.readFileSync(prdPath, 'utf-8');

  // 1. Simple repository mapping
  it('1. builds repository-wide context map when no PRD is provided', async () => {
    const contextMap = await ContextMapBuilder.generate({
      root: fixtureRoot,
    });

    expect(contextMap).toBeDefined();
    expect(ContextMapSchema.safeParse(contextMap).success).toBe(true);
    expect(contextMap.requirements.length).toBe(0);
    expect(contextMap.relevantFiles.length).toBeGreaterThan(0);
    expect(contextMap.nodes.some((n) => n.type === 'file')).toBe(true);
    expect(contextMap.nodes.some((n) => n.type === 'symbol')).toBe(true);
    expect(contextMap.confidence).toBeGreaterThan(0.7);
  });

  // 2. PRD-aware relevance
  it('2. builds PRD-aware context map connecting requirements to codebase', async () => {
    const contextMap = await ContextMapBuilder.generate({
      root: fixtureRoot,
      prdContent,
    });

    expect(contextMap.requirements.length).toBe(5);
    const reqIds = contextMap.requirements.map((r) => r.id);
    expect(reqIds).toContain('REQ-001');
    expect(reqIds).toContain('REQ-002');
    expect(reqIds).toContain('REQ-003');
    expect(reqIds).toContain('REQ-004');

    // Authentication files identified
    const hasAuthFile = contextMap.relevantFiles.some((f) => f.includes('auth.service'));
    expect(hasAuthFile).toBe(true);

    // Task management files identified
    const hasTaskFile = contextMap.relevantFiles.some((f) => f.includes('task.service'));
    expect(hasTaskFile).toBe(true);
  });

  // 3. Dependency expansion
  it('3. expands dependencies to include shared utilities and config', async () => {
    const contextMap = await ContextMapBuilder.generate({
      root: fixtureRoot,
      prdContent,
    });

    // auth.service depends on config/env and utils/validation
    const depEdges = contextMap.edges.filter((e) => e.type === 'depends_on');
    expect(depEdges.length).toBeGreaterThan(0);

    const hasValidationDep = contextMap.nodes.some(
      (n) => n.path?.includes('validation.ts'),
    );
    expect(hasValidationDep).toBe(true);
  });

  // 4. Requirement → file traceability
  it('4. establishes explicit Requirement → File → Symbol traceability', async () => {
    const contextMap = await ContextMapBuilder.generate({
      root: fixtureRoot,
      prdContent,
    });

    // Trace REQ-001 (Task Creation) to task.service.ts
    const taskEdges = contextMap.edges.filter((e) => e.source === 'REQ-001');
    expect(taskEdges.length).toBeGreaterThan(0);

    const targets = taskEdges.map((e) => e.target);
    const hasTaskTarget = targets.some((t) => t.includes('task.service'));
    expect(hasTaskTarget).toBe(true);

    // Trace REQ-002 (Authentication) to auth.service.ts
    const authEdges = contextMap.edges.filter((e) => e.source === 'REQ-002');
    expect(authEdges.length).toBeGreaterThan(0);
    const authTargets = authEdges.map((e) => e.target);
    const hasAuthTarget = authTargets.some((t) => t.includes('auth.service'));
    expect(hasAuthTarget).toBe(true);
  });

  // 5. File → symbol mapping
  it('5. maps files to concrete AST symbols and exported interfaces', async () => {
    const contextMap = await ContextMapBuilder.generate({
      root: fixtureRoot,
      prdContent,
    });

    const symbolNodes = contextMap.nodes.filter((n) => n.type === 'symbol');
    const symbolNames = symbolNodes.map((s) => s.name);

    expect(symbolNames).toContain('AuthService');
    expect(symbolNames).toContain('TaskService');
    expect(symbolNames).toContain('validateNonEmptyString');
  });

  // 6. Test detection
  it('6. discovers and associates test suites with target modules', async () => {
    const contextMap = await ContextMapBuilder.generate({
      root: fixtureRoot,
      prdContent,
    });

    expect(contextMap.affectedTests.length).toBeGreaterThanOrEqual(2);
    expect(contextMap.affectedTests.some((t) => t.includes('task.service.test.ts'))).toBe(true);
    expect(contextMap.affectedTests.some((t) => t.includes('auth.test.ts'))).toBe(true);

    // Verify tested_by edges
    const testEdges = contextMap.edges.filter((e) => e.type === 'tested_by');
    expect(testEdges.length).toBeGreaterThan(0);
  });

  // 7. Context gaps
  it('7. explicitly detects missing context (unimplemented email requirement)', async () => {
    const contextMap = await ContextMapBuilder.generate({
      root: fixtureRoot,
      prdContent,
    });

    expect(contextMap.contextGaps.length).toBeGreaterThan(0);

    // REQ-004 specifies email notification, but no email service exists
    const emailGap = contextMap.contextGaps.find(
      (g) => g.type === 'missing_implementation' && g.affectedArea.includes('Email'),
    );
    expect(emailGap).toBeDefined();
    expect(emailGap?.severity).toBe('high');
    expect(emailGap?.confidence).toBeLessThanOrEqual(0.4);
  });

  // 8. Impact analysis
  it('8. calculates blast radius, callers, dependents, and risk rating for file changes', async () => {
    const repoContext = await buildRepositoryContext({ root: fixtureRoot });

    const impact = ImpactAnalyzer.analyze({
      target: 'src/auth/auth.service.ts',
      context: repoContext,
    });

    expect(impact.target).toBe('src/auth/auth.service.ts');
    // auth.middleware directly imports auth.service
    expect(impact.directlyAffectedFiles).toContain('src/auth/auth.middleware.ts');
    // tests/auth.test.ts verifies auth.service
    expect(impact.affectedTests).toContain('tests/auth.test.ts');
    // Symbols affected
    expect(impact.affectedSymbols.some((s) => s.includes('AuthService'))).toBe(true);
    // Explanations provided
    expect(impact.explanations.length).toBeGreaterThan(0);
    expect(impact.explanations.some((e) => e.item.includes('auth.middleware'))).toBe(true);
    expect(['medium', 'high']).toContain(impact.riskLevel);
  });

  // 9. Low-confidence relevance
  it('9. flags ambiguities and adjusts confidence for vague requirements', async () => {
    const contextMap = await ContextMapBuilder.generate({
      root: fixtureRoot,
      prdContent,
    });

    // REQ-005 contains vague wording ("should be fast and scale gracefully under load etc")
    const req005 = contextMap.requirements.find((r) => r.id === 'REQ-005');
    expect(req005).toBeDefined();
    expect(req005?.ambiguities.length).toBeGreaterThan(0);

    const node005 = contextMap.nodes.find((n) => n.id === 'REQ-005');
    expect(node005?.confidence).toBeLessThan(0.8);
  });

  // 10. Repository change detection
  it('10. detects repository changes when files change after Context Map generation', async () => {
    const tmpBraid = path.resolve(fixtureRoot, '.braid');
    if (!fs.existsSync(tmpBraid)) {
      fs.mkdirSync(tmpBraid, { recursive: true });
    }

    const contextMap = await ContextMapBuilder.generate({
      root: fixtureRoot,
      prdContent,
    });

    // Save context map
    ContextMapBuilder.save(fixtureRoot, contextMap);

    // Current context matches saved context
    const currentContext = await buildRepositoryContext({ root: fixtureRoot });
    const loadedMatch = ContextMapBuilder.load(fixtureRoot, currentContext);
    expect(loadedMatch).toBeDefined();
    expect(loadedMatch?.repositoryChanged).toBe(false);

    // Simulate repository modification by adding an ephemeral mock file
    const simulatedContext = {
      ...currentContext,
      files: [
        ...currentContext.files,
        {
          path: 'src/ephemeral.ts',
          type: 'source' as const,
          exports: ['ephemeralFeature'],
          imports: [],
          symbols: ['ephemeralFeature'],
          importance: 'medium' as const,
          relatedFiles: [],
        },
      ],
    };

    const loadedChanged = ContextMapBuilder.load(fixtureRoot, simulatedContext);
    expect(loadedChanged).toBeDefined();
    expect(loadedChanged?.repositoryChanged).toBe(true);
    expect(loadedChanged?.warning).toContain('Repository changed since Context Map was generated');

    // Clean up test .braid artifacts
    if (fs.existsSync(path.join(tmpBraid, 'context.json'))) {
      fs.unlinkSync(path.join(tmpBraid, 'context.json'));
    }
  });

  // Bonus: Terminal Rendering check
  it('renders clean visual terminal hierarchy adhering to Braid design palette', async () => {
    const contextMap = await ContextMapBuilder.generate({
      root: fixtureRoot,
      prdContent,
      impactTarget: 'src/auth/auth.service.ts',
    });

    const rendered = renderContextMap(contextMap);
    expect(rendered).toContain('PRD → Context');
    expect(rendered).toContain('files scanned');
    expect(rendered).toContain('Context confidence:');
    expect(rendered).toContain('Change Impact Analysis');
    expect(rendered).toContain('Context Gaps Detected');
  });
});
