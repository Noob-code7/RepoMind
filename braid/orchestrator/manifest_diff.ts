/**
 * orchestrator/manifest_diff.ts — Deterministic planned-vs-written diff.
 * NO LLM calls. Pure functions + small fs helper for on-disk checks.
 */
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import type { FileManifest } from '../shared/types.js';

export interface ManifestDiff {
  /** Planned paths with no corresponding written file. Requeue these. */
  missing: string[];
  /** Written paths not in the manifest (drift / unexpected). */
  extra: string[];
  /** 0–100: % of planned files present on disk (or in written set). */
  completeness: number;
  /** True when missing.length === 0. */
  complete: boolean;
}

function normalize(p: string): string {
  return p.replace(/\\/g, '/').replace(/^\.\//, '').trim();
}

/**
 * Core diff: planned manifest vs. a set of written repo-relative paths.
 * Case-sensitive, posix-style. Duplicates in `written` are ignored.
 */
export function diffManifest(
  manifest: FileManifest,
  written: readonly string[],
): ManifestDiff {
  const planned = manifest.files.map((f) => normalize(f.path));
  const writtenSet = new Set(written.map(normalize));
  const plannedSet = new Set(planned);

  const missing = planned.filter((p) => !writtenSet.has(p));
  const extra = [...writtenSet].filter((w) => !plannedSet.has(w));
  const completeness =
    planned.length === 0
      ? 100
      : ((planned.length - missing.length) / planned.length) * 100;

  return { missing, extra, completeness, complete: missing.length === 0 };
}

/** Convenience: just the missing list (what to requeue into skeleton pass). */
export function getMissingFiles(
  manifest: FileManifest,
  written: readonly string[],
): string[] {
  return diffManifest(manifest, written).missing;
}

/**
 * Status-based completeness: % of manifest entries past skeleton stage
 * (implemented | verified) — used by the reporter for manifestCompleteness
 * when files exist but may still be skeletons.
 */
export function statusCompleteness(manifest: FileManifest): number {
  if (manifest.files.length === 0) return 100;
  const done = manifest.files.filter(
    (f) => f.status === 'implemented' || f.status === 'verified',
  ).length;
  return (done / manifest.files.length) * 100;
}

/**
 * On-disk check: which planned paths actually exist under projectRoot?
 * Returns repo-relative posix paths that exist.
 */
export function listExistingFiles(
  projectRoot: string,
  manifest: FileManifest,
): string[] {
  return manifest.files
    .map((f) => normalize(f.path))
    .filter((p) => existsSync(join(projectRoot, p)));
}

/** Diff manifest against real files on disk (no LLM involved). */
export function diffManifestOnDisk(
  projectRoot: string,
  manifest: FileManifest,
): ManifestDiff {
  return diffManifest(manifest, listExistingFiles(projectRoot, manifest));
}
