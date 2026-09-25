/**
 * agents/reviewer/reviewer.ts
 * Calls an independent model to critique the plan produced by Planner.
 * Evaluates completeness, risks, and provides a numeric risk score (0..1).
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { completeJson } from '../../shared/llm_client.js';
import { PlanOutput, ReviewOutput } from '../../shared/types.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export async function runReviewer(
  prd: string,
  plan: PlanOutput,
): Promise<ReviewOutput> {
  const promptPath = path.join(__dirname, 'prompts', 'review_prompt.md');
  const systemPrompt = fs.existsSync(promptPath)
    ? fs.readFileSync(promptPath, 'utf-8')
    : 'You are the Braid Reviewer agent. Output JSON { critiques, risks, riskScore }.';

  const userPrompt = `ORIGINAL PRD:\n${prd}\n\nPROPOSED PLAN:\nTask Graph Nodes: ${plan.taskGraph.nodes.length}\nFiles Planned: ${
    plan.manifest.files.length
  }\nManifest JSON:\n${JSON.stringify(
    plan.manifest,
    null,
    2,
  )}\n\nTest Stubs (${plan.testStubs.length}):\n${plan.testStubs
    .map((s) => `- ${s.file}: ${s.name}`)
    .join('\n')}\n`;

  const output = await completeJson<ReviewOutput>({
    stage: 'review',
    systemPrompt,
    userPrompt,
    maxTokens: 4096,
  });

  return {
    critiques: Array.isArray(output.critiques) ? output.critiques : [],
    risks: Array.isArray(output.risks) ? output.risks : [],
    riskScore: typeof output.riskScore === 'number' ? Math.max(0, Math.min(1, output.riskScore)) : 0.5,
  };
}

export const reviewPlan = runReviewer;
