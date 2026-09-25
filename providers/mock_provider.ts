/**
 * providers/mock_provider.ts
 * Deterministic Mock LLM Provider for unit tests, offline demos, and simulated edge cases.
 */
import { z } from 'zod';
import {
  LLMProvider,
  LLMRequest,
  executeWithZodValidation,
} from './llm_provider.js';

export type MockHandler = (request: LLMRequest) => Promise<string> | string;

export class MockProvider implements LLMProvider {
  public readonly name: string;
  private handler: MockHandler;

  constructor(name = 'MockProvider', handler?: MockHandler) {
    this.name = name;
    this.handler =
      handler ||
      ((req) => {
        return JSON.stringify({ message: 'Default mock response', reqSummary: req.userPrompt.slice(0, 50) });
      });
  }

  setHandler(handler: MockHandler): void {
    this.handler = handler;
  }

  async generateRaw(request: LLMRequest): Promise<string> {
    return await this.handler(request);
  }

  async generateStructured<T>(
    request: LLMRequest,
    schema: z.ZodType<T, any, any>,
  ): Promise<T> {
    return executeWithZodValidation(this, request, schema);
  }
}
