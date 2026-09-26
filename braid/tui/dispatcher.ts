/**
 * tui/dispatcher.ts — Centralized Unified Input Dispatcher.
 * Distinguishes slash commands from natural-language inputs.
 * Routes natural language according to the currently active Mode (Chat, Plan, Review, Build, Debug, Report).
 * Performs intent classification to distinguish questions from actionable SDLC requests.
 */

import type { Mode } from './modes.js';

export type IntentType =
  | 'question'
  | 'action_plan'
  | 'action_review'
  | 'action_build'
  | 'action_debug'
  | 'action_report';

export interface DispatcherIntent {
  type: IntentType;
  rawText: string;
  isSlashCommand: boolean;
  command?: string;
  argument?: string;
}

/** Check if the input line is an explicit slash command. */
export function isSlashCommand(input: string): boolean {
  return input.trim().startsWith('/');
}

/** Parse an explicit slash command string. */
export function parseSlashCommand(input: string): { command: string; argument: string } {
  const line = input.trim();
  const withoutSlash = line.startsWith('/') ? line.slice(1) : line;
  const [cmdRaw, ...rest] = withoutSlash.split(/\s+/);
  return {
    command: (cmdRaw ?? '').toLowerCase(),
    argument: rest.join(' ').trim(),
  };
}

/**
 * Classifies natural language input based on current mode and text semantics.
 * Ensures questions (e.g. "What did we decide about the database?") do not
 * trigger accidental pipeline execution.
 */
export function detectIntent(raw: string, mode: Mode): DispatcherIntent {
  const text = raw.trim();
  if (isSlashCommand(text)) {
    const { command, argument } = parseSlashCommand(text);
    return {
      type: 'question',
      rawText: text,
      isSlashCommand: true,
      command,
      argument,
    };
  }

  // Chat mode is always conversational
  if (mode === 'chat') {
    return { type: 'question', rawText: text, isSlashCommand: false };
  }

  const low = text.toLowerCase();

  // Explicit question patterns
  const isQuestion =
    text.endsWith('?') ||
    /^(what|why|how|can|could|is|are|tell me|explain|describe|who|where|which|did we|do we|have we)\b/i.test(text) ||
    /\b(what do you think|how could|explain the|what did we decide|why did|what is the)\b/i.test(low);

  if (isQuestion) {
    return { type: 'question', rawText: text, isSlashCommand: false };
  }

  // Mode-specific action intents
  switch (mode) {
    case 'plan':
      return { type: 'action_plan', rawText: text, isSlashCommand: false };

    case 'review':
      return { type: 'action_review', rawText: text, isSlashCommand: false };

    case 'build':
      return { type: 'action_build', rawText: text, isSlashCommand: false };

    case 'debug':
      return { type: 'action_debug', rawText: text, isSlashCommand: false };

    case 'report':
      return { type: 'action_report', rawText: text, isSlashCommand: false };

    default:
      return { type: 'question', rawText: text, isSlashCommand: false };
  }
}

export interface DispatchHandlerContext {
  mode: Mode;
  project: string;
  hasPlan: () => boolean;
  isPlanApproved: () => boolean;
  actChat: (prompt: string) => Promise<void>;
  actPlan: (prompt?: string) => Promise<void>;
  actReview: (prompt?: string) => Promise<void>;
  actBuild: (prompt?: string) => Promise<void>;
  actDebug: (prompt?: string) => Promise<void>;
  actReport: (prompt?: string) => Promise<void>;
  handleSlashCommand: (cmd: string, arg: string) => Promise<boolean>;
  pushMessage: (role: 'user' | 'assistant' | 'system' | 'error' | 'tool', content: string, mode?: Mode) => void;
}

/**
 * Central dispatcher entry point.
 * Returns false when the application should terminate (e.g. /quit).
 */
export async function dispatchInput(
  raw: string,
  ctx: DispatchHandlerContext,
): Promise<boolean> {
  const line = raw.trim();
  if (!line) return true;

  const intent = detectIntent(line, ctx.mode);

  // 1. Explicit slash command
  if (intent.isSlashCommand) {
    return ctx.handleSlashCommand(intent.command!, intent.argument!);
  }

  // 2. Mode-aware routing
  switch (ctx.mode) {
    case 'chat': {
      await ctx.actChat(line);
      return true;
    }

    case 'plan': {
      if (intent.type === 'action_plan') {
        await ctx.actPlan(line);
      } else {
        // Question about plan
        await ctx.actChat(`[Context: Plan Mode question regarding plan / architecture]\n${line}`);
      }
      return true;
    }

    case 'review': {
      if (intent.type === 'action_review') {
        await ctx.actReview(line);
      } else {
        // Question about review
        await ctx.actChat(`[Context: Review Mode question regarding critiques, risks or requirements]\n${line}`);
      }
      return true;
    }

    case 'build': {
      if (intent.type === 'action_build') {
        // Guard: check if plan exists and is approved
        if (!ctx.hasPlan()) {
          ctx.pushMessage(
            'assistant',
            '⚠️ **Cannot execute build**: No plan exists yet.\n\nSwitch to **Plan mode** (press `Tab`) and submit your requirements to generate a plan first.',
            'build',
          );
          return true;
        }

        if (!ctx.isPlanApproved()) {
          ctx.pushMessage(
            'assistant',
            '⚠️ **Execution blocked**: The plan has not been approved at Gate 1.\n\nReview the plan and approve it before building code, or run `/plan` to revise.',
            'build',
          );
          return true;
        }

        await ctx.actBuild(line);
      } else {
        // Question about build
        await ctx.actChat(`[Context: Build Mode question regarding implementation status or code generation]\n${line}`);
      }
      return true;
    }

    case 'debug': {
      if (intent.type === 'action_debug') {
        await ctx.actDebug(line);
      } else {
        // Question about tests
        await ctx.actChat(`[Context: Debug Mode question regarding test failures or debugging]\n${line}`);
      }
      return true;
    }

    case 'report': {
      if (intent.type === 'action_report') {
        await ctx.actReport(line);
      } else {
        // Question about metrics / report
        await ctx.actChat(`[Context: Report Mode question regarding test pass rate, PRD coverage or manifest completeness]\n${line}`);
      }
      return true;
    }

    default:
      await ctx.actChat(line);
      return true;
  }
}
