/**
 * context/digest.ts
 * Builds a compact, structured codebase digest suitable for LLM context injection.
 * Contains repository metadata, architecture summary, and key exported signatures.
 */
import { RepositoryContext, SymbolContext } from './schemas.js';

export class CodebaseDigestBuilder {
  /**
   * Produce a compact human-readable codebase digest.
   */
  static buildDigest(context: RepositoryContext): string {
    const { repository, architecture, files, symbols, tests } = context;

    const stackParts: string[] = [
      ...repository.languages,
      ...repository.frameworks,
    ];
    if (repository.packageManager) stackParts.push(repository.packageManager);
    if (repository.testFramework) stackParts.push(repository.testFramework);
    const stackStr = stackParts.length > 0 ? stackParts.join(' + ') : 'Standard TypeScript/JavaScript';

    const importantFiles = files.filter(
      (f) =>
        f.importance === 'critical' ||
        f.importance === 'high' ||
        f.exports.length > 0,
    );

    const symbolsByFile = new Map<string, SymbolContext[]>();
    for (const sym of symbols) {
      if (!symbolsByFile.has(sym.file)) {
        symbolsByFile.set(sym.file, []);
      }
      symbolsByFile.get(sym.file)!.push(sym);
    }

    const testSummaries: string[] = tests.map((t) => {
      const cases = t.testCases.slice(0, 5).join(', ');
      return `  - ${t.file}: ${t.suites.join(' > ') || 'Tests'} [${cases || 'tests'}]`;
    });

    const fileBlocks: string[] = importantFiles.slice(0, 25).map((f) => {
      const fileSyms = symbolsByFile.get(f.path) || [];
      const exportedSyms = fileSyms.filter((s) => s.exported);

      const routes = fileSyms.filter((s) => s.kind === 'route').map((r) => r.name);
      const funcs = exportedSyms
        .filter((s) => s.kind === 'function' || s.kind === 'service' || s.kind === 'class')
        .map((s) => `${s.name}()`);
      const types = exportedSyms
        .filter((s) => s.kind === 'interface' || s.kind === 'type')
        .map((s) => s.name);

      let details = '';
      if (routes.length > 0) details += `\n    Routes: ${routes.join(', ')}`;
      if (funcs.length > 0) details += `\n    Exports: ${funcs.join(', ')}`;
      if (types.length > 0) details += `\n    Types: ${types.join(', ')}`;

      return `### ${f.path} (${f.importance} importance)${details || '\n    (module definition)'}`;
    });

    return [
      `REPOSITORY: ${repository.name}`,
      `STACK: ${stackStr}`,
      `ARCHITECTURE PATTERN: ${architecture.pattern}`,
      `LAYERS: ${architecture.layers.join(' → ')}`,
      `DATA FLOW: ${architecture.dataFlowSummary}`,
      `ENTRY POINTS: ${context.entryPoints.join(', ') || 'src/index.ts'}`,
      '',
      'IMPORTANT REPOSITORY FILES & EXPORTS:',
      fileBlocks.length > 0 ? fileBlocks.join('\n\n') : '(No high-importance files found)',
      '',
      'EXISTING TEST COVERAGE:',
      testSummaries.length > 0 ? testSummaries.join('\n') : '(No existing tests detected)',
    ].join('\n');
  }
}
