/**
 * tui/conversation_store.ts — Project-scoped persistent conversation memory.
 * Stores conversation history per-project in generated_projects/<project>/conversation.json.
 * Manages context budget (summaries of older turns + recent sliding window).
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { config } from '../shared/config.js';
import type { OllamaMessage } from '../shared/ollama_client.js';
import type { Mode } from './modes.js';

export interface ConversationMessage {
  id: string;
  role: 'user' | 'assistant' | 'system' | 'tool';
  content: string;
  timestamp: number;
  mode: Mode;
  metadata?: Record<string, unknown>;
}

export interface ConversationContextOptions {
  prd?: string;
  manifestSummary?: string;
  testSummary?: string;
  currentMode: Mode;
  maxRecentMessages?: number;
  generatedRoot?: string;
}

function projectDir(project: string, root?: string): string {
  const base = root || config.generatedRoot;
  return resolve(base, project);
}

function conversationFilePath(project: string, root?: string): string {
  return join(projectDir(project, root), 'conversation.json');
}

/** Load conversation messages for a specific project. */
export function loadProjectConversation(project: string, root?: string): ConversationMessage[] {
  const file = conversationFilePath(project, root);
  try {
    if (!existsSync(file)) return [];
    const raw = readFileSync(file, 'utf8');
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (m) =>
        m &&
        typeof m.id === 'string' &&
        typeof m.content === 'string' &&
        typeof m.role === 'string',
    );
  } catch {
    return [];
  }
}

/** Save conversation messages for a specific project. */
export function saveProjectConversation(
  project: string,
  messages: ConversationMessage[],
  root?: string,
): void {
  try {
    const dir = projectDir(project, root);
    mkdirSync(dir, { recursive: true });
    const file = join(dir, 'conversation.json');
    writeFileSync(file, JSON.stringify(messages, null, 2) + '\n', 'utf8');
  } catch {
    /* Best effort persistence */
  }
}

/** Append a new message to the project's conversation history. */
export function appendProjectMessage(
  project: string,
  msg: { role: ConversationMessage['role']; content: string; mode: Mode; metadata?: Record<string, unknown> },
  root?: string,
): ConversationMessage {
  const messages = loadProjectConversation(project, root);
  const fullMsg: ConversationMessage = {
    id: `msg-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    timestamp: Date.now(),
    role: msg.role,
    content: msg.content,
    mode: msg.mode,
    metadata: msg.metadata,
  };
  messages.push(fullMsg);
  saveProjectConversation(project, messages, root);
  return fullMsg;
}

/** Clear conversation history for a project. */
export function clearProjectConversation(project: string, root?: string): void {
  saveProjectConversation(project, [], root);
}

/**
 * Builds the context payload for LLM requests.
 * Includes system instructions, project awareness, and managed conversation history.
 */
export function buildConversationContext(
  project: string,
  options: ConversationContextOptions,
): OllamaMessage[] {
  const allMessages = loadProjectConversation(project, options.generatedRoot);
  const maxRecent = options.maxRecentMessages ?? 12;

  // 1. Build system prompt with project awareness
  const sysParts: string[] = [
    `You are Braid, an expert autonomous AI software development assistant.`,
    `You are currently assisting with project "${project}".`,
    `Current Mode: [${options.currentMode.toUpperCase()}]`,
    '',
    `Guidelines:`,
    `- Provide direct, technically deep, and actionable answers.`,
    `- Keep formatting clean with GitHub markdown.`,
    `- When asked about project architecture, scalability, or code, cite actual project context.`,
    `- Do not hallucinate file contents or test results that do not exist.`,
  ];

  if (options.prd) {
    const snippet = options.prd.length > 2000 ? `${options.prd.slice(0, 2000)}… [truncated]` : options.prd;
    sysParts.push(`\nActive Project PRD / Requirements:\n${snippet}`);
  }

  if (options.manifestSummary) {
    sysParts.push(`\nPlanned / Implemented Files:\n${options.manifestSummary}`);
  }

  if (options.testSummary) {
    sysParts.push(`\nLatest Test Results:\n${options.testSummary}`);
  }

  const result: OllamaMessage[] = [
    { role: 'system', content: sysParts.join('\n') },
  ];

  // 2. Sliding window + condensed summary of older messages if history is long
  if (allMessages.length > maxRecent) {
    const older = allMessages.slice(0, allMessages.length - maxRecent);
    const summaryLines = older
      .filter((m) => m.role === 'user' || m.role === 'assistant')
      .slice(-10)
      .map((m) => `${m.role === 'user' ? 'User asked' : 'Assistant noted'}: ${m.content.slice(0, 120)}`);

    if (summaryLines.length > 0) {
      result.push({
        role: 'system',
        content: `Summary of earlier conversation topics:\n${summaryLines.join('\n')}`,
      });
    }
  }

  // 3. Recent conversation messages
  const recent = allMessages.slice(-maxRecent);
  for (const m of recent) {
    if (m.role === 'user' || m.role === 'assistant') {
      result.push({
        role: m.role,
        content: m.content,
      });
    }
  }

  return result;
}
