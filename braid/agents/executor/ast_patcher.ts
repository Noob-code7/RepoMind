/**
 * agents/executor/ast_patcher.ts — Targeted block/function-level patches.
 * Revisions to existing correct files must NEVER be full-file rewrites.
 * Supports two anchors: a TS symbol name (function/class/const/interface/type/enum)
 * or an explicit `// <braid:block name="..."> ... // </braid:block>` region.
 */
import { readFileSync, writeFileSync } from 'node:fs';

const BLOCK_OPEN = (name: string): RegExp =>
  new RegExp(`//\\s*<braid:block\\s+name="${escapeRegExp(name)}"\\s*>`);
const BLOCK_CLOSE = /\/\/\s*<\/braid:block\s*>/;

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Find the [start,end) line range of a top-level symbol or braid block. */
export function locateAnchor(
  source: string,
  anchor: string,
): { start: number; end: number } {
  const lines = source.split('\n');

  // 1. Explicit braid block.
  const openIdx = lines.findIndex((l) => BLOCK_OPEN(anchor).test(l));
  if (openIdx >= 0) {
    const relClose = lines.slice(openIdx + 1).findIndex((l) => BLOCK_CLOSE.test(l));
    if (relClose < 0) {
      throw new Error(`[ast_patcher] Unclosed <braid:block name="${anchor}">`);
    }
    return { start: openIdx + 1, end: openIdx + 1 + relClose };
  }

  // 2. Symbol anchor: `export ... <kind> <anchor>` or `<kind> <anchor> =`.
  const symRe = new RegExp(
    `^\\s*(?:export\\s+)?(?:async\\s+)?(?:function\\s+${escapeRegExp(anchor)}\\b|class\\s+${escapeRegExp(anchor)}\\b|(?:const|let|var)\\s+${escapeRegExp(anchor)}\\b|(?:interface|type|enum)\\s+${escapeRegExp(anchor)}\\b)`,
  );
  const start = lines.findIndex((l) => symRe.test(l));
  if (start < 0) {
    throw new Error(`[ast_patcher] Anchor not found: ${anchor}`);
  }

  // Brace-balanced scan: symbol block ends when depth returns to baseline.
  let depth = 0;
  let seenOpen = false;
  for (let i = start; i < lines.length; i++) {
    const line = lines[i]!;
    for (const ch of line) {
      if (ch === '{') {
        depth++;
        seenOpen = true;
      } else if (ch === '}') {
        depth--;
      }
    }
    // Single-line (interface member / type alias ending with ;) with no braces.
    if (!seenOpen && /;\s*$/.test(line)) return { start, end: i + 1 };
    if (seenOpen && depth <= 0) return { start, end: i + 1 };
  }
  // EOF-terminated (e.g. arrow const without trailing use) — take to EOF.
  return { start, end: lines.length };
}

/**
 * Pure patch: replace only the anchored region, return new source.
 * Throws if the replacement would leave the file identical or the anchor
 * is missing — the caller must surface these as failed, never silently drop.
 */
export function patchSource(
  source: string,
  anchor: string,
  replacement: string,
): string {
  const { start, end } = locateAnchor(source, anchor);
  const lines = source.split('\n');
  const before = lines.slice(0, start).join('\n');
  const after = lines.slice(end).join('\n');
  const next = (before.length > 0 ? before + '\n' : '') + replacement.trimEnd() + '\n' + after;
  if (next === source) {
    throw new Error('[ast_patcher] Patch produced no change');
  }
  return next;
}

/** Read → patch → write. Returns the new file contents. */
export function applyPatch(
  filePath: string,
  anchor: string,
  replacement: string,
): string {
  const source = readFileSync(filePath, 'utf8');
  const next = patchSource(source, anchor, replacement);
  writeFileSync(filePath, next, 'utf8');
  return next;
}
