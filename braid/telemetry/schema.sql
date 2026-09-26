-- ============================================================================
-- RepoMind / Braid — Tiger Data / TimescaleDB Execution Telemetry Schema
-- Real-time telemetry, stage metrics, and run tracking for HackNex Season 2.
-- ============================================================================

-- Ensure the TimescaleDB extension is available
CREATE EXTENSION IF NOT EXISTS timescaledb CASCADE;

-- ----------------------------------------------------------------------------
-- 1. sdlc_runs: Relational table for overall run lifecycle and status
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS sdlc_runs (
    run_id VARCHAR(64) PRIMARY KEY,
    project_name VARCHAR(128) NOT NULL,
    started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    completed_at TIMESTAMPTZ,
    status VARCHAR(32) NOT NULL DEFAULT 'running', -- running, completed, rejected_gate1, rejected_gate2, failed
    prd_path TEXT,
    metadata JSONB DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS idx_sdlc_runs_status ON sdlc_runs (status);
CREATE INDEX IF NOT EXISTS idx_sdlc_runs_started_at ON sdlc_runs (started_at DESC);

-- ----------------------------------------------------------------------------
-- 2. pipeline_events: Time-series execution events (TimescaleDB Hypertable)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS pipeline_events (
    time TIMESTAMPTZ NOT NULL,
    event_id UUID NOT NULL,
    run_id VARCHAR(64) NOT NULL,
    cycle_id INT NOT NULL DEFAULT 0,
    stage VARCHAR(32) NOT NULL,
    event_type VARCHAR(64) NOT NULL,
    severity VARCHAR(16) NOT NULL DEFAULT 'info', -- info, warn, error
    model_used VARCHAR(128),
    duration_ms INT,
    payload JSONB DEFAULT '{}'::jsonb,
    PRIMARY KEY (time, event_id)
);

-- Convert pipeline_events into a TimescaleDB hypertable partitioned by time
SELECT create_hypertable('pipeline_events', 'time', if_not_exists => TRUE);

-- Indexes for real-time querying and timeline inspection
CREATE INDEX IF NOT EXISTS idx_pipeline_events_run_time ON pipeline_events (run_id, time DESC);
CREATE INDEX IF NOT EXISTS idx_pipeline_events_type_time ON pipeline_events (event_type, time DESC);
CREATE INDEX IF NOT EXISTS idx_pipeline_events_stage_time ON pipeline_events (stage, time DESC);
CREATE INDEX IF NOT EXISTS idx_pipeline_events_model_time ON pipeline_events (model_used, time DESC) WHERE model_used IS NOT NULL;

-- ----------------------------------------------------------------------------
-- 3. stage_metrics: Quantitative SDLC metrics per stage (TimescaleDB Hypertable)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS stage_metrics (
    time TIMESTAMPTZ NOT NULL,
    run_id VARCHAR(64) NOT NULL,
    cycle_id INT NOT NULL DEFAULT 0,
    stage VARCHAR(32) NOT NULL,
    duration_ms INT NOT NULL DEFAULT 0,
    files_planned INT DEFAULT 0,
    files_generated INT DEFAULT 0,
    files_missing INT DEFAULT 0,
    files_repaired INT DEFAULT 0,
    tests_passed INT DEFAULT 0,
    tests_failed INT DEFAULT 0,
    repair_attempts INT DEFAULT 0,
    prd_coverage_pct NUMERIC(5, 2) DEFAULT 0.0,
    verification_status VARCHAR(32) DEFAULT 'pending',
    model_used VARCHAR(128)
);

-- Convert stage_metrics into a TimescaleDB hypertable partitioned by time
SELECT create_hypertable('stage_metrics', 'time', if_not_exists => TRUE);

-- Indexes for fast stage metric aggregation and run analysis
CREATE INDEX IF NOT EXISTS idx_stage_metrics_run_time ON stage_metrics (run_id, time DESC);
CREATE INDEX IF NOT EXISTS idx_stage_metrics_stage_time ON stage_metrics (stage, time DESC);

-- ----------------------------------------------------------------------------
-- 4. stage_performance_1m: TimescaleDB Continuous Aggregate (Real-Time Rollup)
-- ----------------------------------------------------------------------------
CREATE MATERIALIZED VIEW IF NOT EXISTS stage_performance_1m
WITH (timescaledb.continuous) AS
SELECT
    time_bucket('1 minute', time) AS bucket,
    stage,
    model_used,
    COUNT(*) AS total_executions,
    AVG(duration_ms) AS avg_duration_ms,
    MAX(duration_ms) AS max_duration_ms,
    SUM(tests_passed) AS total_tests_passed,
    SUM(tests_failed) AS total_tests_failed,
    SUM(repair_attempts) AS total_repair_attempts,
    SUM(files_repaired) AS total_files_repaired
FROM stage_metrics
GROUP BY bucket, stage, model_used
WITH NO DATA;

-- Enable real-time analytical queries (queries both materialized and fresh raw chunks)
ALTER MATERIALIZED VIEW stage_performance_1m SET (timescaledb.materialized_only = false);

-- Automated continuous aggregate refresh policy (e.g. refresh every 1 minute)
SELECT add_continuous_aggregate_policy('stage_performance_1m',
    start_offset => INTERVAL '1 day',
    end_offset => INTERVAL '1 minute',
    schedule_interval => INTERVAL '1 minute',
    if_not_exists => TRUE);

