-- ====================================================================
-- MINECARE PHASE 8 — REAL POSTGRESQL & PRODUCTION HARDENING MIGRATION
-- ====================================================================
-- Version: 3.0.0 (Phase 8 Production Database)
-- Ensures schema compatibility across Supabase Cloud and self-hosted PostgreSQL.
-- ====================================================================

-- 1. Ensure telemetry table has worker_id for worker-level telemetry querying

-- 2. Ensure telemetry table has worker_id for worker-level telemetry querying
ALTER TABLE telemetry 
ADD COLUMN IF NOT EXISTS worker_id TEXT REFERENCES workers(id) ON DELETE SET NULL;

-- 3. Ensure alerts table has raw_readings JSONB field for sensor snapshots
ALTER TABLE alerts 
ADD COLUMN IF NOT EXISTS raw_readings JSONB DEFAULT '{}'::jsonb;

-- 4. Additional production performance indexes
CREATE INDEX IF NOT EXISTS idx_telemetry_timestamp ON telemetry (timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_telemetry_worker ON telemetry (worker_id);
CREATE INDEX IF NOT EXISTS idx_alerts_triggered_at ON alerts (triggered_at DESC);
CREATE INDEX IF NOT EXISTS idx_alerts_worker ON alerts (worker_id);
CREATE INDEX IF NOT EXISTS idx_zone_assignments_time ON zone_assignments (checked_in_at DESC);
CREATE INDEX IF NOT EXISTS idx_zone_assignments_worker ON zone_assignments (worker_id);

-- 5. Updated RLS policies for telemetry with worker_id
DROP POLICY IF EXISTS "Workers read assigned helmet telemetry" ON telemetry;

CREATE POLICY "Workers read assigned helmet telemetry"
    ON telemetry FOR SELECT
    USING (
        public.current_profile_role() = 'WORKER'
        AND (
            worker_id = public.current_worker_id()
            OR helmet_id IN (SELECT id FROM helmets WHERE worker_id = public.current_worker_id())
        )
    );

-- 6. Persistent Token Revocation / Blacklist Table (Multi-instance safe)
CREATE TABLE IF NOT EXISTS revoked_tokens (
    token_jti TEXT PRIMARY KEY,
    user_id TEXT,
    revoked_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    expires_at TIMESTAMPTZ NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_revoked_tokens_exp ON revoked_tokens (expires_at);

-- Enable RLS on revoked_tokens (Only service role / backend can write and read)
ALTER TABLE revoked_tokens ENABLE ROW LEVEL SECURITY;
