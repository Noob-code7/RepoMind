/**
 * providers/anthropic_provider.ts
 * Anthropic implementation of LLMProvider with strict Zod structured output validation.
 */
import Anthropic from '@anthropic-ai/sdk';
import { z } from 'zod';
import {
  LLMProvider,
  LLMRequest,
  executeWithZodValidation,
} from './llm_provider.js';

export class AnthropicProvider implements LLMProvider {
  public readonly name = 'AnthropicProvider';
  private client: Anthropic | null = null;
  private defaultModel: string;

  constructor(apiKey?: string, defaultModel = 'claude-3-5-sonnet-20241022') {
    const key = apiKey || process.env['ANTHROPIC_API_KEY'];
    if (key) {
      this.client = new Anthropic({ apiKey: key });
    }
    this.defaultModel = defaultModel;
  }

  async generateRaw(request: LLMRequest): Promise<string> {
    if (!this.client) {
      throw new Error(
        'Planning failed because the Anthropic API key is missing.\n\nSet:\nANTHROPIC_API_KEY=...\n\nThen re-run planning.',
      );
    }

    const res = await this.client.messages.create({
      model: request.model || this.defaultModel,
      max_tokens: request.maxTokens ?? 4096,
      temperature: request.temperature ?? 0.2,
      system: request.systemPrompt,
      messages: [{ role: 'user', content: request.userPrompt }],
    });

    const block = res.content[0];
    if (!block || block.type !== 'text') {
      throw new Error('[AnthropicProvider] Empty or non-text response received');
    }
    return block.text;
  }

  async generateStructured<T>(
    request: LLMRequest,
    schema: z.ZodType<T, any, any>,
  ): Promise<T> {
    return executeWithZodValidation(this, request, schema);
  }
}
