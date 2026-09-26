/**
 * shared/ollama_client.ts — Local Ollama API client with streaming and discovery.
 * Connects to Ollama via local HTTP or curl.exe transport (WSL friendly).
 * Supports token-by-token streaming, health checks, and dynamic model discovery.
 */

import { spawn, execSync } from 'node:child_process';

export interface OllamaModelInfo {
  name: string;
  size?: number;
  modified_at?: string;
  digest?: string;
}

export interface OllamaMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface OllamaChatOptions {
  model: string;
  messages: OllamaMessage[];
  temperature?: number;
  maxTokens?: number;
  signal?: AbortSignal;
  baseUrl?: string;
}

export interface OllamaStreamChatOptions extends OllamaChatOptions {
  onToken: (token: string) => void;
}

type MockOllamaHandler = (options: OllamaChatOptions, onToken?: (token: string) => void) => Promise<string> | string;
let mockOllamaHandler: MockOllamaHandler | null = null;

export function setMockOllamaHandler(handler: MockOllamaHandler | null): void {
  mockOllamaHandler = handler;
}

export function hasMockOllamaHandler(): boolean {
  return mockOllamaHandler !== null;
}

export function getOllamaBaseUrl(): string {
  const url = process.env.OLLAMA_BASE_URL || process.env.LOCAL_LLM_BASE_URL || 'http://localhost:11434';
  return url.replace(/\/+$/, '');
}

/** Check if curl.exe is available (used as a fallback in WSL environments). */
let cachedHasCurlExe: boolean | null = null;
function hasCurlExe(): boolean {
  if (cachedHasCurlExe !== null) return cachedHasCurlExe;
  try {
    execSync('which curl.exe', { stdio: 'ignore' });
    cachedHasCurlExe = true;
  } catch {
    cachedHasCurlExe = false;
  }
  return cachedHasCurlExe;
}

/** Query Ollama tags using curl.exe when direct fetch is blocked by virtual network rules. */
async function queryViaCurlExe(url: string, bodyJson?: string, signal?: AbortSignal, onChunk?: (chunk: string) => void): Promise<string> {
  return new Promise((resolve, reject) => {
    const args = ['-s', '-N'];
    if (bodyJson) {
      args.push('-X', 'POST', url, '-H', 'Content-Type: application/json', '-d', bodyJson);
    } else {
      args.push(url);
    }

    const child = spawn('curl.exe', args);
    let fullOutput = '';
    let errOutput = '';

    if (signal) {
      signal.addEventListener('abort', () => {
        child.kill();
        reject(new Error('Request aborted'));
      });
    }

    child.stdout.on('data', (d: Buffer) => {
      const text = d.toString('utf8');
      fullOutput += text;
      if (onChunk) {
        onChunk(text);
      }
    });

    child.stderr.on('data', (d: Buffer) => {
      errOutput += d.toString('utf8');
    });

    child.on('error', (err) => reject(err));
    child.on('close', (code) => {
      if (code === 0) {
        resolve(fullOutput);
      } else {
        reject(new Error(`curl.exe exited with code ${code}: ${errOutput}`));
      }
    });
  });
}

/** Check if Ollama is accessible and discover running models. */
export async function checkOllamaHealth(baseUrl?: string): Promise<{
  available: boolean;
  error?: string;
  models: string[];
  transport: 'mock' | 'fetch' | 'curlexe' | 'none';
}> {
  if (mockOllamaHandler) {
    return {
      available: true,
      models: ['qwen2.5-coder:7b', 'qwen2.5-coder:3b', 'llama3.2:latest'],
      transport: 'mock',
    };
  }

  const base = baseUrl || getOllamaBaseUrl();
  const tagsUrl = `${base}/api/tags`;

  // 1. Try standard fetch with short timeout
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 1200);
    const resp = await fetch(tagsUrl, { signal: controller.signal });
    clearTimeout(timer);
    if (resp.ok) {
      const data = (await resp.json()) as { models?: Array<{ name: string }> };
      const models = (data.models || []).map((m) => m.name);
      return { available: true, models, transport: 'fetch' };
    }
  } catch {
    /* Fall through to curl.exe if in WSL */
  }

  // 2. If fetch fails, try curl.exe (WSL -> Windows bridge)
  if (hasCurlExe()) {
    try {
      const out = await queryViaCurlExe(tagsUrl);
      const data = JSON.parse(out) as { models?: Array<{ name: string }> };
      const models = (data.models || []).map((m) => m.name);
      return { available: true, models, transport: 'curlexe' };
    } catch (err) {
      return {
        available: false,
        error: `Ollama is unreachable on ${base}. Error: ${(err as Error).message}`,
        models: [],
        transport: 'none',
      };
    }
  }

  return {
    available: false,
    error: `Ollama is not running on ${base}. Please start Ollama with 'ollama serve'.`,
    models: [],
    transport: 'none',
  };
}

/** List all dynamically available models in Ollama. */
export async function listOllamaModels(baseUrl?: string): Promise<string[]> {
  const health = await checkOllamaHealth(baseUrl);
  return health.models;
}

/** Stream a conversation response from Ollama token by token. */
export async function streamOllamaChat(options: OllamaStreamChatOptions): Promise<string> {
  if (mockOllamaHandler) {
    const full = await mockOllamaHandler(options, options.onToken);
    return full;
  }

  const base = options.baseUrl || getOllamaBaseUrl();
  const cleanModel = options.model.replace(/^(ollama\/|local\/)/, '');

  const payload = {
    model: cleanModel,
    messages: options.messages,
    stream: true,
    options: {
      temperature: options.temperature ?? 0.3,
      num_predict: options.maxTokens ?? 2048,
    },
  };

  // 1. Try native fetch streaming
  try {
    const resp = await fetch(`${base}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: options.signal,
    });

    if (resp.ok && resp.body) {
      let accumulated = '';
      const reader = resp.body.getReader();
      const decoder = new TextDecoder('utf8');
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';

        for (const line of lines) {
          if (!line.trim()) continue;
          try {
            const parsed = JSON.parse(line) as { message?: { content?: string }; done?: boolean };
            const content = parsed.message?.content ?? '';
            if (content) {
              accumulated += content;
              options.onToken(content);
            }
          } catch {
            /* ignore partial chunk */
          }
        }
      }
      return accumulated;
    }
  } catch (err) {
    if ((err as Error).name === 'AbortError') throw err;
    // Fall through to curl.exe
  }

  // 2. Try curl.exe streaming fallback (WSL environment)
  if (hasCurlExe()) {
    let accumulated = '';
    let lineBuffer = '';

    await queryViaCurlExe(
      `${base}/api/chat`,
      JSON.stringify(payload),
      options.signal,
      (chunk) => {
        lineBuffer += chunk;
        const lines = lineBuffer.split('\n');
        lineBuffer = lines.pop() ?? '';

        for (const line of lines) {
          if (!line.trim()) continue;
          try {
            const parsed = JSON.parse(line) as { message?: { content?: string }; done?: boolean };
            const content = parsed.message?.content ?? '';
            if (content) {
              accumulated += content;
              options.onToken(content);
            }
          } catch {
            /* ignore partial JSON line */
          }
        }
      },
    );
    return accumulated;
  }

  throw new Error(`Failed to stream from Ollama at ${base}. Ensure Ollama is running ('ollama serve').`);
}

/** Non-streaming chat completion from Ollama. */
export async function completeOllamaChat(options: OllamaChatOptions): Promise<string> {
  let reply = '';
  const full = await streamOllamaChat({
    ...options,
    onToken: (tok) => {
      reply += tok;
    },
  });
  return full || reply;
}
