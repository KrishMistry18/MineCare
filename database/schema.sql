-- ====================================================================
-- MINECARE CORE RELATIONAL DATABASE SCHEMA (PostgreSQL / Supabase)
-- ====================================================================
-- Version: 2.0.0
-- Architecture: Relational with Zone Assignment History, Telemetry, and Alerts
--
-- IMPORTANT CONSTRAINTS:
-- 1. NO GPS or continuous physical coordinate tracking.
-- 2. Location is strictly tracked through authoritative Zone Assignments.
-- 3. MQ-2 gas_value is strictly raw analog reading (0-1023 ADC), never uncalibrated ppm.
-- ====================================================================

-- 1. MINE ZONES TABLE
CREATE TABLE IF NOT EXISTS mine_zones (
    id TEXT PRIMARY KEY,
    name TEXT UNIQUE NOT NULL,
    level TEXT NOT NULL,
    depth_meters INTEGER NOT NULL DEFAULT 0,
    description TEXT,
    status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'MAINTENANCE', 'RESTRICTED', 'CLEAR')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 2. WORKERS TABLE
CREATE TABLE IF NOT EXISTS workers (
    id TEXT PRIMARY KEY,
    worker_code TEXT UNIQUE NOT NULL,
    name TEXT NOT NULL,
    role TEXT NOT NULL,
    shift TEXT NOT NULL CHECK (shift IN ('A', 'B', 'C')),
    assigned_zone_id TEXT REFERENCES mine_zones(id) ON DELETE SET NULL,
    status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'INACTIVE', 'ON_LEAVE')),
    battery_level INTEGER NOT NULL DEFAULT 70 CHECK (battery_level BETWEEN 0 AND 100),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 3. HELMETS TABLE
CREATE TABLE IF NOT EXISTS helmets (
    id TEXT PRIMARY KEY,
    helmet_code TEXT UNIQUE NOT NULL,
    worker_id TEXT REFERENCES workers(id) ON DELETE SET NULL,
    status TEXT NOT NULL DEFAULT 'SAFE' CHECK (status IN ('SAFE', 'WARNING', 'DANGER')),
    online BOOLEAN NOT NULL DEFAULT TRUE,
    last_seen TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    battery_level INTEGER NOT NULL DEFAULT 70 CHECK (battery_level BETWEEN 0 AND 100),
    serial_number TEXT,
    firmware_version TEXT NOT NULL DEFAULT 'v1.4.2-proto',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 4. ZONE ASSIGNMENTS (LEDGER & AUDIT TRAIL)
-- Derives currentWorkZone while retaining full historical movement audit
CREATE TABLE IF NOT EXISTS zone_assignments (
    id TEXT PRIMARY KEY,
    worker_id TEXT NOT NULL REFERENCES workers(id) ON DELETE CASCADE,
    helmet_id TEXT NOT NULL REFERENCES helmets(id) ON DELETE CASCADE,
    zone_id TEXT NOT NULL REFERENCES mine_zones(id) ON DELETE RESTRICT Loose,
    assigned_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    checked_in_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    checked_out_at TIMESTAMPTZ,
    assignment_type TEXT NOT NULL DEFAULT 'CHECK_IN' CHECK (assignment_type IN ('CHECK_IN', 'SUPERVISOR_REASSIGN', 'DEFAULT_INITIAL')),
    active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 5. TELEMETRY TABLE
CREATE TABLE IF NOT EXISTS telemetry (
    id TEXT PRIMARY KEY,
    helmet_id TEXT NOT NULL REFERENCES helmets(id) ON DELETE CASCADE,
    timestamp TIMESTAMPTZ NOT NULL,
    sequence_number BIGINT NOT NULL DEFAULT 0,
    temperature NUMERIC(5,2) NOT NULL,
    humidity NUMERIC(5,2) NOT NULL,
    gas_value INTEGER NOT NULL CHECK (gas_value BETWEEN 0 AND 1023), -- RAW ADC 0-1023. Not ppm.
    acceleration_x NUMERIC(6,2) NOT NULL,
    acceleration_y NUMERIC(6,2) NOT NULL,
    acceleration_z NUMERIC(6,2) NOT NULL,
    total_acceleration NUMERIC(6,2) NOT NULL,
    gyro_x NUMERIC(6,2) NOT NULL,
    gyro_y NUMERIC(6,2) NOT NULL,
    gyro_z NUMERIC(6,2) NOT NULL,
    fall_detected BOOLEAN NOT NULL DEFAULT FALSE,
    sos_pressed BOOLEAN NOT NULL DEFAULT FALSE,
    safety_status TEXT NOT NULL DEFAULT 'SAFE' CHECK (safety_status IN ('SAFE', 'WARNING', 'DANGER')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 6. ALERTS TABLE
CREATE TABLE IF NOT EXISTS alerts (
    id TEXT PRIMARY KEY,
    helmet_id TEXT NOT NULL REFERENCES helmets(id) ON DELETE CASCADE,
    worker_id TEXT REFERENCES workers(id) ON DELETE SET NULL,
    type TEXT NOT NULL CHECK (type IN ('GAS_HAZARD', 'WORKER_FALL', 'SOS_EMERGENCY', 'HEAT_STRESS', 'MULTI_HAZARD', 'HELMET_OFFLINE', 'SENSOR_FAULT')),
    severity TEXT NOT NULL CHECK (severity IN ('CRITICAL', 'WARNING', 'INFO')),
    message TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'TRIGGERED' CHECK (status IN ('TRIGGERED', 'ACKNOWLEDGED', 'RESOLVED')),
    triggered_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    acknowledged_at TIMESTAMPTZ,
    acknowledged_by TEXT,
    resolved_at TIMESTAMPTZ,
    supervisor_notes TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ====================================================================
-- PERFORMANCE INDEXES
-- ====================================================================
CREATE INDEX IF NOT EXISTS idx_telemetry_helmet_time ON telemetry (helmet_id, timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_zone_assignments_active ON zone_assignments (worker_id, active) WHERE active = TRUE;
CREATE INDEX IF NOT EXISTS idx_zone_assignments_zone ON zone_assignments (zone_id, active);
CREATE INDEX IF NOT EXISTS idx_alerts_active ON alerts (status) WHERE status != 'RESOLVED';
CREATE INDEX IF NOT EXISTS idx_helmets_worker ON helmets (worker_id);

-- ====================================================================
-- ROW LEVEL SECURITY (RLS) POLICIES
-- ====================================================================
ALTER TABLE mine_zones ENABLE ROW LEVEL SECURITY;
ALTER TABLE workers ENABLE ROW LEVEL SECURITY;
ALTER TABLE helmets ENABLE ROW LEVEL SECURITY;
ALTER TABLE zone_assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE telemetry ENABLE ROW LEVEL SECURITY;
ALTER TABLE alerts ENABLE ROW LEVEL SECURITY;

-- Read policies: allow anon/authenticated to view data
CREATE POLICY "Public read mine_zones" ON mine_zones FOR SELECT USING (true);
CREATE POLICY "Public read workers" ON workers FOR SELECT USING (true);
CREATE POLICY "Public read helmets" ON helmets FOR SELECT USING (true);
CREATE POLICY "Public read zone_assignments" ON zone_assignments FOR SELECT USING (true);
CREATE POLICY "Public read telemetry" ON telemetry FOR SELECT USING (true);
CREATE POLICY "Public read alerts" ON alerts FOR SELECT USING (true);

-- Insert/Update policies for operational ingestion and supervisor changes
CREATE POLICY "Service write telemetry" ON telemetry FOR INSERT WITH CHECK (true);
CREATE POLICY "Service write alerts" ON alerts FOR ALL USING (true);
CREATE POLICY "Service write zone_assignments" ON zone_assignments FOR ALL USING (true);
CREATE POLICY "Service update helmets" ON helmets FOR UPDATE USING (true);
CREATE POLICY "Service update workers" ON workers FOR UPDATE USING (true);
