/**
 * agents/debugger/failure_triage.ts — LLM interprets failures and proposes
 * TARGETED patches. Never rewrites files: output is PatchProposal[] applied
 * exclusively via ast_patcher (executor). Tests are code, not model output.
 */
import { completeJson } from '../../shared/llm_client.js';
import type { PatchProposal } from '../../shared/types.js';

const TRIAGE_SYSTEM = [
  'You are the Braid DEBUG triage (lightweight model).',
  'Given failing test output, the codebase digest, and the full source of the',
  'failing files, propose MINIMAL targeted patches.',
  'Reply with ONLY JSON: { "patches": [{ "path": "src/...", "anchor": "functionOrBlockName", "replacement": "<full replacement block source>", "reason": "one line" }] }',
  'Rules: one patch per broken symbol; anchor must be an existing function/class/const or // <braid:block name="..."> region; replacement is the complete new block (not a diff); never propose full-file rewrites; at most 5 patches.',
].join('\n');

export interface TriageRequest {
  /** Raw failure logs (vitest output excerpts, missing-file lists). */
  failures: string;
  /** Compact digest rendering (DigestStore.toPrompt()). */
  digestPrompt: string;
  /** Full source of failing files only. */
  sources: Array<{ path: string; source: string }>;
  /** Manifest paths allowed to be patched (model must not invent files). */
  allowedPaths: string[];
}

/** Pure validator — throws on malformed/unsafe proposals. */
export function parseTriagePayload(
  raw: unknown,
  allowedPaths: readonly string[],
): PatchProposal[] {
  const obj = raw as { patches?: unknown };
  if (!obj || !Array.isArray(obj.patches)) {
    throw new Error('[failure_triage] Expected { patches: [...] }');
  }
  if (obj.patches.length > 5) {
    throw new Error('[failure_triage] At most 5 patches per cycle');
  }
  const allowed = new Set(allowedPaths);
  return (obj.patches as Array<Record<string, unknown>>).map((p, i) => {
    if (typeof p['path'] !== 'string' || !allowed.has(p['path'] as string)) {
      throw new Error(`[failure_triage] Patch ${i}: unknown path ${String(p['path'])}`);
    }
    if (typeof p['anchor'] !== 'string' || !(p['anchor'] as string).trim()) {
      throw new Error(`[failure_triage] Patch ${i}: anchor required`);
    }
    if (typeof p['replacement'] !== 'string' || !(p['replacement'] as string).trim()) {
      throw new Error(`[failure_triage] Patch ${i}: replacement required`);
    }
    return {
      path: p['path'] as string,
      anchor: (p['anchor'] as string).trim(),
      replacement: p['replacement'] as string,
      reason: typeof p['reason'] === 'string' ? p['reason'] : '',
    };
  });
}

export function buildTriageUserPrompt(req: TriageRequest): string {
  return [
    `FAILURES:`,
    req.failures,
    ``,
    `DIGEST:`,
    req.digestPrompt,
    ``,
    `FAILING FILE SOURCES:`,
    ...req.sources.map((s) => `--- ${s.path} ---\n${s.source}`),
  ].join('\n');
}

export async function triageFailures(
  req: TriageRequest,
): Promise<PatchProposal[]> {
  const raw = await completeJson<unknown>({
    stage: 'triage',
    systemPrompt: TRIAGE_SYSTEM,
    userPrompt: buildTriageUserPrompt(req),
    maxTokens: 4000,
    temperature: 0.2,
  });
  return parseTriagePayload(raw, req.allowedPaths);
}
