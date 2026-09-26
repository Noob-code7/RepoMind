/**
 * tui/models.ts — Compact model selector beneath the chat input.
 * Derives the menu ONLY from the user's configured providers (env config).
 * Never hardcodes unavailable models or invents API access.
 */
import { config } from '../shared/config.js';
import { effectiveModel, type LlmStage } from '../shared/llm_client.js';

export interface ModelOption {
  /** Raw model id used for API routing (e.g. deepseek-reasoner). */
  id: string;
  /** Short human label (e.g. DeepSeek Reasoner). */
  label: string;
  /** Short display name for the status strip. */
  short: string;
  /** Which configured slot provides it. */
  slot: LlmStage;
}

/** Human-friendly label without inventing new models. */
export function friendlyName(id: string): string {
  const low = id.toLowerCase();
  if (low.includes('nemotron-3-ultra')) return 'Nemotron 3 Ultra';
  if (low.includes('nemotron-3.5-lightning') || low.includes('nemotron-3-5-lightning')) return 'Nemotron Lightning';
  if (low.includes('gemma-4')) return 'Gemma 4';
  if (low.includes('gemma')) return 'Gemma';
  if (low.includes('gemini-3.8') || low.includes('gemini-3-8')) return 'Gemini 3.8 Flash';
  if (low.includes('gemini-3')) return 'Gemini 3';
  if (low.includes('deepseek-reasoner')) return 'DeepSeek Reasoner';
  if (low.includes('deepseek')) return 'DeepSeek Chat';
  if (low.includes('gemini') && low.includes('flash')) return 'Gemini Flash';
  if (low.includes('gemini')) return 'Gemini';
  if (low.includes('sonnet')) return 'Claude Sonnet';
  if (low.includes('opus')) return 'Claude Opus';
  if (low.includes('claude')) return 'Claude';
  if (low.includes('nemotron')) return 'Nemotron';
  if (low.includes('qwen2.5') || low.includes('qwen-2.5')) return 'Qwen 2.5 Coder';
  if (low.includes('qwen')) return 'Qwen Coder';
  if (low.includes('gpt') && low.includes('codex')) return 'GPT Codex';
  if (low.includes('gpt') && low.includes('mini')) return 'GPT Mini';
  if (low.includes('gpt')) return 'GPT';
  // Fallback: title-case the raw id (no invention, just formatting).
  return id
    .split(/[/:_-]/)
    .pop()!
    .replace(/([a-z])([A-Z])/g, '$1 $2');
}

function shortName(label: string): string {
  return label.toLowerCase().replace(/\s+/g, '-').slice(0, 24);
}

import { listOllamaModels } from '../shared/ollama_client.js';

let discoveredLocalModels: string[] = [];

export function setDiscoveredLocalModels(models: string[]): void {
  discoveredLocalModels = [...models];
}

export function getDiscoveredLocalModels(): string[] {
  return [...discoveredLocalModels];
}

export async function refreshAvailableModels(): Promise<ModelOption[]> {
  try {
    const models = await listOllamaModels();
    setDiscoveredLocalModels(models);
  } catch {
    /* Ollama offline */
  }
  return availableModels();
}

/**
 * Models actually available through configured providers.
 * Dedupes identical ids across slots; caps at 8 for the menu.
 */
export function availableModels(): ModelOption[] {
  const slots: LlmStage[] = ['chat', 'plan', 'review', 'execute', 'triage', 'report'];
  const seen = new Set<string>();
  const out: ModelOption[] = [];

  // 1. Include discovered local Ollama models first
  for (const localId of discoveredLocalModels) {
    if (!localId || seen.has(localId.toLowerCase())) continue;
    seen.add(localId.toLowerCase());
    const label = friendlyName(localId);
    out.push({ id: localId, label, short: shortName(label), slot: 'chat' });
    if (out.length >= 8) return out;
  }

  // 2. Include configured stage models
  for (const slot of slots) {
    let id = '';
    try {
      id = effectiveModel(slot);
    } catch {
      continue;
    }
    if (!id || seen.has(id.toLowerCase())) continue;
    seen.add(id.toLowerCase());
    const label = friendlyName(id);
    out.push({ id, label, short: shortName(label), slot });
    if (out.length >= 8) break;
  }
  // Guarantee at least the env-configured ids even if effectiveModel throws.
  if (out.length === 0) {
    const fallback = [
      config.chatModel,
      config.planModel,
      config.reviewModel,
      config.executeModel,
    ].filter(Boolean);
    for (const id of [...new Set(fallback)].slice(0, 5)) {
      const label = friendlyName(id);
      out.push({ id, label, short: shortName(label), slot: 'plan' });
    }
  }
  return out;
}

/** Resolve the display label for the active chat model id. */
export function labelForModel(id: string): string {
  const found = availableModels().find(
    (m) => m.id.toLowerCase() === id.toLowerCase(),
  );
  return found ? found.label : friendlyName(id);
}

/** Short token for the minimal status strip. */
export function shortForModel(id: string): string {
  return labelForModel(id).toLowerCase().replace(/\s+/g, '-');
}
