/**
 * agents/planner/planner.ts
 * Uses a deep-reasoning LLM to transform a PRD into:
 *  - Task graph
 *  - File manifest (all status: 'planned')
 *  - Vitest test stubs defining correctness before code is written
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { completeJson } from '../../shared/llm_client.js';
import { PlanOutput, validateManifest } from '../../shared/types.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export interface PlanOptions {
  prd: string;
  projectName?: string;
  feedback?: string;
  previousManifest?: unknown;
}

export async function runPlanner(options: PlanOptions): Promise<PlanOutput> {
  const promptPath = path.join(__dirname, 'prompts', 'plan_prompt.md');
  const systemPrompt = fs.existsSync(promptPath)
    ? fs.readFileSync(promptPath, 'utf-8')
    : 'You are the Braid Planner agent. Output JSON { taskGraph, manifest, testStubs }.';

  let userPrompt = `Product Requirements Document (PRD):\n\n${options.prd}\n`;
  if (options.projectName) {
    userPrompt += `\nTarget Project Name: ${options.projectName}\n`;
  }
  if (options.feedback) {
    userPrompt += `\n[CRITICAL USER FEEDBACK / REVISION REQUEST FROM PREVIOUS CYCLE]:\n${options.feedback}\nPlease update the plan, manifest, and test stubs to directly resolve this feedback.\n`;
  }

  const output = await completeJson<PlanOutput>({
    stage: 'plan',
    systemPrompt,
    userPrompt,
    maxTokens: 8192,
  });

  // Ensure default structure
  if (!output.manifest) {
    throw new Error('[planner] Planner did not produce a manifest');
  }
  if (!output.manifest.project) {
    output.manifest.project = options.projectName || 'braid-project';
  }

  // Ensure files array exists and validate manifest
  output.manifest.files = output.manifest.files || [];
  for (const f of output.manifest.files) {
    f.status = 'planned';
    f.dependencies = f.dependencies || [];
    f.expectedExports = f.expectedExports || [];
  }
  validateManifest(output.manifest);

  output.taskGraph = output.taskGraph || { nodes: [] };
  output.testStubs = output.testStubs || [];

  return output;
}
