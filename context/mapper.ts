/**
 * context/mapper.ts
 * Main entry point for the deterministic Repository Context Mapping pipeline.
 * Coordinates scanner, AST analysis, dependency graph, test detector, and git analyzer.
 */
import fs from 'node:fs';
import path from 'node:path';
import { AstAnalyzer } from './ast_analyzer.js';
import { DependencyGraphBuilder } from './dependency_graph.js';
import { GitAnalyzer } from './git_analyzer.js';
import { RepositoryScanner } from './scanner.js';
import {
  ArchitectureSummary,
  Convention,
  RepositoryContext,
  SymbolContext,
} from './schemas.js';
import { TestDetector } from './test_detector.js';

export interface BuildContextOptions {
  root: string;
}

export async function buildRepositoryContext(
  options: BuildContextOptions,
): Promise<RepositoryContext> {
  const root = path.resolve(options.root);

  // 1. File Discovery & Metadata Detection
  const { metadata, files } = RepositoryScanner.scan(root);
  const allPaths = files.map((f) => f.path);

  // 2. AST Static Analysis for TypeScript & JavaScript Files
  const allSymbols: SymbolContext[] = [];

  for (const file of files) {
    if (file.language === 'typescript' || file.language === 'javascript') {
      const fullPath = path.join(root, file.path);
      try {
        const sourceText = fs.readFileSync(fullPath, 'utf-8');
        const astResult = AstAnalyzer.analyze(file.path, sourceText);

        file.imports = astResult.imports;
        file.exports = astResult.exports;
        file.symbols = astResult.symbols.map((s) => s.name);
        file.summary = astResult.summary;

        allSymbols.push(...astResult.symbols);
      } catch {
        // Fallback for unparseable syntax
      }
    }
  }

  // 3. Inter-File Dependency Resolution
  const { edges } = DependencyGraphBuilder.buildEdges(files, allPaths);

  // 4. Test Discovery & Analysis
  const testFiles = files.filter((f) => f.type === 'test').map((f) => f.path);
  const tests = TestDetector.analyzeTestFiles(root, testFiles);

  // 5. Read-only Git State
  const git = GitAnalyzer.analyze(root);

  // 6. Architecture & Entry Points Synthesis
  const entryPoints: string[] = files
    .filter((f) => f.importance === 'critical' && f.type === 'source')
    .map((f) => f.path);

  const architecture: ArchitectureSummary = synthesizeArchitecture(
    files,
    metadata.frameworks,
  );

  // 7. Convention Detection
  const conventions: Convention[] = detectConventions(files, tests);

  return {
    repository: metadata,
    files,
    symbols: allSymbols,
    dependencies: edges,
    tests,
    entryPoints,
    architecture,
    conventions,
    git,
  };
}

function synthesizeArchitecture(
  files: Array<{ path: string; type: string }>,
  frameworks: string[],
): ArchitectureSummary {
  const layers: string[] = [];

  const hasRoutes = files.some((f) => f.path.includes('/routes/') || f.path.includes('api/'));
  const hasControllers = files.some((f) => f.path.includes('/controllers/'));
  const hasServices = files.some((f) => f.path.includes('/services/'));
  const hasModels = files.some((f) => f.path.includes('/models/') || f.path.includes('/db/'));
  const hasComponents = files.some((f) => f.path.includes('/components/'));

  if (hasComponents) layers.push('Presentation (Components)');
  if (hasRoutes) layers.push('Routing / API');
  if (hasControllers) layers.push('Controllers');
  if (hasServices) layers.push('Domain Services');
  if (hasModels) layers.push('Data Models / Database');

  if (layers.length === 0) {
    layers.push('Modular Utilities');
  }

  const pattern = frameworks.includes('Express')
    ? 'Layered Express API (Routes → Controllers → Services)'
    : frameworks.includes('React')
    ? 'Component-Based SPA (Components → Hooks → Services)'
    : 'Modular Architecture';

  return {
    pattern,
    layers,
    entryPoints: [],
    dataFlowSummary: `${layers.join(' → ')} with deterministic boundaries`,
  };
}

function detectConventions(
  files: Array<{ path: string; language?: string }>,
  tests: Array<{ file: string; framework?: string }>,
): Convention[] {
  const conventions: Convention[] = [];

  // File naming convention
  const tsFiles = files.filter((f) => f.path.endsWith('.ts') && !f.path.includes('.test.'));
  const isKebab = tsFiles.some((f) => /^[a-z0-9]+-[a-z0-9]+/.test(path.basename(f.path)));
  const isSnake = tsFiles.some((f) => /^[a-z0-9]+_[a-z0-9]+/.test(path.basename(f.path)));

  conventions.push({
    category: 'naming',
    pattern: isSnake ? 'snake_case' : isKebab ? 'kebab-case' : 'mixed / standard',
    description: `Source files follow ${isSnake ? 'snake_case' : isKebab ? 'kebab-case' : 'standard'} naming convention.`,
    examples: tsFiles.slice(0, 3).map((f) => f.path),
  });

  // Test naming convention
  if (tests.length > 0) {
    const usesTestSuffix = tests.some((t) => t.file.includes('.test.ts'));
    const usesSpecSuffix = tests.some((t) => t.file.includes('.spec.ts'));

    conventions.push({
      category: 'testing',
      pattern: usesTestSuffix ? '*.test.ts' : usesSpecSuffix ? '*.spec.ts' : 'custom test structure',
      description: 'Test files are co-located or placed in test/ with standard suffixes.',
      examples: tests.slice(0, 3).map((t) => t.file),
    });
  }

  return conventions;
}
