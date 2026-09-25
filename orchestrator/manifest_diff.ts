/**
 * orchestrator/manifest_diff.ts
 * Deterministic comparison between planned manifest files and actual disk contents.
 * Used after Skeleton pass and Implementation pass to guarantee zero dropped files.
 * NO LLM calls live here.
 */
import fs from 'node:fs';
import path from 'node:path';
import {
  FileManifest,
  FileManifestEntry,
  FileStatus,
} from '../shared/types.js';

export interface ManifestDiffResult {
  /** Files completely missing from disk */
  missing: FileManifestEntry[];
  /** Files present on disk but 0-byte or whitespace-only */
  empty: FileManifestEntry[];
  /** Files present on disk that have valid content */
  valid: FileManifestEntry[];
  /** Files that exist on disk but are not listed in manifest */
  untracked: string[];
  /** Completeness percentage (0–100) */
  completenessPercentage: number;
}

export class ManifestDiff {
  /**
   * Compare manifest entries against files on disk in projectRoot.
   */
  static diff(
    projectRoot: string,
    manifest: FileManifest,
    mode: 'skeleton' | 'implemented' = 'skeleton',
  ): ManifestDiffResult {
    const missing: FileManifestEntry[] = [];
    const empty: FileManifestEntry[] = [];
    const valid: FileManifestEntry[] = [];

    for (const entry of manifest.files) {
      const fullPath = path.join(projectRoot, entry.path);
      if (!fs.existsSync(fullPath)) {
        missing.push(entry);
        continue;
      }

      const stat = fs.statSync(fullPath);
      if (stat.size === 0) {
        empty.push(entry);
        continue;
      }

      const content = fs.readFileSync(fullPath, 'utf-8').trim();
      if (!content) {
        empty.push(entry);
        continue;
      }

      // If checking implementation pass, verify it's not a bare placeholder
      if (mode === 'implemented') {
        const isBareStub =
          content.includes('// SKELETON_ONLY') ||
          content.includes('/* TODO: IMPLEMENT */');
        if (isBareStub) {
          empty.push(entry);
          continue;
        }
      }

      valid.push(entry);
    }

    // Scan disk for untracked files (excluding .braid*, node_modules, etc.)
    const untracked = ManifestDiff.findUntrackedFiles(projectRoot, manifest);

    const totalPlanned = manifest.files.length;
    const completenessPercentage =
      totalPlanned > 0 ? Math.round((valid.length / totalPlanned) * 100) : 100;

    return {
      missing,
      empty,
      valid,
      untracked,
      completenessPercentage,
    };
  }

  /**
   * Reset statuses of missing/empty files back to target status so they can be re-run.
   */
  static requeueMissing(
    manifest: FileManifest,
    failedPaths: string[],
    targetStatus: FileStatus = 'planned',
  ): FileManifestEntry[] {
    const requeued: FileManifestEntry[] = [];
    const pathSet = new Set(failedPaths);

    for (const entry of manifest.files) {
      if (pathSet.has(entry.path)) {
        entry.status = targetStatus;
        requeued.push(entry);
      }
    }

    return requeued;
  }

  /**
   * Helper to scan all files recursively and detect unmanaged files.
   */
  private static findUntrackedFiles(
    projectRoot: string,
    manifest: FileManifest,
  ): string[] {
    if (!fs.existsSync(projectRoot)) return [];
    const plannedSet = new Set(
      manifest.files.map((f) => path.normalize(f.path)),
    );
    const untracked: string[] = [];

    function scan(dir: string) {
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const e of entries) {
        const full = path.join(dir, e.name);
        const rel = path.relative(projectRoot, full);
        if (
          e.name.startsWith('.') ||
          e.name === 'node_modules' ||
          e.name === 'dist'
        ) {
          continue;
        }
        if (e.isDirectory()) {
          scan(full);
        } else if (e.isFile()) {
          const normRel = path.normalize(rel).replace(/\\/g, '/');
          if (!plannedSet.has(path.normalize(rel))) {
            untracked.push(normRel);
          }
        }
      }
    }

    scan(projectRoot);
    return untracked;
  }
}
