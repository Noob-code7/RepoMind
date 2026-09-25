/**
 * orchestrator/digest_store.ts — Condensed interface index fed into
 * generation calls instead of full source. Deterministic, no LLM calls.
 */
import type { CodebaseDigest, DigestEntry } from '../shared/types.js';

const EXPORT_RE =
  /^\s*export\s+(?:async\s+)?(?:function|class|const|let|var|interface|type|enum)\s+([A-Za-z0-9_]+)/gm;
const EXPORT_BLOCK_RE =
  /^\s*export\s*\{\s*([^}]+?)\s*\}\s*;?\s*$/gm;
const DOCSTRING_RE =
  /^\s*(?:\/\*\*\s*(.+?)\s*\*\/|\/\/\s*(.+))\s*$/m;

function extractBlockExports(source: string, out: Set<string>): void {
  for (const m of source.matchAll(EXPORT_BLOCK_RE)) {
    const names = (m[1] ?? '')
      .split(',')
      .map((s) => s.trim().split(/\s+as\s+/i).pop()!.trim())
      .filter(Boolean);
    for (const n of names) out.add(n.replace(/;$/, ''));
  }
}

/** Pull exported symbol names from TS source (best-effort, regex-based). */
export function extractSignatures(source: string): string[] {
  const found = new Set<string>();
  for (const m of source.matchAll(EXPORT_RE)) {
    if (m[1]) found.add(m[1]);
  }
  extractBlockExports(source, found);
  return [...found].sort();
}

/** First docstring-ish line: /** ... *\/ or leading // comment. */
export function extractDocstring(source: string, fallback = ''): string {
  const firstLines = source.split('\n').slice(0, 8).join('\n');
  const m = DOCSTRING_RE.exec(firstLines);
  if (!m) return fallback;
  return (m[1] ?? m[2] ?? '').trim().slice(0, 160);
}

export function buildDigestEntry(
  path: string,
  source: string,
  docstringFallback = '',
): DigestEntry {
  return {
    path,
    signatures: extractSignatures(source),
    docstring: extractDocstring(source, docstringFallback),
  };
}

export function buildDigest(
  files: ReadonlyArray<{ path: string; source: string; purpose?: string }>,
): CodebaseDigest {
  return files.map((f) =>
    buildDigestEntry(f.path, f.source, f.purpose ?? ''),
  );
}

/** In-memory store, updated after every write. Serializes to JSON. */
export class DigestStore {
  private entries = new Map<string, DigestEntry>();

  constructor(initial: CodebaseDigest = []) {
    for (const e of initial) this.entries.set(e.path, { ...e });
  }

  upsert(path: string, source: string, docstringFallback = ''): DigestEntry {
    const entry = buildDigestEntry(path, source, docstringFallback);
    this.entries.set(path, entry);
    return entry;
  }

  upsertEntry(entry: DigestEntry): void {
    this.entries.set(entry.path, { ...entry });
  }

  remove(path: string): void {
    this.entries.delete(path);
  }

  get(path: string): DigestEntry | undefined {
    const e = this.entries.get(path);
    return e ? { ...e } : undefined;
  }

  list(): CodebaseDigest {
    return [...this.entries.values()]
      .sort((a, b) => a.path.localeCompare(b.path))
      .map((e) => ({ ...e }));
  }

  get size(): number {
    return this.entries.size;
  }

  toJSON(): CodebaseDigest {
    return this.list();
  }

  static fromJSON(digest: CodebaseDigest): DigestStore {
    return new DigestStore(digest);
  }

  /**
   * Compact rendering for LLM prompts:
   * ## <path> — <docstring>\n- sig1, sig2
   * Keeps context small even at 100+ files.
   */
  toPrompt(): string {
    return this.list()
      .map((e) => {
        const sigs = e.signatures.length > 0 ? e.signatures.join(', ') : '(no exports)';
        const doc = e.docstring ? ` — ${e.docstring}` : '';
        return `## ${e.path}${doc}\n- ${sigs}`;
      })
      .join('\n');
  }
}
