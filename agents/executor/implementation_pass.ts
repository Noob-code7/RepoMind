/**
 * agents/executor/implementation_pass.ts
 * Pass 2: Fills in full logic, one file at a time.
 * Injects: (a) file skeleton, (b) full condensed codebase digest, (c) full source of direct dependencies only.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DigestStore } from '../../orchestrator/digest_store.js';
import { ManifestStore } from '../../orchestrator/manifest_store.js';
import { complete } from '../../shared/llm_client.js';
import { FileManifest, FileManifestEntry } from '../../shared/types.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function cleanCodeFences(raw: string): string {
  let cleaned = raw.trim();
  if (cleaned.startsWith('```')) {
    const firstNewline = cleaned.indexOf('\n');
    if (firstNewline !== -1) {
      cleaned = cleaned.slice(firstNewline + 1);
    }
  }
  if (cleaned.endsWith('```')) {
    const lastFence = cleaned.lastIndexOf('```');
    cleaned = cleaned.slice(0, lastFence);
  }
  return cleaned.trim();
}

export async function runImplementationPass(
  projectRoot: string,
  manifest: FileManifest,
  targetEntries?: FileManifestEntry[],
): Promise<string[]> {
  const entries = targetEntries ?? manifest.files;
  if (entries.length === 0) return [];

  const promptPath = path.join(__dirname, 'prompts', 'implementation_prompt.md');
  const systemPrompt = fs.existsSync(promptPath)
    ? fs.readFileSync(promptPath, 'utf-8')
    : 'You are the Braid Implementation Engine. Write production TypeScript code for the requested file.';

  // Build condensed codebase digest
  const digest = DigestStore.build(projectRoot, manifest);
  const digestPrompt = DigestStore.formatForPrompt(digest);

  const implemented: string[] = [];

  for (const entry of entries) {
    const fullPath = path.join(projectRoot, entry.path);
    const skeleton = fs.existsSync(fullPath)
      ? fs.readFileSync(fullPath, 'utf-8')
      : `// SKELETON\n${entry.expectedExports.map((e) => `export function ${e}(): void;`).join('\n')}`;

    // Read full source of ONLY direct dependencies
    const depSources: string[] = [];
    for (const dep of entry.dependencies) {
      const depPath = path.join(projectRoot, dep);
      if (fs.existsSync(depPath)) {
        const src = fs.readFileSync(depPath, 'utf-8');
        depSources.push(`### Dependency File: ${dep}\n\`\`\`typescript\n${src}\n\`\`\``);
      }
    }

    const userPrompt = `Project: ${manifest.project}\nTarget File to Implement: ${entry.path}\nPurpose: ${
      entry.purpose
    }\nExpected Exports: ${entry.expectedExports.join(', ')}\n\n` +
      `CURRENT SKELETON:\n\`\`\`typescript\n${skeleton}\n\`\`\`\n\n` +
      `FULL CODEBASE DIGEST (condensed):\n${digestPrompt}\n\n` +
      (depSources.length > 0
        ? `DIRECT DEPENDENCY FULL SOURCES:\n${depSources.join('\n\n')}\n\n`
        : 'DIRECT DEPENDENCIES: None\n\n') +
      `Write the complete implementation for "${entry.path}". Output ONLY the raw file source code.`;

    const code = await complete({
      stage: 'execute',
      systemPrompt,
      userPrompt,
      maxTokens: 8192,
    });

    const finalCode = cleanCodeFences(code);
    fs.mkdirSync(path.dirname(fullPath), { recursive: true });
    fs.writeFileSync(fullPath, finalCode, 'utf-8');

    entry.status = 'implemented';
    implemented.push(entry.path);

    // Save manifest progress after each file write
    ManifestStore.save(projectRoot, manifest);
  }

  // Refresh digest after implementation pass completes
  const updatedDigest = DigestStore.build(projectRoot, manifest);
  DigestStore.save(projectRoot, updatedDigest);

  return implemented;
}

export function validateImplementation(
  entry: FileManifestEntry,
  code: string,
): void {
  const trimmed = code.trim();
  if (!trimmed) {
    throw new Error(`[implementation_pass] Empty output for ${entry.path}`);
  }
  if (trimmed.startsWith('{')) {
    let parsed: unknown = null;
    try {
      parsed = JSON.parse(trimmed);
    } catch {
      parsed = null;
    }
    if (
      typeof parsed === 'object' &&
      parsed !== null &&
      Array.isArray((parsed as Record<string, unknown>)['files'])
    ) {
      throw new Error(
        `[implementation_pass] Protocol echo for ${entry.path}: got the skeleton JSON envelope, not source`,
      );
    }
  }
  const missing = entry.expectedExports.filter((sym) => !code.includes(sym));
  if (missing.length > 0) {
    throw new Error(
      `[implementation_pass] ${entry.path} dropped expected exports: ${missing.join(', ')}`,
    );
  }
}
