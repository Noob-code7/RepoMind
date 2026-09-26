/**
 * agents/executor/skeleton_pass.ts — Pass 1: one LLM call emits signatures
 * for EVERY manifest file; each skeleton is written to disk and marked
 * 'skeleton'. Missing files are reported (orchestrator requeues, no LLM).
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { completeJson } from '../../shared/llm_client.js';
import type { FileManifest } from '../../shared/types.js';
import { ManifestStore } from '../../orchestrator/manifest_store.js';
import { diffManifest } from '../../orchestrator/manifest_diff.js';
import { emitFileGenerated } from '../../telemetry/index.js';

const PROMPT_PATH = join(
  dirname(fileURLToPath(import.meta.url)),
  'prompts',
  'skeleton_prompt.md',
);

export interface SkeletonFile {
  path: string;
  code: string;
}

export function loadSkeletonPrompt(): string {
  return readFileSync(PROMPT_PATH, 'utf8');
}

export function buildSkeletonUserPrompt(manifest: FileManifest): string {
  return [
    `PROJECT: ${manifest.project}`,
    `MANIFEST (${manifest.files.length} files):`,
    JSON.stringify(manifest.files, null, 2),
    `Emit skeletons for ALL files listed.`,
  ].join('\n');
}

/** Pure: validate single-call LLM payload against the manifest. */
export function parseSkeletonPayload(
  raw: unknown,
  manifest: FileManifest,
): SkeletonFile[] {
  const obj = raw as { files?: unknown };
  if (!obj || !Array.isArray(obj.files)) {
    throw new Error('[skeleton_pass] Expected { files: [{ path, code }] }');
  }
  const planned = new Set(manifest.files.map((f) => f.path));
  const out: SkeletonFile[] = [];
  for (const f of obj.files as Array<Record<string, unknown>>) {
    if (typeof f['path'] !== 'string' || typeof f['code'] !== 'string') {
      throw new Error('[skeleton_pass] Each file needs { path: string, code: string }');
    }
    if (!planned.has(f['path'])) {
      throw new Error(`[skeleton_pass] Unexpected path: ${f['path']}`);
    }
    out.push({ path: f['path'], code: f['code'] });
  }
  return out;
}

export interface SkeletonPassResult {
  written: string[];
  missing: string[];
}

/** Live activity callback (TUI feed / CLI log). Optional — headless safe. */
export interface SkeletonPassOpts {
  onActivity?: (e: {
    kind: 'read' | 'create' | 'edit';
    path: string;
    detail?: string;
    added?: number;
    removed?: number;
    loc?: number;
  }) => void;
  onThinking?: (thinking: boolean) => void;
}

function countLines(s: string): number {
  if (!s) return 0;
  return s.split('\n').filter((l) => l.length > 0).length;
}

export async function runSkeletonPass(
  store: ManifestStore,
  projectRoot: string,
  opts: SkeletonPassOpts = {},
): Promise<SkeletonPassResult> {
  const manifest = store.snapshot();
  opts.onThinking?.(true);
  let raw: unknown;
  try {
    raw = await completeJson<unknown>({
      stage: 'execute',
      systemPrompt: loadSkeletonPrompt(),
      userPrompt: buildSkeletonUserPrompt(manifest),
      maxTokens: 8000,
      temperature: 0.1,
    });
  } finally {
    opts.onThinking?.(false);
  }
  const skeletons = parseSkeletonPayload(raw, manifest);
  const written: string[] = [];
  for (const s of skeletons) {
    const abs = join(projectRoot, s.path);
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, s.code.endsWith('\n') ? s.code : s.code + '\n', 'utf8');
    store.setStatus(s.path, 'skeleton');
    emitFileGenerated({
      path: s.path,
      phase: 'skeleton',
      status: 'skeleton',
      sizeBytes: s.code.length,
    });
    written.push(s.path);
    opts.onActivity?.({ kind: 'create', path: s.path, added: countLines(s.code), removed: 0 });
  }
  const { missing } = diffManifest(store.snapshot(), written);
  return { written, missing };
}
