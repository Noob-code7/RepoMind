/**
 * telemetry/event_pipeline.ts — Asynchronous telemetry event pipeline.
 * Buffers events in an in-memory queue, flushes in micro-batches or on interval,
 * and guarantees zero blocking overhead on the core SDLC agent loops.
 */

import { config } from '../shared/config.js';
import { TigerClient, tigerClient as defaultClient } from './tiger_client.js';
import type { TelemetryEvent } from './types.js';

export interface EventPipelineOptions {
  client?: TigerClient;
  batchSize?: number;
  flushIntervalMs?: number;
  enabled?: boolean;
  maxQueueSize?: number;
}

export class EventPipeline {
  private readonly client: TigerClient;
  private readonly batchSize: number;
  private readonly flushIntervalMs: number;
  private readonly enabled: boolean;
  private readonly maxQueueSize: number;

  private queue: TelemetryEvent[] = [];
  private timer: NodeJS.Timeout | null = null;
  private isFlushing = false;
  private isStarted = false;

  constructor(options?: EventPipelineOptions) {
    this.client = options?.client ?? defaultClient;
    this.batchSize = options?.batchSize ?? config.tigerBatchSize;
    this.flushIntervalMs = options?.flushIntervalMs ?? config.tigerFlushIntervalMs;
    this.enabled = options?.enabled ?? config.tigerTelemetryEnabled;
    this.maxQueueSize = options?.maxQueueSize ?? 5000;
  }

  get isEnabled(): boolean {
    return this.enabled && this.client.isEnabled;
  }

  get queueSize(): number {
    return this.queue.length;
  }

  /**
   * Start the periodic background flush timer.
   * Harmless no-op when telemetry is disabled.
   */
  start(): void {
    if (!this.isEnabled || this.isStarted) return;
    this.isStarted = true;
    this.timer = setInterval(() => {
      void this.flush();
    }, this.flushIntervalMs);
    // Unref timer so it does not keep the Node.js event loop alive on exit
    this.timer.unref?.();
  }

  /**
   * Enqueue a telemetry event synchronously without blocking the caller.
   * Triggers an asynchronous flush if the batch size threshold is reached.
   */
  emit(event: TelemetryEvent): void {
    if (!this.isEnabled) return;

    // Prevent unbounded memory growth if the database is slow or unreachable
    if (this.queue.length >= this.maxQueueSize) {
      this.queue.shift(); // Evict the oldest event
    }

    this.queue.push(event);

    if (this.queue.length >= this.batchSize && !this.isFlushing) {
      void this.flush();
    }
  }

  /**
   * Flush all currently queued events to the database.
   * Can be awaited during stage boundaries or before process exit.
   */
  async flush(): Promise<void> {
    if (!this.isEnabled || this.queue.length === 0 || this.isFlushing) return;
    this.isFlushing = true;

    try {
      while (this.queue.length > 0) {
        const batch = this.queue.splice(0, this.batchSize);
        await this.client.insertEvents(batch);
      }
    } catch {
      // client.insertEvents already handles errors; catch here guarantees zero uncaught exceptions
    } finally {
      this.isFlushing = false;
    }
  }

  /**
   * Stop the periodic timer, flush all remaining events, and close the client.
   */
  async stop(): Promise<void> {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    this.isStarted = false;

    if (this.isEnabled) {
      await this.flush();
      await this.client.close();
    }
  }
}

export const eventPipeline = new EventPipeline();
