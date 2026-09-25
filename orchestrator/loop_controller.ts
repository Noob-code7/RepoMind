/**
 * orchestrator/loop_controller.ts
 * Manages iterations, caps self-repair loops, and tracks pipeline lifecycle events.
 * Deterministic — NO LLM calls live here.
 */
import { MAX_SELF_LOOP_ITERATIONS } from '../shared/config.js';

export interface LoopEvent {
  stage: string;
  action: string;
  timestamp: string;
  details?: Record<string, unknown>;
}

export class LoopController {
  public readonly maxSelfLoops: number;
  public currentSelfLoop = 0;
  public agileCycle = 1;
  public events: LoopEvent[] = [];

  constructor(maxSelfLoops: number = MAX_SELF_LOOP_ITERATIONS) {
    this.maxSelfLoops = maxSelfLoops;
  }

  /**
   * Check whether another automated repair self-loop is permitted.
   */
  canSelfLoop(): boolean {
    return this.currentSelfLoop < this.maxSelfLoops;
  }

  /**
   * Record that a self-repair attempt has executed.
   */
  recordSelfLoop(reason: string, details?: Record<string, unknown>): number {
    this.currentSelfLoop++;
    this.recordEvent('EXECUTE_DEBUG_LOOP', `Self-loop repair #${this.currentSelfLoop}: ${reason}`, details);
    return this.currentSelfLoop;
  }

  /**
   * Reset self-loop counter (e.g., when entering a new stage or cycle).
   */
  resetSelfLoop(): void {
    this.currentSelfLoop = 0;
  }

  /**
   * Record human rejection at GATE_REPORT and looping back to PLAN.
   */
  startNewAgileCycle(feedback: string): number {
    this.agileCycle++;
    this.resetSelfLoop();
    this.recordEvent('AGILE_LOOP', `Looping back to PLAN for Cycle #${this.agileCycle}`, { feedback });
    return this.agileCycle;
  }

  /**
   * Log an event with timestamp.
   */
  recordEvent(stage: string, action: string, details?: Record<string, unknown>): void {
    this.events.push({
      stage,
      action,
      timestamp: new Date().toISOString(),
      details,
    });
  }

  /**
   * Return a summary of loop state.
   */
  getSummary(): {
    agileCycle: number;
    currentSelfLoop: number;
    maxSelfLoops: number;
    totalEvents: number;
  } {
    return {
      agileCycle: this.agileCycle,
      currentSelfLoop: this.currentSelfLoop,
      maxSelfLoops: this.maxSelfLoops,
      totalEvents: this.events.length,
    };
  }
}
