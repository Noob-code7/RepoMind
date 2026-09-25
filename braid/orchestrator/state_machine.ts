/**
 * orchestrator/state_machine.ts — Deterministic pipeline driver.
 * Plan → Review → GateReview → Execute → Debug → Report → GateReport → Done.
 * NO LLM calls. Gate branches loop back to PLAN (agile loop).
 * Self-loop caps + human-gate bookkeeping live in loop_controller.ts (Phase 8);
 * this file owns pure state transitions so it stays unit-testable in isolation.
 */
import type { GateDecision, PipelineState } from '../shared/types.js';
import { PIPELINE_STATES } from '../shared/types.js';

export const INITIAL_STATE: PipelineState = 'PLAN';
export const TERMINAL_STATE: PipelineState = 'DONE';

/** Linear successor ignoring gate decisions (gates resolved separately). */
const LINEAR_NEXT: Record<Exclude<PipelineState, 'DONE'>, PipelineState> = {
  PLAN: 'REVIEW',
  REVIEW: 'GATE_REVIEW',
  GATE_REVIEW: 'EXECUTE', // or PLAN when rejected — see nextState()
  EXECUTE: 'DEBUG',
  DEBUG: 'REPORT',
  REPORT: 'GATE_REPORT',
  GATE_REPORT: 'DONE', // or PLAN when rejected — see nextState()
};

export function isTerminal(state: PipelineState): boolean {
  return state === TERMINAL_STATE;
}

/** States where a GateDecision is required to advance. */
export function requiresGate(state: PipelineState): boolean {
  return state === 'GATE_REVIEW' || state === 'GATE_REPORT';
}

/**
 * Pure transition. Gate states branch on `gate.approved`:
 * - GATE_REVIEW approved → EXECUTE, else → PLAN
 * - GATE_REPORT approved → DONE, else → PLAN (agile loop)
 * Non-gate states ignore `gate` and follow the linear order.
 * DONE is sticky.
 */
export function nextState(
  current: PipelineState,
  gate?: GateDecision,
): PipelineState {
  if (current === 'DONE') return 'DONE';
  if (current === 'GATE_REVIEW') {
    if (!gate) {
      throw new Error('[state_machine] GATE_REVIEW requires a GateDecision');
    }
    return gate.approved ? 'EXECUTE' : 'PLAN';
  }
  if (current === 'GATE_REPORT') {
    if (!gate) {
      throw new Error('[state_machine] GATE_REPORT requires a GateDecision');
    }
    return gate.approved ? 'DONE' : 'PLAN';
  }
  return LINEAR_NEXT[current];
}

export function isValidState(s: unknown): s is PipelineState {
  return (
    typeof s === 'string' &&
    (PIPELINE_STATES as readonly string[]).includes(s)
  );
}

export interface TransitionRecord {
  from: PipelineState;
  to: PipelineState;
  gate?: GateDecision;
}

/** Stateful driver with history + agile-loop cycle counting. */
export class StateMachine {
  private current: PipelineState = INITIAL_STATE;
  private history: TransitionRecord[] = [];
  /** How many times we looped back to PLAN (agile cycles). */
  private cycles = 0;

  get state(): PipelineState {
    return this.current;
  }

  get done(): boolean {
    return isTerminal(this.current);
  }

  get cycleCount(): number {
    return this.cycles;
  }

  getHistory(): TransitionRecord[] {
    return this.history.map((h) => ({ ...h }));
  }

  /** Advance one step. Throws on gate states without a decision. */
  advance(gate?: GateDecision): PipelineState {
    const from = this.current;
    const to = nextState(from, gate);
    if (to === 'PLAN' && (from === 'GATE_REVIEW' || from === 'GATE_REPORT')) {
      this.cycles += 1;
    }
    this.current = to;
    this.history.push(gate ? { from, to, gate: { ...gate } } : { from, to });
    return this.current;
  }

  reset(): void {
    this.current = INITIAL_STATE;
    this.history = [];
    this.cycles = 0;
  }
}

// CLI-first demo: `npm run demo` prints the happy-path walk.
if (import.meta.url === `file://${process.argv[1]}`) {
  const sm = new StateMachine();
  const walk: string[] = [sm.state];
  sm.advance(); // PLAN → REVIEW
  walk.push(sm.state);
  sm.advance(); // REVIEW → GATE_REVIEW
  walk.push(sm.state);
  sm.advance({ approved: true }); // → EXECUTE
  walk.push(sm.state);
  sm.advance(); // → DEBUG
  walk.push(sm.state);
  sm.advance(); // → REPORT
  walk.push(sm.state);
  sm.advance(); // → GATE_REPORT
  walk.push(sm.state);
  sm.advance({ approved: true }); // → DONE
  walk.push(sm.state);
  console.log(walk.join(' → '));
}
