/**
 * agents/executor/executor.ts — Drives the two-pass generation in exact order:
 * 1. skeleton pass → 2. manifest diff → 3. digest build →
 * 4. implementation pass → 5. manifest diff again.
 * Self-loop repair (test → triage → ast_patcher) is driven by the debugger
 * + loop_controller (Phases 6/8); this module runs one clean cycle.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ManifestStore } from '../../orchestrator/manifest_store.js';
import { diffManifestOnDisk, type ManifestDiff } from '../../orchestrator/manifest_diff.js';
import { DigestStore } from '../../orchestrator/digest_store.js';
import { runSkeletonPass } from './skeleton_pass.js';
import { runImplementationPass } from './implementation_pass.js';

export interface ExecuteResult {
  afterSkeleton: ManifestDiff;
  afterImplementation: ManifestDiff;
  digest: DigestStore;
}

/** Live callbacks for the mid-execution terminal view. All optional. */
export interface ExecuteOpts {
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

function readSourceOrEmpty(projectRoot: string, rel: string): string {
  try {
    return readFileSync(join(projectRoot, rel), 'utf8');
  } catch {
    return '';
  }
}

export async function executeProject(
  store: ManifestStore,
  projectRoot: string,
  opts: ExecuteOpts = {},
): Promise<ExecuteResult> {
  // 1–2. Skeleton pass + diff (missing files must be surfaced, never dropped).
  await runSkeletonPass(store, projectRoot, {
    onActivity: opts.onActivity,
    onThinking: opts.onThinking,
  });
  const afterSkeleton = diffManifestOnDisk(projectRoot, store.snapshot());
  if (!afterSkeleton.complete) {
    throw new Error(
      `[executor] Skeleton pass incomplete, missing: ${afterSkeleton.missing.join(', ')}`,
    );
  }

  // 3. Digest build from skeletons (+ manifest purpose as docstring fallback).
  const snapshot = store.snapshot();
  const digest = new DigestStore();
  for (const entry of snapshot.files) {
    const source = readSourceOrEmpty(projectRoot, entry.path);
    digest.upsert(entry.path, source, entry.purpose);
  }

  // 4–5. Implementation pass + diff again.
  await runImplementationPass(store, projectRoot, digest, {
    onActivity: opts.onActivity,
    onThinking: opts.onThinking,
  });
  const afterImplementation = diffManifestOnDisk(projectRoot, store.snapshot());
  if (!afterImplementation.complete) {
    throw new Error(
      `[executor] Implementation pass incomplete, missing: ${afterImplementation.missing.join(', ')}`,
    );
  }
  return { afterSkeleton, afterImplementation, digest };
}
