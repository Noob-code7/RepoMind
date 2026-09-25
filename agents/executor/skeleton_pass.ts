/**
 * agents/executor/skeleton_pass.ts
 * Pass 1: Generates signatures, types, and exports for every planned file in the manifest.
 * Writes each file's skeleton to the target project directory.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ManifestStore } from '../../orchestrator/manifest_store.js';
import { completeJson } from '../../shared/llm_client.js';
import { FileManifest, FileManifestEntry } from '../../shared/types.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

interface SkeletonResponse {
  files: Record<string, string>;
}

export async function runSkeletonPass(
  projectRoot: string,
  manifest: FileManifest,
  targetEntries?: FileManifestEntry[],
): Promise<string[]> {
  const entriesToRun = targetEntries ?? manifest.files;
  if (entriesToRun.length === 0) return [];

  const promptPath = path.join(__dirname, 'prompts', 'skeleton_prompt.md');
  const systemPrompt = fs.existsSync(promptPath)
    ? fs.readFileSync(promptPath, 'utf-8')
    : 'You are the Braid Skeleton Pass Engine. Output JSON { files: { [path]: code } }.';

  const userPrompt = `Project: ${manifest.project}\nGenerate skeletons for the following files:\n${entriesToRun
    .map(
      (f) =>
        `- Path: ${f.path}\n  Purpose: ${f.purpose}\n  Expected Exports: ${f.expectedExports.join(
          ', ',
        )}\n  Dependencies: ${f.dependencies.join(', ')}`,
    )
    .join('\n\n')}`;

  const res = await completeJson<SkeletonResponse>({
    stage: 'execute',
    systemPrompt,
    userPrompt,
    maxTokens: 8192,
  });

  const writtenFiles: string[] = [];

  for (const entry of entriesToRun) {
    let content = res.files?.[entry.path];

    // If model omitted or gave empty skeleton, provide a fallback skeleton with expected exports
    if (!content || !content.trim()) {
      const exportLines = entry.expectedExports.map(
        (exp) => `export function ${exp}(): any { /* SKELETON_ONLY */ throw new Error('Not implemented'); }`,
      );
      content = `/**\n * ${entry.path}\n * ${entry.purpose}\n */\n// SKELETON_ONLY\n${exportLines.join('\n\n')}\n`;
    }

    const fullPath = path.join(projectRoot, entry.path);
    fs.mkdirSync(path.dirname(fullPath), { recursive: true });
    fs.writeFileSync(fullPath, content, 'utf-8');

    entry.status = 'skeleton';
    writtenFiles.push(entry.path);
  }

  ManifestStore.save(projectRoot, manifest);
  return writtenFiles;
}
