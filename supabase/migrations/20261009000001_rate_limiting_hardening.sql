-- ====================================================================
-- MINECARE — DISTRIBUTED POSTGRESQL RATE LIMITING HARDENING
-- ====================================================================
-- Version: 5.0.0 (Phase 9 Security Hardening: Task 9.4)
-- Multi-instance atomic sliding-window rate limit store.
-- Additive, backward-compatible schema changes.
-- ====================================================================

-- 1. Ensure composite columns on existing rate_limits table
ALTER TABLE rate_limits ADD COLUMN IF NOT EXISTS tier TEXT;
ALTER TABLE rate_limits ADD COLUMN IF NOT EXISTS identifier TEXT;
ALTER TABLE rate_limits ADD COLUMN IF NOT EXISTS window_start BIGINT;
ALTER TABLE rate_limits ADD COLUMN IF NOT EXISTS request_count INTEGER DEFAULT 0;

-- 2. Indexes for fast parameterized lookups and safe bounded expiration cleanup
CREATE INDEX IF NOT EXISTS idx_rate_limits_tier_id ON rate_limits (tier, identifier);
CREATE INDEX IF NOT EXISTS idx_rate_limits_blocked_until ON rate_limits (blocked_until);
CREATE INDEX IF NOT EXISTS idx_rate_limits_updated_at ON rate_limits (updated_at);

-- 3. Additive composite rate-limit window ledger for multi-instance distributed metrics
CREATE TABLE IF NOT EXISTS rate_limit_windows (
    tier TEXT NOT NULL,
    identifier TEXT NOT NULL,
    window_start BIGINT NOT NULL,
    request_count INTEGER NOT NULL DEFAULT 1,
    blocked_until BIGINT,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (tier, identifier, window_start)
);

CREATE INDEX IF NOT EXISTS idx_rate_limit_windows_updated ON rate_limit_windows (updated_at);

-- 4. Enable RLS on rate_limit_windows
ALTER TABLE rate_limit_windows ENABLE ROW LEVEL SECURITY;
