/** Deterministic tracking of planned vs written files */
export class ManifestManager {
  /** Loads manifest from disk */
  static load(path: string): Promise<ManifestManager>;

  /** Creates a new empty manifest */
  constructor();

  /** Adds a planned file entry */
  addPlannedFile(entry: PlannedFileEntry): void;

  /** Marks a file as written with its digest */
  markWritten(filePath: string, digest: string): void;

  /** Returns all pending (planned but not written) files */
  getPendingFiles(): PlannedFileEntry[];

  /** Persists manifest to disk */
  save(path: string): Promise<void>;

  /** Validates manifest integrity */
  validate(): ValidationResult;
}

/** A file planned for generation */
export interface PlannedFileEntry {
  path: string;
  purpose: string;
  expectedExports: string[];
  dependencies: string[];
  status: "planned" | "written" | "verified";
  digest?: string;
}

/** Result of manifest validation */
export interface ValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
}
