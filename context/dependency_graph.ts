/**
 * context/dependency_graph.ts
 * Builds inter-file dependency graph and classifies internal vs external imports.
 */
import path from 'node:path';
import { DependencyEdge, FileContext } from './schemas.js';

export class DependencyGraphBuilder {
  /**
   * Build dependency edges from file import specifiers.
   */
  static buildEdges(
    files: FileContext[],
    allFilePaths: string[],
  ): {
    edges: DependencyEdge[];
    fileDependenciesMap: Map<string, string[]>;
  } {
    const filePathSet = new Set(allFilePaths.map((p) => path.normalize(p).replace(/\\/g, '/')));
    const edges: DependencyEdge[] = [];
    const fileDependenciesMap = new Map<string, string[]>();

    for (const file of files) {
      const internalDeps: string[] = [];
      const dir = path.dirname(file.path);

      for (const specifier of file.imports) {
        const isRelative = specifier.startsWith('./') || specifier.startsWith('../');

        if (!isRelative) {
          edges.push({
            source: file.path,
            target: specifier,
            specifier,
            isExternal: true,
          });
          continue;
        }

        // Resolve relative import to internal repo file
        const resolved = DependencyGraphBuilder.resolveRelativePath(
          dir,
          specifier,
          filePathSet,
        );

        if (resolved) {
          internalDeps.push(resolved);
          edges.push({
            source: file.path,
            target: resolved,
            specifier,
            isExternal: false,
          });
        } else {
          edges.push({
            source: file.path,
            target: specifier,
            specifier,
            isExternal: false,
          });
        }
      }

      fileDependenciesMap.set(file.path, internalDeps);
      file.relatedFiles = Array.from(new Set([...file.relatedFiles, ...internalDeps]));
    }

    return { edges, fileDependenciesMap };
  }

  private static resolveRelativePath(
    fromDir: string,
    specifier: string,
    fileSet: Set<string>,
  ): string | null {
    // Clean extension if present (.js/.ts/.tsx)
    const base = path.join(fromDir, specifier).replace(/\\/g, '/');
    const candidates = [
      base,
      base.replace(/\.js$/, '.ts'),
      base.replace(/\.js$/, '.tsx'),
      base.replace(/\.mjs$/, '.ts'),
      `${base}.ts`,
      `${base}.tsx`,
      `${base}.js`,
      `${base}/index.ts`,
      `${base}/index.js`,
    ];

    for (const cand of candidates) {
      const normalized = path.normalize(cand).replace(/\\/g, '/');
      if (fileSet.has(normalized)) {
        return normalized;
      }
    }

    return null;
  }
}
