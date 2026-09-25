/**
 * providers/openai_provider.ts
 * OpenAI implementation of LLMProvider with strict Zod structured output validation.
 */
import OpenAI from 'openai';
import { z } from 'zod';
import {
  LLMProvider,
  LLMRequest,
  executeWithZodValidation,
} from './llm_provider.js';

export class OpenAIProvider implements LLMProvider {
  public readonly name = 'OpenAIProvider';
  private client: OpenAI | null = null;
  private defaultModel: string;

  constructor(apiKey?: string, defaultModel = 'gpt-4o') {
    const key = apiKey || process.env['OPENAI_API_KEY'];
    if (key) {
      this.client = new OpenAI({ apiKey: key });
    }
    this.defaultModel = defaultModel;
  }

  async generateRaw(request: LLMRequest): Promise<string> {
    if (!this.client) {
      throw new Error(
        'Planning failed because the OpenAI API key is missing.\n\nSet:\nOPENAI_API_KEY=...\n\nThen re-run planning.',
      );
    }

    const res = await this.client.chat.completions.create({
      model: request.model || this.defaultModel,
      temperature: request.temperature ?? 0.2,
      max_tokens: request.maxTokens ?? 4096,
      messages: [
        { role: 'system', content: request.systemPrompt },
        { role: 'user', content: request.userPrompt },
      ],
    });

    return res.choices[0]?.message?.content ?? '';
  }

  async generateStructured<T>(
    request: LLMRequest,
    schema: z.ZodType<T, any, any>,
  ): Promise<T> {
    return executeWithZodValidation(this, request, schema);
  }
}
