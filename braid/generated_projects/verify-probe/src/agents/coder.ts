import { FileDigest } from "../core/digest";

/** Agentic coding model interface for AST-aware patching */
export class CoderAgent {
  /** Creates a new coder agent */
  constructor(config: CoderConfig);

  /** Generates skeleton (pass 1) for a file */
  async generateSkeleton(entry: PlannedFileEntry, context: FileDigest[]): Promise<string>;

  /** Generates implementation (pass 2) for a file */
  async generateImplementation(
    skeleton: string,
    entry: PlannedFileEntry,
    context: FileDigest[]
  ): Promise<string>;

  /** Applies a patch to an existing file */
  async applyPatch(filePath: string, patch: Patch): Promise<string>;

  /** Refactors code based on instructions */
  async refactor(code: string, instructions: string): Promise<string>;

  /** Fixes lint/type errors in code */
  async fixErrors(code: string, errors: Diagnostic[]): Promise<string>;
}

/** Coder configuration */
export interface CoderConfig {
  model: string;
  temperature?: number;
  maxTokens?: number;
  passMode: "skeleton" | "implementation" | "both";
}

/** A planned file entry (mirrored from manifest) */
export interface PlannedFileEntry {
  path: string;
  purpose: string;
  expectedExports: string[];
  dependencies: string[];
  status: "planned" | "written" | "verified";
}

/** Code patch representation */
export interface Patch {
  filePath: string;
  operations: PatchOperation[];
}

/** Single patch operation */
export interface PatchOperation {
  type: "insert" | "delete" | "replace";
  startLine: number;
  endLine: number;
  content?: string;
}

/** Diagnostic error from type checker/linter */
export interface Diagnostic {
  file: string;
  line: number;
  column: number;
  message: string;
  severity: "error" | "warning";
  code?: string;
}
