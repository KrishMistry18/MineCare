-- ====================================================================
-- MINECARE — PHASE 1: PRODUCTION-GRADE ESP8266 DEVICE PROVISIONING
-- ====================================================================
-- Version: 6.0.0 (Phase 1 Device Provisioning)
-- Persistent storage for hashed ESP8266 device credentials.
-- Only cryptographic SHA-256 hashes and token prefixes are stored.
-- Raw tokens are returned exactly once upon creation and never persisted.
-- ====================================================================

-- 1. Create helmet_device_tokens table
CREATE TABLE IF NOT EXISTS helmet_device_tokens (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    helmet_id TEXT NOT NULL REFERENCES helmets(id) ON DELETE CASCADE,
    token_hash TEXT NOT NULL UNIQUE,
    token_prefix TEXT NOT NULL,
    name TEXT NOT NULL DEFAULT 'ESP8266 Sensor Node',
    created_by TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_used_at TIMESTAMPTZ,
    revoked_at TIMESTAMPTZ,
    revoked_by TEXT,
    revocation_reason TEXT
);

-- 2. Indexes for fast authentication lookups and active token management
CREATE INDEX IF NOT EXISTS idx_helmet_device_tokens_helmet_id ON helmet_device_tokens (helmet_id);
CREATE INDEX IF NOT EXISTS idx_helmet_device_tokens_token_hash ON helmet_device_tokens (token_hash);
CREATE INDEX IF NOT EXISTS idx_helmet_device_tokens_revoked_at ON helmet_device_tokens (revoked_at);

-- 3. Row Level Security: Only backend service role / direct postgres pool interacts with helmet_device_tokens
ALTER TABLE helmet_device_tokens ENABLE ROW LEVEL SECURITY;
