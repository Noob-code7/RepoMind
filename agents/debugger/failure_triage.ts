/**
 * agents/debugger/failure_triage.ts
 * Uses LLM to diagnose test/smoke failures and generate targeted PatchProposals.
 * Routes patches strictly through AstPatcher (never full-file regeneration).
 */
import fs from 'node:fs';
import path from 'node:path';
import { completeJson } from '../../shared/llm_client.js';
import { FileManifest, PatchProposal } from '../../shared/types.js';
import { AstPatcher } from '../executor/ast_patcher.js';

export interface TriageOutput {
  patches: PatchProposal[];
  summary: string;
}

export async function runFailureTriage(
  projectRoot: string,
  manifest: FileManifest,
  failures: Array<{ testName: string; file: string; errorOutput: string }>,
): Promise<{ proposals: PatchProposal[]; appliedCount: number }> {
  if (failures.length === 0) {
    return { proposals: [], appliedCount: 0 };
  }

  const systemPrompt = `You are the Braid Failure Triage Engine.
Analyze test failures and propose TARGETED patches to fix the issue.
DO NOT rewrite entire files. Specify the exact function name or anchor and its replacement code.

Output JSON matching:
{
  "summary": "Brief explanation of root cause",
  "patches": [
    {
      "path": "src/auth/login.ts",
      "anchor": "loginUser",
      "replacement": "export async function loginUser(...) { ... }",
      "reason": "Fix missing return value check"
    }
  ]
}`;

  // Gather current content of source files for context
  const sourceSnippets: string[] = [];
  for (const f of manifest.files) {
    const full = path.join(projectRoot, f.path);
    if (fs.existsSync(full)) {
      const content = fs.readFileSync(full, 'utf-8');
      sourceSnippets.push(`File: ${f.path}\n\`\`\`typescript\n${content}\n\`\`\``);
    }
  }

  const userPrompt = `TEST FAILURES:\n${failures
    .map((f) => `- [${f.testName}] in ${f.file}:\n  ${f.errorOutput}`)
    .join('\n\n')}\n\nCURRENT SOURCE FILES:\n${sourceSnippets.join('\n\n')}\n\n` +
    `Propose targeted patches to resolve these failures. Output JSON only.`;

  const triage = await completeJson<TriageOutput>({
    stage: 'triage',
    systemPrompt,
    userPrompt,
    maxTokens: 4096,
  });

  const proposals = Array.isArray(triage.patches) ? triage.patches : [];
  let appliedCount = 0;

  for (const patch of proposals) {
    console.log(`[failure_triage] Applying targeted patch to "${patch.path}" at anchor "${patch.anchor}"...`);
    const success = AstPatcher.applyToFile(projectRoot, patch);
    if (success) {
      appliedCount++;
    } else {
      console.warn(`[failure_triage] Failed to apply patch to ${patch.path}`);
    }
  }

  return { proposals, appliedCount };
}
