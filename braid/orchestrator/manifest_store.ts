/**
 * orchestrator/manifest_store.ts — JSON-backed source of truth for the manifest.
 * NO LLM calls. Owns planned files, statuses, dependencies.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type {
  FileManifest,
  FileManifestEntry,
  FileStatus,
} from '../shared/types.js';
import { validateManifest } from '../shared/types.js';

export function manifestPathFor(
  generatedRoot: string,
  project: string,
): string {
  return join(generatedRoot, project, 'manifest.json');
}

export class ManifestStore {
  private manifest: FileManifest;

  constructor(
    private readonly manifestPath: string,
    initial: FileManifest,
  ) {
    validateManifest(initial);
    this.manifest = structuredClone(initial);
    // Persist on creation so a crash never leaves an unwritten plan.
    this.save();
  }

  /** Load an existing manifest from disk. Throws if missing/invalid. */
  static load(manifestPath: string): ManifestStore {
    if (!existsSync(manifestPath)) {
      throw new Error(`[manifest_store] Not found: ${manifestPath}`);
    }
    const raw = readFileSync(manifestPath, 'utf8');
    const parsed: unknown = JSON.parse(raw);
    validateManifest(parsed);
    const store = Object.create(ManifestStore.prototype) as ManifestStore;
    (store as unknown as { manifestPath: string }).manifestPath = manifestPath;
    (store as unknown as { manifest: FileManifest }).manifest = parsed;
    return store;
  }

  /** Load if present, else init from `initial` and persist. */
  static loadOrInit(
    manifestPath: string,
    initial: FileManifest,
  ): ManifestStore {
    if (existsSync(manifestPath)) return ManifestStore.load(manifestPath);
    mkdirSync(dirname(manifestPath), { recursive: true });
    return new ManifestStore(manifestPath, initial);
  }

  get path(): string {
    return this.manifestPath;
  }

  get project(): string {
    return this.manifest.project;
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

  /** Transition a single file's status and persist. */
  setStatus(filePath: string, status: FileStatus): void {
    const entry = this.manifest.files.find((f) => f.path === filePath);
    if (!entry) throw new Error(`[manifest_store] Unknown path: ${filePath}`);
    entry.status = status;
    this.save();
  }

  /** Bulk status update (e.g. after a generation pass). */
  setManyStatus(paths: readonly string[], status: FileStatus): void {
    for (const p of paths) {
      const entry = this.manifest.files.find((f) => f.path === p);
      if (!entry) throw new Error(`[manifest_store] Unknown path: ${p}`);
      entry.status = status;
    }
    this.save();
  }

  /** Direct dependencies of a file (repo-relative paths). */
  dependenciesOf(filePath: string): string[] {
    const entry = this.manifest.files.find((f) => f.path === filePath);
    if (!entry) throw new Error(`[manifest_store] Unknown path: ${filePath}`);
    return [...entry.dependencies];
  }

  /** Files that depend on `filePath` (reverse lookup for patch impact). */
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
    mkdirSync(dirname(this.manifestPath), { recursive: true });
    writeFileSync(
      this.manifestPath,
      JSON.stringify(this.manifest, null, 2) + '\n',
      'utf8',
    );
  }
}
