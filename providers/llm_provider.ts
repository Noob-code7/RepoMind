/**
 * providers/llm_provider.ts
 * Provider-agnostic LLM interface with strict Zod schema validation and self-repair.
 */
import { z } from 'zod';

export interface LLMRequest {
  systemPrompt: string;
  userPrompt: string;
  model?: string;
  temperature?: number;
  maxTokens?: number;
}

export interface LLMProvider {
  readonly name: string;
  generateRaw(request: LLMRequest): Promise<string>;
  generateStructured<T>(
    request: LLMRequest,
    schema: z.ZodType<T, any, any>,
  ): Promise<T>;
}

/**
 * Clean and extract JSON from raw model string response.
 */
export function extractJsonFromText(raw: string): string {
  let cleaned = raw.trim();

  // Strip markdown code fences if present
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
  cleaned = cleaned.trim();

  // Find outermost JSON object or array
  const startBrace = cleaned.indexOf('{');
  const startBracket = cleaned.indexOf('[');

  let startIdx = -1;
  if (startBrace !== -1 && startBracket !== -1) {
    startIdx = Math.min(startBrace, startBracket);
  } else if (startBrace !== -1) {
    startIdx = startBrace;
  } else if (startBracket !== -1) {
    startIdx = startBracket;
  }

  if (startIdx !== -1) {
    cleaned = cleaned.slice(startIdx);
  }

  const endBrace = cleaned.lastIndexOf('}');
  const endBracket = cleaned.lastIndexOf(']');
  const endIdx = Math.max(endBrace, endBracket);

  if (endIdx !== -1) {
    cleaned = cleaned.slice(0, endIdx + 1);
  }

  return cleaned.trim();
}

/**
 * Execute LLM call with strict Zod parsing, retrying with repair nudge on failure.
 */
export async function executeWithZodValidation<T>(
  provider: { generateRaw(req: LLMRequest): Promise<string> },
  request: LLMRequest,
  schema: z.ZodType<T, any, any>,
  maxRetries = 2,
): Promise<T> {
  let currentRequest = { ...request };

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    const raw = await provider.generateRaw(currentRequest);
    try {
      const jsonStr = extractJsonFromText(raw);
      const parsed = JSON.parse(jsonStr);
      const validated = schema.parse(parsed);
      return validated;
    } catch (err: unknown) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      if (attempt === maxRetries) {
        throw new Error(
          `[LLMProvider] Failed strict JSON schema validation after ${maxRetries} attempts: ${errorMsg}\nRaw snippet: ${raw.slice(
            0,
            300,
          )}`,
        );
      }

      // Repair prompt for retry
      currentRequest = {
        ...request,
        userPrompt:
          `${request.userPrompt}\n\n` +
          `[CRITICAL SCHEMA VALIDATION ERROR]:\n${errorMsg}\n` +
          `Your previous reply did not match the required schema. Reply ONLY with valid JSON strictly conforming to the requested schema. No markdown fences, no explanatory text.`,
      };
    }
  }

  throw new Error('[LLMProvider] Unreachable validation error');
}
