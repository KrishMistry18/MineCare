-- ====================================================================
-- MINECARE PHASE 9 — DISTRIBUTED RATE LIMITING & SECURITY HARDENING
-- ====================================================================
-- Version: 4.0.0 (Phase 9 Security Hardening)
-- Ensures schema compatibility across Supabase Cloud and self-hosted PostgreSQL.
-- ====================================================================

-- 1. Distributed Rate Limiting Table (PostgreSQL-backed sliding window)
CREATE TABLE IF NOT EXISTS rate_limits (
    key TEXT PRIMARY KEY,
    timestamps JSONB NOT NULL DEFAULT '[]'::jsonb,
    blocked_until BIGINT,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_rate_limits_updated ON rate_limits (updated_at);

-- 2. Hardware Device Identity & Helmet Binding Table (IoT Device Registry)
CREATE TABLE IF NOT EXISTS device_credentials (
    device_id TEXT PRIMARY KEY,
    helmet_id TEXT NOT NULL REFERENCES helmets(id) ON DELETE CASCADE,
    token_hash TEXT NOT NULL,
    revoked BOOLEAN NOT NULL DEFAULT FALSE,
    revoked_at TIMESTAMPTZ,
    last_seen_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_device_credentials_helmet ON device_credentials (helmet_id);
CREATE INDEX IF NOT EXISTS idx_device_credentials_revoked ON device_credentials (revoked);

-- 3. Enable RLS: Only backend service role interacts with rate limits and device credentials
ALTER TABLE rate_limits ENABLE ROW LEVEL SECURITY;
ALTER TABLE device_credentials ENABLE ROW LEVEL SECURITY;
