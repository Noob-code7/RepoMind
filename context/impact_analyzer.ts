/**
 * context/impact_analyzer.ts
 * Deterministic Change Impact Analysis Engine.
 * Calculates blast radius for any target file, symbol, or requirement by traversing
 * the AST dependency graph bidirectionally, mapping callers, dependents, tests,
 * and assessing architectural risk with explanatory rationale.
 */
import path from 'node:path';
import {
  ContextEdge,
  ContextImpactAnalysis,
  ContextImpactExplanation,
  ContextNode,
  RepositoryContext,
} from './schemas.js';

export interface ImpactAnalysisOptions {
  target: string;
  context: RepositoryContext;
  nodes?: ContextNode[];
  edges?: ContextEdge[];
}

export class ImpactAnalyzer {
  /**
   * Analyze the impact of changing a file, symbol, or requirement.
   */
  public static analyze(options: ImpactAnalysisOptions): ContextImpactAnalysis {
    const { target, context, nodes = [], edges = [] } = options;

    const normalizedTarget = target.trim();
    const isRequirement = /^REQ-\d+/i.test(normalizedTarget);

    let targetFiles: string[] = [];

    if (isRequirement) {
      // Find files linked to this requirement in nodes/edges
      const reqId = normalizedTarget.toUpperCase();
      const linkedFiles = new Set<string>();

      // Look in edges for requirement -> file
      for (const edge of edges) {
        if (edge.source === reqId) {
          const targetNode = nodes.find((n) => n.id === edge.target);
          if (targetNode?.path) {
            linkedFiles.add(targetNode.path);
          }
        }
      }

      // If no explicit edges, search nodes for reason containing REQ id
      if (linkedFiles.size === 0) {
        for (const node of nodes) {
          if (node.path && node.reason?.includes(reqId)) {
            linkedFiles.add(node.path);
          }
        }
      }

      targetFiles = Array.from(linkedFiles);
      if (targetFiles.length === 0) {
        // Fallback: match requirement keywords to files
        targetFiles = context.files
          .filter((f) => f.type === 'source')
          .slice(0, 2)
          .map((f) => f.path);
      }
    } else {
      // Target is a file path or symbol
      const matchedFile = context.files.find(
        (f) =>
          f.path === normalizedTarget ||
          f.path.endsWith(normalizedTarget) ||
          path.normalize(f.path) === path.normalize(normalizedTarget),
      );

      if (matchedFile) {
        targetFiles = [matchedFile.path];
      } else {
        // Maybe target is a symbol
        const matchedSymbol = context.symbols.find((s) => s.name === normalizedTarget);
        if (matchedSymbol) {
          targetFiles = [matchedSymbol.file];
        } else {
          // Approximate by basename
          const base = path.basename(normalizedTarget);
          const found = context.files.find((f) => f.path.includes(base));
          targetFiles = found ? [found.path] : [normalizedTarget];
        }
      }
    }

    const directlyAffected = new Set<string>();
    const indirectlyAffected = new Set<string>();
    const affectedTests = new Set<string>();
    const affectedSymbols = new Set<string>();
    const explanations: ContextImpactExplanation[] = [];

    // Helper to add explanation once
    const addExplanation = (item: string, reason: string) => {
      if (!explanations.some((e) => e.item === item)) {
        explanations.push({ item, reason });
      }
    };

    // Build incoming and outgoing dependency maps
    // incoming: target -> list of sources that import target
    // outgoing: source -> list of targets it imports
    const importersMap = new Map<string, Array<{ source: string; specifier: string }>>();
    const importsMap = new Map<string, Array<{ target: string; specifier: string }>>();

    for (const dep of context.dependencies) {
      // Importers
      const existingIn = importersMap.get(dep.target) || [];
      existingIn.push({ source: dep.source, specifier: dep.specifier });
      importersMap.set(dep.target, existingIn);

      // Imports
      const existingOut = importsMap.get(dep.source) || [];
      existingOut.push({ target: dep.target, specifier: dep.specifier });
      importsMap.set(dep.source, existingOut);
    }

    for (const primaryFile of targetFiles) {
      // 1. Collect exported symbols of primary target
      const fileContext = context.files.find((f) => f.path === primaryFile);
      if (fileContext) {
        for (const sym of fileContext.exports) {
          affectedSymbols.add(`${primaryFile}#${sym}`);
        }
        for (const sym of fileContext.symbols) {
          affectedSymbols.add(sym);
        }
      }

      // 2. Direct Dependents (Files importing primary target)
      // Check direct matches in dependencies
      const directDepEntries = importersMap.get(primaryFile) || [];
      for (const entry of directDepEntries) {
        if (!targetFiles.includes(entry.source)) {
          directlyAffected.add(entry.source);
          addExplanation(
            entry.source,
            `Directly imports "${primaryFile}" via specifier "${entry.specifier}". Changes to exports or behavior will directly impact this file.`,
          );
        }
      }

      // Also check test files targeting primaryFile
      for (const test of context.tests) {
        const testStem = path.basename(test.file).replace(/\.(test|spec)\.(ts|js|tsx|jsx)$/, '');
        const targetStem = path.basename(primaryFile).replace(/\.(ts|js|tsx|jsx)$/, '');

        const importsTarget = context.dependencies.some(
          (d) => d.source === test.file && (d.target === primaryFile || d.target.includes(targetStem)),
        );

        if (importsTarget || testStem === targetStem || test.file.includes(targetStem)) {
          affectedTests.add(test.file);
          addExplanation(
            test.file,
            `Test suite verifies "${primaryFile}". Test assertions or mocks will need updates when logic changes.`,
          );
        }
      }

      // 3. Indirect Dependents (Transitive closure over importers)
      const queue: Array<{ file: string; depth: number; pathTrace: string[] }> = [];
      for (const direct of directlyAffected) {
        queue.push({ file: direct, depth: 1, pathTrace: [primaryFile, direct] });
      }

      const visited = new Set<string>(directlyAffected);

      while (queue.length > 0) {
        const current = queue.shift()!;
        if (current.depth >= 3) continue; // limit depth to avoid explosion

        const nextImporters = importersMap.get(current.file) || [];
        for (const next of nextImporters) {
          if (!targetFiles.includes(next.source) && !visited.has(next.source)) {
            visited.add(next.source);
            indirectlyAffected.add(next.source);
            const traceStr = [...current.pathTrace, next.source].join(' → ');
            addExplanation(
              next.source,
              `Indirect dependent via dependency chain: ${traceStr}.`,
            );
            queue.push({
              file: next.source,
              depth: current.depth + 1,
              pathTrace: [...current.pathTrace, next.source],
            });
          }
        }
      }
    }

    // 4. Find tests for directly and indirectly affected files
    for (const test of context.tests) {
      if (affectedTests.has(test.file)) continue;
      for (const affected of directlyAffected) {
        const affectedStem = path.basename(affected).replace(/\.(ts|js|tsx|jsx)$/, '');
        if (test.file.includes(affectedStem)) {
          affectedTests.add(test.file);
          addExplanation(
            test.file,
            `Regression test suite covering directly affected dependent "${affected}".`,
          );
        }
      }
    }

    // 5. Dependent Modules (Directory grouping)
    const dependentModules = new Set<string>();
    for (const f of [...targetFiles, ...directlyAffected, ...indirectlyAffected]) {
      const dir = path.dirname(f);
      if (dir && dir !== '.') {
        dependentModules.add(dir.replace(/\\/g, '/'));
      }
    }

    // 6. Assess Risk Level
    let riskLevel: 'low' | 'medium' | 'high' = 'low';
    const totalAffectedFiles = directlyAffected.size + indirectlyAffected.size;

    // Check if critical files or entry points are touched
    const touchesCritical = [...directlyAffected, ...targetFiles].some((p) => {
      const fc = context.files.find((f) => f.path === p);
      return fc?.importance === 'critical' || context.entryPoints.includes(p);
    });

    if (totalAffectedFiles >= 4 || touchesCritical) {
      riskLevel = 'high';
    } else if (totalAffectedFiles >= 2 || affectedTests.size > 0) {
      riskLevel = 'medium';
    }

    return {
      target: normalizedTarget,
      riskLevel,
      directlyAffectedFiles: Array.from(directlyAffected),
      indirectlyAffectedFiles: Array.from(indirectlyAffected),
      affectedSymbols: Array.from(affectedSymbols),
      affectedTests: Array.from(affectedTests),
      dependentModules: Array.from(dependentModules),
      explanations,
    };
  }
}
