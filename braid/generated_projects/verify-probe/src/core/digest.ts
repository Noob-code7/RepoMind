/** Maintains condensed interface index for context injection */
export class DigestStore {
  /** Creates a new digest store */
  constructor();

  /** Adds a file's interface digest */
  addDigest(filePath: string, digest: FileDigest): void;

  /** Retrieves digest for a file */
  getDigest(filePath: string): FileDigest | undefined;

  /** Returns all digests as a condensed context string */
  getContextString(): string;

  /** Updates digest after file modification */
  updateDigest(filePath: string, newDigest: FileDigest): void;

  /** Removes a digest entry */
  removeDigest(filePath: string): void;

  /** Serializes store to JSON */
  toJSON(): string;

  /** Loads store from JSON */
  static fromJSON(json: string): DigestStore;
}

/** Condensed interface representation of a file */
export interface FileDigest {
  path: string;
  exports: ExportSignature[];
  dependencies: string[];
  hash: string;
}

/** Type signature of an exported symbol */
export interface ExportSignature {
  name: string;
  kind: "function" | "class" | "interface" | "type" | "const";
  signature: string;
  docstring?: string;
}
