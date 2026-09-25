# Braid LLM Provider Interface & Validation Pipeline

## Provider Abstraction

Braid decouples business logic from specific AI model vendors through `LLMProvider`:

```typescript
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
```

---

## Validation & Automated Self-Repair Flow

Model responses are never trusted directly:

```text
       LLM Output
           │
           ▼
[JSON Extraction & Fence Stripping]
           │
           ▼
     [JSON.parse()]
           │
           ▼
[Strict Zod Schema Validation]
    │                 │
 (Valid)           (Invalid)
    │                 │
    ▼                 ▼
 Return T      [Self-Repair Retry]
               (Injects Zod error
                into user prompt)
                      │
                      ▼
               [Re-validate]
```

---

## Supported Providers

1. **`OpenAIProvider`**: Connects via `openai` SDK using `OPENAI_API_KEY`. Defaults to `gpt-4o`.
2. **`AnthropicProvider`**: Connects via `@anthropic-ai/sdk` using `ANTHROPIC_API_KEY`. Defaults to `claude-3-5-sonnet-20241022`.
3. **`MockProvider`**: 100% deterministic, offline mock provider for automated test suites, CI/CD, and offline demonstration.
