/**
 * context/scanner.ts
 * Deterministic file discovery, language & framework detection, and file categorization.
 */
import fs from 'node:fs';
import path from 'node:path';
import {
  FileContext,
  FileImportance,
  FileType,
  RepositoryMetadata,
} from './schemas.js';

const IGNORED_DIRS = new Set([
  'node_modules',
  '.git',
  'dist',
  'build',
  '.next',
  '.cache',
  'coverage',
  '.gemini',
]);

const EXTENSION_MAP: Record<string, string> = {
  '.ts': 'typescript',
  '.tsx': 'typescript',
  '.js': 'javascript',
  '.jsx': 'javascript',
  '.mjs': 'javascript',
  '.cjs': 'javascript',
  '.json': 'json',
  '.md': 'markdown',
  '.css': 'css',
  '.html': 'html',
  '.yml': 'yaml',
  '.yaml': 'yaml',
  '.sql': 'sql',
  '.sh': 'shell',
};

export class RepositoryScanner {
  /**
   * Scan repository root directory and discover files.
   */
  static scan(root: string): {
    metadata: RepositoryMetadata;
    files: FileContext[];
  } {
    const absRoot = path.resolve(root);
    const discoveredFiles: string[] = [];

    function walk(dir: string) {
      if (!fs.existsSync(dir)) return;
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.name.startsWith('.') && entry.name !== '.env.example') {
          if (IGNORED_DIRS.has(entry.name)) continue;
        }
        if (IGNORED_DIRS.has(entry.name)) continue;

        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          walk(full);
        } else if (entry.isFile()) {
          const rel = path.relative(absRoot, full).replace(/\\/g, '/');
          discoveredFiles.push(rel);
        }
      }
    }

    walk(absRoot);

    const metadata = RepositoryScanner.detectMetadata(absRoot, discoveredFiles);
    const files: FileContext[] = discoveredFiles.map((rel) => {
      const full = path.join(absRoot, rel);
      const stat = fs.statSync(full);
      const ext = path.extname(rel).toLowerCase();
      const language = EXTENSION_MAP[ext] || 'unknown';
      const type = RepositoryScanner.categorizeFileType(rel);
      const importance = RepositoryScanner.determineImportance(rel, type);

      return {
        path: rel,
        type,
        language,
        size: stat.size,
        exports: [],
        imports: [],
        symbols: [],
        importance,
        relatedFiles: [],
      };
    });

    return { metadata, files };
  }

  static categorizeFileType(relPath: string): FileType {
    const lower = relPath.toLowerCase();
    if (
      lower.includes('.test.') ||
      lower.includes('.spec.') ||
      lower.includes('__tests__/') ||
      lower.startsWith('tests/') ||
      lower.startsWith('test/')
    ) {
      return 'test';
    }
    if (
      lower.endsWith('.json') ||
      lower.endsWith('.config.js') ||
      lower.endsWith('.config.ts') ||
      lower.includes('tsconfig') ||
      lower.includes('.env')
    ) {
      return 'config';
    }
    if (lower.endsWith('.md') || lower.endsWith('.txt') || lower.includes('docs/')) {
      return 'documentation';
    }
    if (
      lower.endsWith('.png') ||
      lower.endsWith('.jpg') ||
      lower.endsWith('.svg') ||
      lower.endsWith('.ico')
    ) {
      return 'asset';
    }
    if (
      lower.endsWith('.ts') ||
      lower.endsWith('.tsx') ||
      lower.endsWith('.js') ||
      lower.endsWith('.jsx')
    ) {
      return 'source';
    }
    return 'unknown';
  }

  static determineImportance(relPath: string, type: FileType): FileImportance {
    const lower = relPath.toLowerCase();
    if (
      relPath === 'package.json' ||
      relPath === 'tsconfig.json' ||
      lower.includes('index.ts') ||
      lower.includes('server.ts') ||
      lower.includes('app.ts') ||
      lower.includes('main.ts')
    ) {
      return 'critical';
    }
    if (
      lower.includes('/routes/') ||
      lower.includes('/controllers/') ||
      lower.includes('/services/') ||
      lower.includes('/models/') ||
      lower.includes('/auth/') ||
      lower.includes('/db/') ||
      lower.includes('/database/')
    ) {
      return 'high';
    }
    if (type === 'test' || lower.includes('/utils/') || lower.includes('/components/')) {
      return 'medium';
    }
    return 'low';
  }

  static detectMetadata(root: string, files: string[]): RepositoryMetadata {
    const languages = new Set<string>();
    const frameworks = new Set<string>();
    let packageManager = 'npm';
    let testFramework: string | undefined = undefined;

    // Detect languages
    for (const f of files) {
      if (f.endsWith('.ts') || f.endsWith('.tsx')) languages.add('TypeScript');
      if (f.endsWith('.js') || f.endsWith('.jsx')) languages.add('JavaScript');
      if (f.endsWith('.py')) languages.add('Python');
    }

    // Inspect package.json
    const pkgPath = path.join(root, 'package.json');
    let name = path.basename(root);
    if (fs.existsSync(pkgPath)) {
      try {
        const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
        if (pkg.name) name = pkg.name;
        const allDeps = {
          ...pkg.dependencies,
          ...pkg.devDependencies,
        };

        if (allDeps['react']) frameworks.add('React');
        if (allDeps['express']) frameworks.add('Express');
        if (allDeps['next']) frameworks.add('Next.js');
        if (allDeps['vite']) frameworks.add('Vite');
        if (allDeps['vitest']) testFramework = 'vitest';
        else if (allDeps['jest']) testFramework = 'jest';
      } catch {
        // Fallback
      }
    }

    // Package manager detection
    if (fs.existsSync(path.join(root, 'pnpm-lock.yaml'))) packageManager = 'pnpm';
    else if (fs.existsSync(path.join(root, 'yarn.lock'))) packageManager = 'yarn';
    else if (fs.existsSync(path.join(root, 'bun.lockb'))) packageManager = 'bun';

    return {
      name,
      root,
      languages: Array.from(languages),
      frameworks: Array.from(frameworks),
      packageManager,
      testFramework,
    };
  }
}
