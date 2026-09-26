/**
 * telemetry/tiger_client.ts — PostgreSQL client for Tiger Data / TimescaleDB.
 * Manages connection pooling, parameterized batch inserts, and graceful degradation.
 * If telemetry is disabled or unconfigured, all methods silently no-op.
 */

import { randomUUID } from 'node:crypto';
import dns from 'node:dns/promises';
import net from 'node:net';
import pg from 'pg';
const { Pool } = pg;

import { config } from '../shared/config.js';
import type { RunRecord, StageMetricRecord, TelemetryEvent } from './types.js';

export interface TigerClientOptions {
  connectionString?: string;
  enabled?: boolean;
}

export class TigerClient {
  private pool: pg.Pool | null = null;
  private readonly enabled: boolean;
  private readonly connectionString: string;
  private hasWarned = false;

  constructor(options?: TigerClientOptions) {
    this.connectionString = options?.connectionString ?? config.tigerDatabaseUrl;
    this.enabled = options?.enabled ?? Boolean(this.connectionString && config.tigerTelemetryEnabled);
  }

  get isEnabled(): boolean {
    return this.enabled && Boolean(this.connectionString);
  }

  /**
   * Lazily initialize or retrieve the shared connection pool.
   */
  private async getPool(): Promise<pg.Pool | null> {
    if (!this.isEnabled) return null;
    if (this.pool) return this.pool;

    try {
      const isLocal =
        this.connectionString.includes('localhost') ||
        this.connectionString.includes('127.0.0.1');

      let poolConfig: pg.PoolConfig = {
        connectionString: this.connectionString,
        max: 5,
        idleTimeoutMillis: 30000,
        connectionTimeoutMillis: 15000,
        ssl: isLocal ? false : { rejectUnauthorized: false },
      };

      if (!isLocal) {
        try {
          const parsed = new URL(this.connectionString);
          if (parsed.hostname && net.isIP(parsed.hostname) === 0) {
            const lookup = await dns.lookup(parsed.hostname, { family: 4 });
            if (lookup?.address) {
              poolConfig = {
                host: lookup.address,
                port: Number.parseInt(parsed.port || '5432', 10),
                user: decodeURIComponent(parsed.username),
                password: decodeURIComponent(parsed.password),
                database: parsed.pathname.replace(/^\//, '') || undefined,
                max: 5,
                idleTimeoutMillis: 30000,
                connectionTimeoutMillis: 15000,
                ssl: {
                  servername: parsed.hostname,
                  rejectUnauthorized: false,
                },
              };
            }
          }
        } catch {
          // Fall back to standard connectionString on parsing failure
        }
      }

      this.pool = new Pool(poolConfig);

      this.pool.on('error', (err) => {
        if (!this.hasWarned) {
          console.warn(`[tiger_client] Connection pool warning: ${err.message}`);
          this.hasWarned = true;
        }
      });

      return this.pool;
    } catch (err) {
      if (!this.hasWarned) {
        console.warn(`[tiger_client] Failed to create pool: ${(err as Error).message}`);
        this.hasWarned = true;
      }
      return null;
    }
  }

  /**
   * Test connectivity and verify credentials.
   * Returns false without throwing if unavailable.
   */
  async initialize(): Promise<boolean> {
    if (!this.isEnabled) return false;
    const pool = await this.getPool();
    if (!pool) return false;

    try {
      const client = await pool.connect();
      try {
        await client.query('SELECT 1;');
        return true;
      } finally {
        client.release();
      }
    } catch (err) {
      if (!this.hasWarned) {
        console.warn(`[tiger_client] Initialization failed (telemetry will no-op): ${(err as Error).message}`);
        this.hasWarned = true;
      }
      return false;
    }
  }

  /**
   * Batch insert telemetry events using parameterized multi-row SQL.
   * Returns count of successfully inserted records.
   */
  async insertEvents(events: TelemetryEvent[]): Promise<number> {
    if (!this.isEnabled || events.length === 0) return 0;
    const pool = await this.getPool();
    if (!pool) return 0;

    const COLS_PER_ROW = 10;
    const placeholders: string[] = [];
    const params: unknown[] = [];

    for (let i = 0; i < events.length; i++) {
      const e = events[i];
      const offset = i * COLS_PER_ROW;
      placeholders.push(
        `($${offset + 1}, $${offset + 2}, $${offset + 3}, $${offset + 4}, $${offset + 5}, $${offset + 6}, $${offset + 7}, $${offset + 8}, $${offset + 9}, $${offset + 10}::jsonb)`,
      );

      const timestamp =
        e.time instanceof Date
          ? e.time.toISOString()
          : e.time || new Date().toISOString();

      params.push(
        timestamp,
        e.eventId || randomUUID(),
        e.runId,
        e.cycleId ?? 0,
        e.stage,
        e.eventType,
        e.severity ?? 'info',
        e.modelUsed ?? null,
        e.durationMs ?? null,
        JSON.stringify(e.payload ?? {}),
      );
    }

    const sql = `
      INSERT INTO pipeline_events (
        time,
        event_id,
        run_id,
        cycle_id,
        stage,
        event_type,
        severity,
        model_used,
        duration_ms,
        payload
      ) VALUES ${placeholders.join(', ')}
      ON CONFLICT (time, event_id) DO NOTHING;
    `;

    try {
      const res = await pool.query(sql, params);
      return res.rowCount ?? events.length;
    } catch (err) {
      if (!this.hasWarned) {
        console.warn(`[tiger_client] Failed to insert ${events.length} event(s): ${(err as Error).message}`);
        this.hasWarned = true;
      }
      return 0;
    }
  }

  /**
   * Insert a stage metric record into the stage_metrics hypertable.
   */
  async insertStageMetric(metric: StageMetricRecord): Promise<boolean> {
    if (!this.isEnabled) return false;
    const pool = await this.getPool();
    if (!pool) return false;

    const timestamp =
      metric.time instanceof Date
        ? metric.time.toISOString()
        : metric.time || new Date().toISOString();

    const sql = `
      INSERT INTO stage_metrics (
        time,
        run_id,
        cycle_id,
        stage,
        duration_ms,
        files_planned,
        files_generated,
        files_missing,
        files_repaired,
        tests_passed,
        tests_failed,
        repair_attempts,
        prd_coverage_pct,
        verification_status,
        model_used
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15);
    `;

    const params = [
      timestamp,
      metric.runId,
      metric.cycleId ?? 0,
      metric.stage,
      metric.durationMs,
      metric.filesPlanned ?? 0,
      metric.filesGenerated ?? 0,
      metric.filesMissing ?? 0,
      metric.filesRepaired ?? 0,
      metric.testsPassed ?? 0,
      metric.testsFailed ?? 0,
      metric.repairAttempts ?? 0,
      metric.prdCoveragePct ?? 0.0,
      metric.verificationStatus ?? 'pending',
      metric.modelUsed ?? null,
    ];

    try {
      await pool.query(sql, params);
      return true;
    } catch (err) {
      if (!this.hasWarned) {
        console.warn(`[tiger_client] Failed to insert stage metric: ${(err as Error).message}`);
        this.hasWarned = true;
      }
      return false;
    }
  }

  /**
   * Upsert a run record in the sdlc_runs relational table.
   */
  async upsertRun(run: RunRecord): Promise<boolean> {
    if (!this.isEnabled) return false;
    const pool = await this.getPool();
    if (!pool) return false;

    const startedAt =
      run.startedAt instanceof Date
        ? run.startedAt.toISOString()
        : run.startedAt || new Date().toISOString();

    const completedAt =
      run.completedAt instanceof Date
        ? run.completedAt.toISOString()
        : run.completedAt || null;

    const sql = `
      INSERT INTO sdlc_runs (
        run_id,
        project_name,
        started_at,
        completed_at,
        status,
        prd_path,
        metadata
      ) VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb)
      ON CONFLICT (run_id) DO UPDATE SET
        completed_at = EXCLUDED.completed_at,
        status = EXCLUDED.status,
        metadata = EXCLUDED.metadata;
    `;

    const params = [
      run.runId,
      run.projectName,
      startedAt,
      completedAt,
      run.status,
      run.prdPath ?? null,
      JSON.stringify(run.metadata ?? {}),
    ];

    try {
      await pool.query(sql, params);
      return true;
    } catch (err) {
      if (!this.hasWarned) {
        console.warn(`[tiger_client] Failed to upsert run: ${(err as Error).message}`);
        this.hasWarned = true;
      }
      return false;
    }
  }

  /**
   * Execute a read-only parameterized query against the connection pool.
   * Returns empty array if telemetry is disabled or query fails.
   */
  async query<T = Record<string, unknown>>(
    sql: string,
    params: unknown[] = [],
  ): Promise<T[]> {
    if (!this.isEnabled) return [];
    const pool = await this.getPool();
    if (!pool) return [];

    try {
      const res = await pool.query(sql, params);
      return (res.rows || []) as T[];
    } catch (err) {
      if (!this.hasWarned) {
        console.warn(`[tiger_client] Query failed: ${(err as Error).message}`);
        this.hasWarned = true;
      }
      return [];
    }
  }

  /**
   * Gracefully close the connection pool.
   */
  async close(): Promise<void> {
    if (!this.pool) return;
    try {
      await this.pool.end();
    } catch {
      // Ignore errors on shutdown
    } finally {
      this.pool = null;
    }
  }
}

export const tigerClient = new TigerClient();
