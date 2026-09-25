/**
 * agents/executor/implementation_pass.ts — Pass 2: per-file implementation.
 * Each call gets (a) the file's own skeleton, (b) the full codebase digest,
 * (c) full source of ONLY its direct dependencies. Marks files 'implemented'.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';
import { complete } from '../../shared/llm_client.js';
import type { FileManifestEntry } from '../../shared/types.js';
import { ManifestStore } from '../../orchestrator/manifest_store.js';
import { DigestStore } from '../../orchestrator/digest_store.js';

const PROMPT_PATH = join(
  dirname(fileURLToPath(import.meta.url)),
  'prompts',
  'implementation_prompt.md',
);

export function loadImplementationPrompt(): string {
  return readFileSync(PROMPT_PATH, 'utf8');
}

/** Pure prompt builder — testable without keys. */
export function buildImplementationUserPrompt(args: {
  path: string;
  skeleton: string;
  digestPrompt: string;
  dependencies: Array<{ path: string; source: string }>;
}): string {
  const depSection =
    args.dependencies.length === 0
      ? '(no dependencies)'
      : args.dependencies
          .map((d) => `--- ${d.path} ---\n${d.source}`)
          .join('\n\n');
  return [
    `TARGET FILE: ${args.path}`,
    ``,
    `SKELETON (preserve all exports exactly):`,
    args.skeleton,
    ``,
    `CODEBASE DIGEST (all files, signatures only):`,
    args.digestPrompt,
    ``,
    `DIRECT DEPENDENCIES (full source):`,
    depSection,
  ].join('\n');
}

function readSource(projectRoot: string, rel: string): string {
  try {
    return readFileSync(join(projectRoot, rel), 'utf8');
  } catch {
    throw new Error(`[implementation_pass] Cannot read ${rel} — run skeleton pass first`);
  }
}

/**
 * Deterministic output check: the model must return source, not a protocol
 * echo, and must preserve every expected export. Violations throw so the
 * file is flagged failed — never silently written corrupt.
 */
export function validateImplementation(
  entry: FileManifestEntry,
  code: string,
): void {
  const trimmed = code.trim();
  if (!trimmed) {
    throw new Error(`[implementation_pass] Empty output for ${entry.path}`);
  }
  if (trimmed.startsWith('{')) {
    let parsed: unknown = null;
    try {
      parsed = JSON.parse(trimmed);
    } catch {
      parsed = null; // Not JSON — fall through to the export check.
    }
    if (
      typeof parsed === 'object' &&
      parsed !== null &&
      Array.isArray((parsed as Record<string, unknown>)['files'])
    ) {
      throw new Error(
        `[implementation_pass] Protocol echo for ${entry.path}: got the skeleton JSON envelope, not source`,
      );
    }
  }
  const missing = entry.expectedExports.filter((sym) => !code.includes(sym));
  if (missing.length > 0) {
    throw new Error(
      `[implementation_pass] ${entry.path} dropped expected exports: ${missing.join(', ')}`,
    );
  }
}

export interface ImplementationPassResult {
  implemented: string[];
}

export async function runImplementationPass(
  store: ManifestStore,
  projectRoot: string,
  digest: DigestStore,
): Promise<ImplementationPassResult> {
  const systemPrompt = loadImplementationPrompt();
  const implemented: string[] = [];
  for (const entry of store.list()) {
    const skeleton = readSource(projectRoot, entry.path);
    const deps = entry.dependencies.map((dep) => ({
      path: dep,
      source: readSource(projectRoot, dep),
    }));
    const code = await complete({
      stage: 'execute',
      systemPrompt,
      userPrompt: buildImplementationUserPrompt({
        path: entry.path,
        skeleton,
        digestPrompt: digest.toPrompt(),
        dependencies: deps,
      }),
      maxTokens: 6000,
      temperature: 0.2,
    });
    if (!code.trim()) throw new Error(`[implementation_pass] Empty output for ${entry.path}`);
    validateImplementation(entry, code);
    writeFileSync(join(projectRoot, entry.path), code.endsWith('\n') ? code : code + '\n', 'utf8');
    store.setStatus(entry.path, 'implemented');
    // Keep digest fresh after every write (cheap, small, full-coverage).
    const purpose = store.get(entry.path)?.purpose ?? '';
    digest.upsert(entry.path, code, purpose);
    implemented.push(entry.path);
  }
  return { implemented };
}
