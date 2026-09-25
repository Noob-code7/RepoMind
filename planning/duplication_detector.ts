/**
 * planning/duplication_detector.ts
 * Scans repository context for existing utilities, services, and models to prevent duplicate abstractions.
 * Guides the Planner to mandate REUSE and modification rather than creation.
 */
import { RepositoryContext } from '../context/schemas.js';

export interface ReuseOpportunity {
  concept: string;
  existingFile: string;
  existingSymbols: string[];
  recommendation: string;
}

export class DuplicationDetector {
  /**
   * Search repository context for existing components matching PRD requirements.
   */
  static detectOpportunities(
    prdText: string,
    context: RepositoryContext,
  ): ReuseOpportunity[] {
    const opportunities: ReuseOpportunity[] = [];
    const lowerPrd = prdText.toLowerCase();

    const domainPatterns = [
      { name: 'validation', terms: ['validat', 'schema', 'input check'] },
      { name: 'authentication', terms: ['auth', 'login', 'token', 'jwt', 'session', 'oauth'] },
      { name: 'database', terms: ['db', 'database', 'repository', 'model', 'store'] },
      { name: 'logging', terms: ['log', 'logger', 'telemetry'] },
      { name: 'http / api', terms: ['client', 'fetch', 'request', 'api'] },
      { name: 'encryption / hash', terms: ['hash', 'crypto', 'password', 'bcrypt'] },
    ];

    for (const pattern of domainPatterns) {
      const prdMentions = pattern.terms.some((t) => lowerPrd.includes(t));
      if (!prdMentions) continue;

      // Check if repo already has files matching this domain
      for (const file of context.files) {
        const lowerPath = file.path.toLowerCase();
        const matchesFile = pattern.terms.some((t) => lowerPath.includes(t));
        if (matchesFile && file.type === 'source') {
          const matchingSymbols = context.symbols
            .filter((s) => s.file === file.path)
            .map((s) => s.name);

          opportunities.push({
            concept: pattern.name,
            existingFile: file.path,
            existingSymbols: matchingSymbols,
            recommendation:
              `REUSE EXISTING MODULE: The repository already contains "${file.path}" for ${pattern.name}. ` +
              `Extend or modify this existing file rather than creating a duplicate abstraction.`,
          });
          break; // One primary match per pattern
        }
      }
    }

    return opportunities;
  }
}
