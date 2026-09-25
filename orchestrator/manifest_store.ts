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

export function manifestPathFor(
  generatedRoot: string,
  project: string,
): string {
  return path.join(generatedRoot, project, 'manifest.json');
}

export class ManifestStore {
  private manifest: FileManifest;
  private readonly manifestFilePath: string;

  constructor(
    manifestPath: string,
    initial: FileManifest,
  ) {
    validateManifest(initial);
    this.manifest = structuredClone(initial);
    this.manifestFilePath = manifestPath;
    this.save();
  }

  get path(): string {
    return this.manifestFilePath;
  }

  get project(): string {
    return this.manifest.project;
  }

  get files(): FileManifestEntry[] {
    return this.manifest.files;
  }

  list(): FileManifestEntry[] {
    return structuredClone(this.manifest.files);
  }

  snapshot(): FileManifest {
    return structuredClone(this.manifest);
  }

  get(filePath: string): FileManifestEntry | undefined {
    const found = this.manifest.files.find((f) => f.path === filePath);
    return found ? structuredClone(found) : undefined;
  }

  has(filePath: string): boolean {
    return this.manifest.files.some((f) => f.path === filePath);
  }

  setStatus(filePath: string, status: FileStatus): void {
    const entry = this.manifest.files.find((f) => f.path === filePath);
    if (!entry) throw new Error(`[manifest_store] Unknown path: ${filePath}`);
    entry.status = status;
    this.save();
  }

  setManyStatus(paths: readonly string[], status: FileStatus): void {
    for (const p of paths) {
      const entry = this.manifest.files.find((f) => f.path === p);
      if (!entry) throw new Error(`[manifest_store] Unknown path: ${p}`);
      entry.status = status;
    }
    this.save();
  }

  dependenciesOf(filePath: string): string[] {
    const entry = this.manifest.files.find((f) => f.path === filePath);
    if (!entry) throw new Error(`[manifest_store] Unknown path: ${filePath}`);
    return [...entry.dependencies];
  }

  dependentsOf(filePath: string): string[] {
    return this.manifest.files
      .filter((f) => f.dependencies.includes(filePath))
      .map((f) => f.path);
  }

  byStatus(status: FileStatus): string[] {
    return this.manifest.files
      .filter((f) => f.status === status)
      .map((f) => f.path);
  }

  save(): void {
    fs.mkdirSync(path.dirname(this.manifestFilePath), { recursive: true });
    fs.writeFileSync(
      this.manifestFilePath,
      JSON.stringify(this.manifest, null, 2) + '\n',
      'utf8',
    );
  }

  /**
   * Resolve path to manifest file for a given project directory.
   */
  static manifestPath(projectRoot: string): string {
    return path.join(projectRoot, '.braid_manifest.json');
  }

  /**
   * Load manifest from disk. Works for both directory paths or direct file paths.
   */
  static load(pathOrRoot: string): ManifestStore {
    let filePath = pathOrRoot;
    if (!filePath.endsWith('.json')) {
      const p1 = path.join(pathOrRoot, '.braid_manifest.json');
      const p2 = path.join(pathOrRoot, 'manifest.json');
      filePath = fs.existsSync(p1) ? p1 : fs.existsSync(p2) ? p2 : p1;
    }
    if (!fs.existsSync(filePath)) {
      throw new Error(`[manifest_store] Not found: ${filePath}`);
    }
    const raw = fs.readFileSync(filePath, 'utf-8');
    const parsed = JSON.parse(raw);
    validateManifest(parsed);
    const store = new ManifestStore(filePath, parsed);
    return store;
  }

  static loadOrInit(
    manifestPath: string,
    initial: FileManifest,
  ): ManifestStore {
    if (fs.existsSync(manifestPath)) return ManifestStore.load(manifestPath);
    fs.mkdirSync(path.dirname(manifestPath), { recursive: true });
    return new ManifestStore(manifestPath, initial);
  }

  /**
   * Save manifest to disk atomically (static legacy).
   */
  static save(projectRoot: string, manifest: FileManifest): void {
    validateManifest(manifest);
    if (!fs.existsSync(projectRoot)) {
      fs.mkdirSync(projectRoot, { recursive: true });
    }
    const p = projectRoot.endsWith('.json')
      ? projectRoot
      : ManifestStore.manifestPath(projectRoot);
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
