/**
 * agents/executor/ast_patcher.ts
 * Applies block-level and function-level patches to existing source files
 * rather than regenerating whole files, preserving all untouched logic.
 * Deterministic — NO LLM calls live here.
 */
import fs from 'node:fs';
import path from 'node:path';
import { PatchProposal } from '../../shared/types.js';

export interface PatchResult {
  patched: string;
  success: boolean;
  strategy: 'block_comment' | 'function_declaration' | 'exact_match' | 'append' | 'none';
  error?: string;
}

export class AstPatcher {
  /**
   * Apply a PatchProposal to source code string.
   */
  static patch(source: string, proposal: PatchProposal): PatchResult {
    const { anchor, replacement } = proposal;

    // Strategy 1: Explicit braid block comments
    // e.g. // <braid:block name="authHandler"> ... // </braid:block>
    const blockStartRegex = new RegExp(
      `(//|/\\*)\\s*<braid:block\\s+name=["']${AstPatcher.escapeRegex(anchor)}["']>.*?\n`,
      'i',
    );
    const blockEndRegex = /(\/\/|\/\*)\s*<\/braid:block>(\*\/)?/;

    const startMatch = blockStartRegex.exec(source);
    if (startMatch) {
      const startIndex = startMatch.index;
      const afterStart = source.slice(startIndex + startMatch[0].length);
      const endMatch = blockEndRegex.exec(afterStart);
      if (endMatch) {
        const endIndex = startIndex + startMatch[0].length + endMatch.index + endMatch[0].length;
        const newBlock = `// <braid:block name="${anchor}">\n${replacement.trim()}\n// </braid:block>`;
        const patched = source.slice(0, startIndex) + newBlock + source.slice(endIndex);
        return { patched, success: true, strategy: 'block_comment' };
      }
    }

    // Strategy 2: Function, method, or class declaration
    // Match declaration line and balanced curly braces
    const declPatterns = [
      new RegExp(`(?:export\\s+)?(?:async\\s+)?function\\s+${AstPatcher.escapeRegex(anchor)}\\b`),
      new RegExp(`(?:export\\s+)?(?:const|let|var)\\s+${AstPatcher.escapeRegex(anchor)}\\s*=`),
      new RegExp(`(?:export\\s+)?class\\s+${AstPatcher.escapeRegex(anchor)}\\b`),
      new RegExp(`\\b${AstPatcher.escapeRegex(anchor)}\\s*\\([^)]*\\)\\s*\\{`),
    ];

    for (const pattern of declPatterns) {
      const match = pattern.exec(source);
      if (match) {
        const declStart = match.index;
        const braceRange = AstPatcher.findBalancedBraces(source, declStart);
        if (braceRange) {
          const patched =
            source.slice(0, declStart) +
            replacement.trim() +
            '\n' +
            source.slice(braceRange.end + 1);
          return { patched, success: true, strategy: 'function_declaration' };
        }
      }
    }

    // Strategy 3: Exact anchor match
    if (source.includes(anchor)) {
      const patched = source.replace(anchor, replacement.trim());
      return { patched, success: true, strategy: 'exact_match' };
    }

    // Strategy 4: Fallback — append new function/block if not present
    const patched = `${source.trim()}\n\n// Added by patcher for anchor "${anchor}"\n${replacement.trim()}\n`;
    return {
      patched,
      success: true,
      strategy: 'append',
    };
  }

  /**
   * Helper to locate balanced curly braces starting from or after declStart.
   */
  private static findBalancedBraces(
    source: string,
    startIndex: number,
  ): { start: number; end: number } | null {
    let openIdx = source.indexOf('{', startIndex);
    if (openIdx === -1) return null;

    let depth = 0;
    let inString: string | null = null;
    let inLineComment = false;
    let inBlockComment = false;

    for (let i = openIdx; i < source.length; i++) {
      const char = source[i];
      const next = source[i + 1];

      // Handle comments
      if (inLineComment) {
        if (char === '\n') inLineComment = false;
        continue;
      }
      if (inBlockComment) {
        if (char === '*' && next === '/') {
          inBlockComment = false;
          i++;
        }
        continue;
      }
      if (char === '/' && next === '/') {
        inLineComment = true;
        i++;
        continue;
      }
      if (char === '/' && next === '*') {
        inBlockComment = true;
        i++;
        continue;
      }

      // Handle string literals
      if (inString) {
        if (char === '\\') {
          i++; // Skip escaped char
        } else if (char === inString) {
          inString = null;
        }
        continue;
      }
      if (char === '"' || char === "'" || char === '`') {
        inString = char;
        continue;
      }

      // Handle braces
      if (char === '{') {
        depth++;
      } else if (char === '}') {
        depth--;
        if (depth === 0) {
          return { start: openIdx, end: i };
        }
      }
    }

    return null;
  }

  private static escapeRegex(str: string): string {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  /**
   * Patch file directly on disk.
   */
  static applyToFile(projectRoot: string, proposal: PatchProposal): boolean {
    const fullPath = path.join(projectRoot, proposal.path);
    if (!fs.existsSync(fullPath)) return false;

    const original = fs.readFileSync(fullPath, 'utf-8');
    const result = AstPatcher.patch(original, proposal);
    if (result.success) {
      fs.writeFileSync(fullPath, result.patched, 'utf-8');
      return true;
    }
    return false;
  }
}

export function patchSource(
  source: string,
  anchor: string,
  replacement: string,
): string {
  const res = AstPatcher.patch(source, { path: '', anchor, replacement, reason: '' });
  if (res.success) {
    return res.patched;
  }
  throw new Error(`[ast_patcher] Anchor not found: ${anchor}`);
}

export function applyPatch(
  filePath: string,
  anchor: string,
  replacement: string,
): string {
  const source = fs.readFileSync(filePath, 'utf8');
  const next = patchSource(source, anchor, replacement);
  fs.writeFileSync(filePath, next, 'utf8');
  return next;
}
