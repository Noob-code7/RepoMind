/**
 * orchestrator/digest_store.ts
 * Builds and maintains a condensed interface index (signatures + docstrings)
 * of the generated codebase. Fed into later LLM calls instead of full source.
 * NO LLM calls live here.
 */
import fs from 'node:fs';
import path from 'node:path';
import {
  CodebaseDigest,
  DigestEntry,
  FileManifest,
} from '../shared/types.js';

export class DigestStore {
  private entries = new Map<string, DigestEntry>();

  constructor(initial: CodebaseDigest = []) {
    for (const e of initial) {
      this.entries.set(e.path, { ...e });
    }
  }

  upsert(filePath: string, source: string, docstringFallback = ''): DigestEntry {
    const signatures = DigestStore.extractSignatures(source);
    const docstring = DigestStore.extractDocstring(source) || docstringFallback;
    const entry: DigestEntry = {
      path: filePath,
      signatures,
      docstring,
    };
    this.entries.set(filePath, entry);
    return entry;
  }

  upsertEntry(entry: DigestEntry): void {
    this.entries.set(entry.path, { ...entry });
  }

  remove(filePath: string): void {
    this.entries.delete(filePath);
  }

  get(filePath: string): DigestEntry | undefined {
    const e = this.entries.get(filePath);
    return e ? { ...e } : undefined;
  }

  list(): CodebaseDigest {
    return [...this.entries.values()];
  }

  toPrompt(): string {
    return DigestStore.formatForPrompt(this.list());
  }

  static digestPath(projectRoot: string): string {
    return path.join(projectRoot, '.braid_digest.json');
  }

  /**
   * Parse signatures and docstrings from a TypeScript/JavaScript file.
   */
  static extractSignatures(source: string): string[] {
    const signatures: string[] = [];
    const lines = source.split('\n');

    let inDoc = false;
    let docBuffer: string[] = [];

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();

      // Track comments
      if (line.startsWith('/**')) {
        inDoc = true;
        docBuffer = [line];
        if (line.endsWith('*/')) inDoc = false;
        continue;
      }
      if (inDoc) {
        docBuffer.push(line);
        if (line.endsWith('*/')) inDoc = false;
        continue;
      }

      // Match exported functions, types, interfaces, classes, consts
      if (
        line.startsWith('export ') ||
        line.startsWith('export default ')
      ) {
        let sig = line;
        // If function/method body starts on same line, strip the body
        const braceIdx = sig.indexOf('{');
        if (braceIdx !== -1 && !sig.includes('interface ') && !sig.includes('type ')) {
          sig = sig.slice(0, braceIdx).trim();
        }
        if (!sig.endsWith(';') && !sig.endsWith('{')) {
          sig += ';';
        }
        signatures.push(sig);
      }
    }

    return signatures;
  }

  /**
   * Extract top-level docstring or comment describing file purpose.
   */
  static extractDocstring(source: string): string {
    const match = source.match(/\/\*\*([\s\S]*?)\*\//);
    if (match && match[1]) {
      return match[1]
        .split('\n')
        .map((l) => l.replace(/^\s*\*\s?/, '').trim())
        .filter((l) => l.length > 0)
        .join(' ');
    }
    const lineComments = source
      .split('\n')
      .filter((l) => l.trim().startsWith('//'))
      .map((l) => l.trim().replace(/^\/\/\s*/, ''))
      .join(' ');
    return lineComments;
  }

  /**
   * Build complete CodebaseDigest from project root and manifest.
   */
  static build(projectRoot: string, manifest: FileManifest): CodebaseDigest {
    const digest: CodebaseDigest = [];

    for (const entry of manifest.files) {
      const fullPath = path.join(projectRoot, entry.path);
      if (fs.existsSync(fullPath)) {
        const source = fs.readFileSync(fullPath, 'utf-8');
        const signatures = DigestStore.extractSignatures(source);
        let docstring = DigestStore.extractDocstring(source);
        if (!docstring) {
          docstring = entry.purpose;
        }

        digest.push({
          path: entry.path,
          signatures: signatures.length > 0 ? signatures : entry.expectedExports.map((e) => `export ${e};`),
          docstring,
        });
      } else {
        digest.push({
          path: entry.path,
          signatures: entry.expectedExports.map((e) => `export ${e};`),
          docstring: entry.purpose,
        });
      }
    }

    return digest;
  }

  /**
   * Format digest into a compact string for LLM prompt context injection.
   */
  static formatForPrompt(digest: CodebaseDigest): string {
    if (digest.length === 0) return '(No existing files in digest)';

    return digest
      .map((entry) => {
        const sigs =
          entry.signatures.length > 0
            ? entry.signatures.map((s) => `  ${s}`).join('\n')
            : '  (no exports)';
        return `### File: ${entry.path}\nPurpose: ${entry.docstring}\nExports:\n${sigs}`;
      })
      .join('\n\n');
  }

  /**
   * Save digest to disk.
   */
  static save(projectRoot: string, digest: CodebaseDigest): void {
    const p = DigestStore.digestPath(projectRoot);
    fs.writeFileSync(p, JSON.stringify(digest, null, 2), 'utf-8');
  }

  /**
   * Load digest from disk.
   */
  static load(projectRoot: string): CodebaseDigest | null {
    const p = DigestStore.digestPath(projectRoot);
    if (!fs.existsSync(p)) return null;
    try {
      return JSON.parse(fs.readFileSync(p, 'utf-8'));
    } catch {
      return null;
    }
  }
}
