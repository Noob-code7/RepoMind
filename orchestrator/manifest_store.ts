/**
 * orchestrator/manifest_store.ts
 * JSON-backed manifest persistence and query helpers.
 * Deterministic — NO LLM calls live here.
 */
import fs from 'node:fs';
import path from 'node:path';
import {
  FileManifest,
  FileManifestEntry,
  FileStatus,
  validateManifest,
} from '../shared/types.js';

export class ManifestStore {
  /**
   * Resolve path to manifest file for a given project directory.
   */
  static manifestPath(projectRoot: string): string {
    return path.join(projectRoot, '.braid_manifest.json');
  }

  /**
   * Load manifest from disk, verifying its structure.
   */
  static load(projectRoot: string): FileManifest | null {
    const p = ManifestStore.manifestPath(projectRoot);
    if (!fs.existsSync(p)) return null;
    try {
      const raw = fs.readFileSync(p, 'utf-8');
      const data = JSON.parse(raw);
      validateManifest(data);
      return data;
    } catch (err) {
      console.warn(`[manifest_store] Failed to load manifest at ${p}:`, err);
      return null;
    }
  }

  /**
   * Save manifest to disk atomically.
   */
  static save(projectRoot: string, manifest: FileManifest): void {
    validateManifest(manifest);
    if (!fs.existsSync(projectRoot)) {
      fs.mkdirSync(projectRoot, { recursive: true });
    }
    const p = ManifestStore.manifestPath(projectRoot);
    const tmp = `${p}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(manifest, null, 2), 'utf-8');
    fs.renameSync(tmp, p);
  }

  /**
   * Update the status of a specific file in the manifest.
   */
  static updateStatus(
    manifest: FileManifest,
    filePath: string,
    status: FileStatus,
  ): boolean {
    const entry = manifest.files.find((f) => f.path === filePath);
    if (!entry) return false;
    entry.status = status;
    return true;
  }

  /**
   * Find entry by path.
   */
  static getEntry(
    manifest: FileManifest,
    filePath: string,
  ): FileManifestEntry | undefined {
    return manifest.files.find((f) => f.path === filePath);
  }

  /**
   * Return all entries with a given status.
   */
  static getByStatus(
    manifest: FileManifest,
    status: FileStatus,
  ): FileManifestEntry[] {
    return manifest.files.filter((f) => f.status === status);
  }

  /**
   * Calculate completeness percentage (verified or implemented vs total).
   */
  static completeness(manifest: FileManifest): number {
    if (manifest.files.length === 0) return 0;
    const completed = manifest.files.filter(
      (f) => f.status === 'verified' || f.status === 'implemented',
    ).length;
    return Math.round((completed / manifest.files.length) * 100);
  }
}
