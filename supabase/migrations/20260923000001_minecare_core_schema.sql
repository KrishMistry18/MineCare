-- ====================================================================
-- MINECARE CORE SUPABASE MIGRATION
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

-- 4. ZONE ASSIGNMENTS
CREATE TABLE IF NOT EXISTS zone_assignments (
    id TEXT PRIMARY KEY,
    worker_id TEXT NOT NULL REFERENCES workers(id) ON DELETE CASCADE,
    helmet_id TEXT NOT NULL REFERENCES helmets(id) ON DELETE CASCADE,
    zone_id TEXT NOT NULL REFERENCES mine_zones(id) ON DELETE RESTRICT,
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

-- INDEXES
CREATE INDEX IF NOT EXISTS idx_telemetry_helmet_time ON telemetry (helmet_id, timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_zone_assignments_active ON zone_assignments (worker_id, active) WHERE active = TRUE;
CREATE INDEX IF NOT EXISTS idx_zone_assignments_zone ON zone_assignments (zone_id, active);
CREATE INDEX IF NOT EXISTS idx_alerts_active ON alerts (status) WHERE status != 'RESOLVED';
CREATE INDEX IF NOT EXISTS idx_helmets_worker ON helmets (worker_id);

-- RLS
ALTER TABLE mine_zones ENABLE ROW LEVEL SECURITY;
ALTER TABLE workers ENABLE ROW LEVEL SECURITY;
ALTER TABLE helmets ENABLE ROW LEVEL SECURITY;
ALTER TABLE zone_assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE telemetry ENABLE ROW LEVEL SECURITY;
ALTER TABLE alerts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Public read mine_zones" ON mine_zones FOR SELECT USING (true);
CREATE POLICY "Public read workers" ON workers FOR SELECT USING (true);
CREATE POLICY "Public read helmets" ON helmets FOR SELECT USING (true);
CREATE POLICY "Public read zone_assignments" ON zone_assignments FOR SELECT USING (true);
CREATE POLICY "Public read telemetry" ON telemetry FOR SELECT USING (true);
CREATE POLICY "Public read alerts" ON alerts FOR SELECT USING (true);

CREATE POLICY "Service write telemetry" ON telemetry FOR INSERT WITH CHECK (true);
CREATE POLICY "Service write alerts" ON alerts FOR ALL USING (true);
CREATE POLICY "Service write zone_assignments" ON zone_assignments FOR ALL USING (true);
CREATE POLICY "Service update helmets" ON helmets FOR UPDATE USING (true);
CREATE POLICY "Service update workers" ON workers FOR UPDATE USING (true);

-- SEED MINE ZONES
INSERT INTO mine_zones (id, name, level, depth_meters, description, status) VALUES
('zone-portal-surface', 'Portal / Surface', 'Surface', 0, 'Main entrance portal, lamp room, dispatch center & staging area.', 'ACTIVE'),
('zone-level-1-north-drift', 'Level 1 — North Drift', 'Level 1', 180, 'Drill and blast production drift, auxiliary ventilation branch.', 'ACTIVE'),
('zone-level-2-south-panel', 'Level 2 — South Panel', 'Level 2', 360, 'Longwall extraction panel, conveyor transfer, secondary egress.', 'ACTIVE'),
('zone-level-3-haul-road', 'Level 3 — Haul Road', 'Level 3', 520, 'Primary heavy equipment haulage drift and crusher hopper gallery.', 'ACTIVE')
ON CONFLICT (id) DO NOTHING;

-- SEED WORKERS
INSERT INTO workers (id, worker_code, name, role, shift, assigned_zone_id, status, battery_level) VALUES
('WRK-001', 'EMP-4200', 'R. Marak', 'Face Operator', 'A', 'zone-level-1-north-drift', 'ACTIVE', 68),
('WRK-002', 'EMP-4201', 'S. Kujur', 'Drill Operator', 'B', 'zone-level-2-south-panel', 'ACTIVE', 69),
('WRK-003', 'EMP-4202', 'A. Bhosale', 'Haulage Crew', 'C', 'zone-level-3-haul-road', 'ACTIVE', 70),
('WRK-004', 'EMP-4203', 'P. Oraon', 'Roof Bolter', 'A', 'zone-portal-surface', 'ACTIVE', 71),
('WRK-005', 'EMP-4204', 'D. Tudu', 'Ventilation Tech', 'B', 'zone-level-1-north-drift', 'ACTIVE', 71),
('WRK-006', 'EMP-4205', 'M. Kerketta', 'Shift Electrician', 'C', 'zone-level-2-south-panel', 'ACTIVE', 72),
('WRK-007', 'EMP-4206', 'V. Sawant', 'Face Operator', 'A', 'zone-level-3-haul-road', 'ACTIVE', 67),
('WRK-008', 'EMP-4207', 'N. Hansda', 'Drill Operator', 'B', 'zone-portal-surface', 'ACTIVE', 68),
('WRK-009', 'EMP-4208', 'K. Patil', 'Haulage Crew', 'C', 'zone-level-1-north-drift', 'ACTIVE', 69),
('WRK-010', 'EMP-4209', 'J. Minz', 'Roof Bolter', 'A', 'zone-level-2-south-panel', 'ACTIVE', 70),
('WRK-011', 'EMP-4210', 'T. Barla', 'Ventilation Tech', 'B', 'zone-level-3-haul-road', 'ACTIVE', 71),
('WRK-012', 'EMP-4211', 'H. Lakra', 'Shift Electrician', 'C', 'zone-portal-surface', 'ACTIVE', 72),
('WRK-013', 'EMP-4212', 'B. Soren', 'Face Operator', 'A', 'zone-level-1-north-drift', 'ACTIVE', 66),
('WRK-014', 'EMP-4213', 'G. Toppo', 'Drill Operator', 'B', 'zone-level-2-south-panel', 'ACTIVE', 67),
('WRK-015', 'EMP-4214', 'L. Munda', 'Haulage Crew', 'C', 'zone-level-3-haul-road', 'ACTIVE', 68),
('WRK-016', 'EMP-4215', 'S. Bhengra', 'Roof Bolter', 'A', 'zone-portal-surface', 'ACTIVE', 69)
ON CONFLICT (id) DO NOTHING;

-- SEED HELMETS
INSERT INTO helmets (id, helmet_code, worker_id, status, online, last_seen, battery_level, serial_number, firmware_version) VALUES
('MC-001', 'MC-001', 'WRK-001', 'SAFE', TRUE, NOW(), 68, 'SN-MC8266-0001', 'v1.4.2-proto'),
('MC-002', 'MC-002', 'WRK-002', 'SAFE', TRUE, NOW(), 69, 'SN-MC8266-0002', 'v1.4.2-proto'),
('MC-003', 'MC-003', 'WRK-003', 'SAFE', TRUE, NOW(), 70, 'SN-MC8266-0003', 'v1.4.2-proto'),
('MC-004', 'MC-004', 'WRK-004', 'SAFE', TRUE, NOW(), 71, 'SN-MC8266-0004', 'v1.4.2-proto'),
('MC-005', 'MC-005', 'WRK-005', 'SAFE', TRUE, NOW(), 71, 'SN-MC8266-0005', 'v1.4.2-proto'),
('MC-006', 'MC-006', 'WRK-006', 'SAFE', TRUE, NOW(), 72, 'SN-MC8266-0006', 'v1.4.2-proto'),
('MC-007', 'MC-007', 'WRK-007', 'SAFE', TRUE, NOW(), 67, 'SN-MC8266-0007', 'v1.4.2-proto'),
('MC-008', 'MC-008', 'WRK-008', 'SAFE', TRUE, NOW(), 68, 'SN-MC8266-0008', 'v1.4.2-proto'),
('MC-009', 'MC-009', 'WRK-009', 'SAFE', TRUE, NOW(), 69, 'SN-MC8266-0009', 'v1.4.2-proto'),
('MC-010', 'MC-010', 'WRK-010', 'SAFE', TRUE, NOW(), 70, 'SN-MC8266-0010', 'v1.4.2-proto'),
('MC-011', 'MC-011', 'WRK-011', 'SAFE', TRUE, NOW(), 71, 'SN-MC8266-0011', 'v1.4.2-proto'),
('MC-012', 'MC-012', 'WRK-012', 'SAFE', TRUE, NOW(), 72, 'SN-MC8266-0012', 'v1.4.2-proto'),
('MC-013', 'MC-013', 'WRK-013', 'SAFE', TRUE, NOW(), 66, 'SN-MC8266-0013', 'v1.4.2-proto'),
('MC-014', 'MC-014', 'WRK-014', 'SAFE', TRUE, NOW(), 67, 'SN-MC8266-0014', 'v1.4.2-proto'),
('MC-015', 'MC-015', 'WRK-015', 'SAFE', TRUE, NOW(), 68, 'SN-MC8266-0015', 'v1.4.2-proto'),
('MC-016', 'MC-016', 'WRK-016', 'SAFE', TRUE, NOW(), 69, 'SN-MC8266-0016', 'v1.4.2-proto')
ON CONFLICT (id) DO NOTHING;

-- SEED INITIAL ZONE ASSIGNMENTS
INSERT INTO zone_assignments (id, worker_id, helmet_id, zone_id, assigned_at, checked_in_at, assignment_type, active) VALUES
('ZA-001', 'WRK-001', 'MC-001', 'zone-level-1-north-drift', NOW() - INTERVAL '3 hours', NOW() - INTERVAL '3 hours', 'DEFAULT_INITIAL', TRUE),
('ZA-002', 'WRK-002', 'MC-002', 'zone-level-2-south-panel', NOW() - INTERVAL '3 hours', NOW() - INTERVAL '3 hours', 'DEFAULT_INITIAL', TRUE),
('ZA-003', 'WRK-003', 'MC-003', 'zone-level-3-haul-road',   NOW() - INTERVAL '3 hours', NOW() - INTERVAL '3 hours', 'DEFAULT_INITIAL', TRUE),
('ZA-004', 'WRK-004', 'MC-004', 'zone-portal-surface',      NOW() - INTERVAL '3 hours', NOW() - INTERVAL '3 hours', 'DEFAULT_INITIAL', TRUE),
('ZA-005', 'WRK-005', 'MC-005', 'zone-level-1-north-drift', NOW() - INTERVAL '3 hours', NOW() - INTERVAL '3 hours', 'DEFAULT_INITIAL', TRUE),
('ZA-006', 'WRK-006', 'MC-006', 'zone-level-2-south-panel', NOW() - INTERVAL '3 hours', NOW() - INTERVAL '3 hours', 'DEFAULT_INITIAL', TRUE),
('ZA-007', 'WRK-007', 'MC-007', 'zone-level-3-haul-road',   NOW() - INTERVAL '3 hours', NOW() - INTERVAL '3 hours', 'DEFAULT_INITIAL', TRUE),
('ZA-008', 'WRK-008', 'MC-008', 'zone-portal-surface',      NOW() - INTERVAL '3 hours', NOW() - INTERVAL '3 hours', 'DEFAULT_INITIAL', TRUE),
('ZA-009', 'WRK-009', 'MC-009', 'zone-level-1-north-drift', NOW() - INTERVAL '3 hours', NOW() - INTERVAL '3 hours', 'DEFAULT_INITIAL', TRUE),
('ZA-010', 'WRK-010', 'MC-010', 'zone-level-2-south-panel', NOW() - INTERVAL '3 hours', NOW() - INTERVAL '3 hours', 'DEFAULT_INITIAL', TRUE),
('ZA-011', 'WRK-011', 'MC-011', 'zone-level-3-haul-road',   NOW() - INTERVAL '3 hours', NOW() - INTERVAL '3 hours', 'DEFAULT_INITIAL', TRUE),
('ZA-012', 'WRK-012', 'MC-012', 'zone-portal-surface',      NOW() - INTERVAL '3 hours', NOW() - INTERVAL '3 hours', 'DEFAULT_INITIAL', TRUE),
('ZA-013', 'WRK-013', 'MC-013', 'zone-level-1-north-drift', NOW() - INTERVAL '3 hours', NOW() - INTERVAL '3 hours', 'DEFAULT_INITIAL', TRUE),
('ZA-014', 'WRK-014', 'MC-014', 'zone-level-2-south-panel', NOW() - INTERVAL '3 hours', NOW() - INTERVAL '3 hours', 'DEFAULT_INITIAL', TRUE),
('ZA-015', 'WRK-015', 'MC-015', 'zone-level-3-haul-road',   NOW() - INTERVAL '3 hours', NOW() - INTERVAL '3 hours', 'DEFAULT_INITIAL', TRUE),
('ZA-016', 'WRK-016', 'MC-016', 'zone-portal-surface',      NOW() - INTERVAL '3 hours', NOW() - INTERVAL '3 hours', 'DEFAULT_INITIAL', TRUE)
ON CONFLICT (id) DO NOTHING;
