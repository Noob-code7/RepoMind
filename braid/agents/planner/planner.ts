/**
 * agents/planner/planner.ts — PRD → task graph + file manifest + test stubs.
 * LLM-backed (deep-reasoning model via stage 'plan'). Orchestrator owns
 * persistence; this module only produces a validated PlanOutput.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { completeJson } from '../../shared/llm_client.js';
import type { PlanOutput } from '../../shared/types.js';
import { validateManifest } from '../../shared/types.js';

export interface PlanRequest {
  project: string;
  /** Freeform PRD text. */
  prd: string;
  /** Human feedback from a prior gate rejection; folded into re-plan. */
  feedback?: string;
}

const PROMPT_PATH = join(
  dirname(fileURLToPath(import.meta.url)),
  'prompts',
  'plan_prompt.md',
);

let cachedSystemPrompt: string | null = null;

export function loadPlanSystemPrompt(): string {
  if (!cachedSystemPrompt) {
    cachedSystemPrompt = readFileSync(PROMPT_PATH, 'utf8');
  }
  return cachedSystemPrompt;
}

/** Pure prompt builder — unit-testable without LLM keys. */
export function buildPlannerUserPrompt(req: PlanRequest): string {
  const parts = [
    `PROJECT: ${req.project}`,
    `TARGET STACK: Node/TypeScript (single stack, no multi-language)`,
    ``,
    `PRD:`,
    req.prd,
  ];
  if (req.feedback && req.feedback.trim().length > 0) {
    parts.push(``, `PRIOR GATE FEEDBACK (must address):`, req.feedback);
  }
  parts.push(``, `Respond with ONLY the JSON plan object.`);
  return parts.join('\n');
}

/** Pure validator/normalizer — throws on invalid plans. */
export function parseAndValidatePlan(
  raw: unknown,
  project: string,
): PlanOutput {
  if (typeof raw !== 'object' || raw === null) {
    throw new Error('[planner] Plan must be a JSON object');
  }
  const obj = raw as Record<string, unknown>;
  if (typeof obj['taskGraph'] !== 'object' || obj['taskGraph'] === null) {
    throw new Error('[planner] Missing taskGraph');
  }
  if (!Array.isArray(obj['testStubs'])) {
    throw new Error('[planner] testStubs must be an array');
  }
  const manifest = { ...(obj['manifest'] as object), project } as unknown;
  validateManifest(manifest as never);

  const plan = {
    taskGraph: obj['taskGraph'],
    manifest,
    testStubs: obj['testStubs'],
  } as PlanOutput;

  // Cross-checks: task files ⊆ manifest, dependsOn ids exist, deps ⊆ manifest.
  const manifestPaths = new Set(plan.manifest.files.map((f) => f.path));
  const taskIds = new Set(plan.taskGraph.nodes.map((n) => n.id));
  for (const node of plan.taskGraph.nodes) {
    for (const dep of node.dependsOn) {
      if (!taskIds.has(dep)) {
        throw new Error(`[planner] Task ${node.id} depends on unknown ${dep}`);
      }
    }
    for (const f of node.files) {
      if (!manifestPaths.has(f)) {
        throw new Error(`[planner] Task ${node.id} lists unknown file ${f}`);
      }
    }
  }
  for (const entry of plan.manifest.files) {
    for (const dep of entry.dependencies) {
      if (!manifestPaths.has(dep)) {
        throw new Error(
          `[planner] ${entry.path} depends on unknown file ${dep}`,
        );
      }
      if (dep === entry.path) {
        throw new Error(`[planner] ${entry.path} cannot depend on itself`);
      }
    }
  }
  return plan;
}

/** End-to-end: PRD → validated PlanOutput via the plan-stage model. */
export async function planProject(req: PlanRequest): Promise<PlanOutput> {
  if (!req.project.trim()) throw new Error('[planner] project is required');
  if (!req.prd.trim()) throw new Error('[planner] prd is required');
  const raw = await completeJson<unknown>({
    stage: 'plan',
    systemPrompt: loadPlanSystemPrompt(),
    userPrompt: buildPlannerUserPrompt(req),
    maxTokens: 6000,
    temperature: 0.2,
  });
  return parseAndValidatePlan(raw, req.project);
}
