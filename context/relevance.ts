/**
 * context/relevance.ts
 * Context Relevance Engine & Context Gap Detector.
 * Identifies high, medium, test, and unrelated files relative to a PRD.
 * Flags architectural gaps and determines categorical confidence.
 */
import {
  ContextAssessment,
  ContextConfidence,
  ContextGap,
  FileContext,
  RelevantContext,
  RepositoryContext,
  TestContext,
} from './schemas.js';

export class ContextRelevanceEngine {
  /**
   * Determine relevance of repository files and detect context gaps for a PRD.
   */
  static analyzeRelevance(
    prd: string,
    context: RepositoryContext,
  ): RelevantContext {
    const prdKeywords = ContextRelevanceEngine.extractKeywords(prd);

    const highRelevance: FileContext[] = [];
    const mediumRelevance: FileContext[] = [];
    const testRelevance: TestContext[] = [];
    const ignoredPaths: string[] = [];

    const fileMap = new Map<string, FileContext>();
    for (const f of context.files) fileMap.set(f.path, f);

    // 1. Score files based on path name, exported symbols, and keywords
    for (const file of context.files) {
      if (file.type === 'test') continue;

      let score = 0;
      const lowerPath = file.path.toLowerCase();

      for (const kw of prdKeywords) {
        if (lowerPath.includes(kw)) score += 3;
        for (const exp of file.exports) {
          if (exp.toLowerCase().includes(kw)) score += 2;
        }
        for (const sym of file.symbols) {
          if (sym.toLowerCase().includes(kw)) score += 1;
        }
      }

      if (score >= 4 || (file.importance === 'critical' && score >= 2)) {
        highRelevance.push(file);
      } else if (score >= 2 || (file.importance === 'high' && score >= 1)) {
        mediumRelevance.push(file);
      } else {
        ignoredPaths.push(file.path);
      }
    }

    // 2. Add direct dependencies of high relevance files to medium relevance
    for (const highFile of highRelevance) {
      for (const rel of highFile.relatedFiles) {
        const dep = fileMap.get(rel);
        if (
          dep &&
          !highRelevance.includes(dep) &&
          !mediumRelevance.includes(dep) &&
          dep.type !== 'test'
        ) {
          mediumRelevance.push(dep);
          const idx = ignoredPaths.indexOf(dep.path);
          if (idx !== -1) ignoredPaths.splice(idx, 1);
        }
      }
    }

    // 3. Find test files that target high or medium relevance files
    const relevantPaths = new Set([
      ...highRelevance.map((f) => f.path),
      ...mediumRelevance.map((f) => f.path),
    ]);

    for (const test of context.tests) {
      const lowerTest = test.file.toLowerCase();
      let matches = false;
      for (const relPath of relevantPaths) {
        const stem = relPath.replace(/\.(ts|js|tsx|jsx)$/, '').toLowerCase();
        if (lowerTest.includes(pathStem(stem))) {
          matches = true;
          break;
        }
      }
      if (matches) {
        testRelevance.push(test);
      }
    }

    // 4. Detect Context Gaps
    const gaps: ContextGap[] = [];

    // Check if relevant area has test context
    if (highRelevance.length > 0 && testRelevance.length === 0) {
      gaps.push({
        type: 'missing_test_context',
        description: 'No existing test files found covering the target domain modules.',
        affectedArea: 'testing',
        severity: 'medium',
      });
    }

    // Check if PRD mentions database/auth but no relevant files exist
    const mentionsAuth = prdKeywords.has('auth') || prdKeywords.has('login') || prdKeywords.has('oauth');
    const hasAuthFiles = context.files.some((f) => f.path.toLowerCase().includes('auth'));
    if (mentionsAuth && !hasAuthFiles && context.files.length > 0) {
      gaps.push({
        type: 'missing_file',
        description: 'PRD specifies authentication functionality, but repository contains no existing auth modules.',
        affectedArea: 'authentication',
        severity: 'medium',
      });
    }

    // Check for unresolved external dependencies
    const unresolvable = context.dependencies.filter(
      (d) => !d.isExternal && d.target.startsWith('.') && !fileMap.has(d.target),
    );
    if (unresolvable.length > 3) {
      gaps.push({
        type: 'unknown_dependency',
        description: `Found ${unresolvable.length} unresolved relative dependencies in repository.`,
        affectedArea: 'dependencies',
        severity: 'low',
      });
    }

    // 5. Categorical Confidence Assessment
    let confidence: ContextConfidence = 'high';
    const criticalGaps = gaps.filter((g) => g.severity === 'critical');
    const highGaps = gaps.filter((g) => g.severity === 'high');

    if (criticalGaps.length > 0 || context.files.length === 0) {
      confidence = 'low';
    } else if (highGaps.length > 0 || gaps.length >= 3) {
      confidence = 'medium';
    }

    const reasoning = `Context assessment determined ${confidence.toUpperCase()} confidence. ` +
      `Identified ${highRelevance.length} high-relevance and ${mediumRelevance.length} medium-relevance files with ` +
      `${testRelevance.length} existing test suites. Detected ${gaps.length} context gaps.`;

    const assessment: ContextAssessment = {
      confidence,
      relevantFiles: [...highRelevance.map((f) => f.path), ...mediumRelevance.map((f) => f.path)],
      ignoredFiles: ignoredPaths,
      gaps,
      reasoning,
    };

    return {
      assessment,
      relevantFiles: [...highRelevance, ...mediumRelevance],
      digest: context.architecture.dataFlowSummary,
      dependencies: context.dependencies.filter((d) =>
        relevantPaths.has(d.source) || relevantPaths.has(d.target),
      ),
      testContexts: testRelevance,
    };
  }

  private static extractKeywords(prd: string): Set<string> {
    const words = prd
      .toLowerCase()
      .replace(/[^a-z0-9_-]/g, ' ')
      .split(/\s+/)
      .filter((w) => w.length > 3);

    // Stop words
    const stopWords = new Set([
      'this', 'that', 'with', 'from', 'have', 'must', 'should', 'will',
      'when', 'what', 'which', 'where', 'there', 'their', 'create', 'update',
      'user', 'code', 'file', 'build', 'make', 'into', 'each', 'every',
    ]);

    const keywords = new Set<string>();
    for (const w of words) {
      if (!stopWords.has(w)) {
        keywords.add(w);
      }
    }
    return keywords;
  }
}

function pathStem(p: string): string {
  const parts = p.split('/');
  return parts[parts.length - 1];
}
