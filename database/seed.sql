-- ====================================================================
-- MINECARE SEED DATA (Canonical 16-Worker, 16-Helmet, 4-Zone Fleet)
-- ====================================================================

-- 1. SEED MINE ZONES
INSERT INTO mine_zones (id, name, level, depth_meters, description, status) VALUES
('zone-portal-surface', 'Portal / Surface', 'Surface', 0, 'Main entrance portal, lamp room, dispatch center & staging area.', 'ACTIVE'),
('zone-level-1-north-drift', 'Level 1 — North Drift', 'Level 1', 180, 'Drill and blast production drift, auxiliary ventilation branch.', 'ACTIVE'),
('zone-level-2-south-panel', 'Level 2 — South Panel', 'Level 2', 360, 'Longwall extraction panel, conveyor transfer, secondary egress.', 'ACTIVE'),
('zone-level-3-haul-road', 'Level 3 — Haul Road', 'Level 3', 520, 'Primary heavy equipment haulage drift and crusher hopper gallery.', 'ACTIVE')
ON CONFLICT (id) DO UPDATE SET
  name = EXCLUDED.name,
  level = EXCLUDED.level,
  depth_meters = EXCLUDED.depth_meters,
  description = EXCLUDED.description;

-- 2. SEED WORKERS (16 Canonical MineCare Personnel)
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
ON CONFLICT (id) DO UPDATE SET
  name = EXCLUDED.name,
  role = EXCLUDED.role,
  shift = EXCLUDED.shift,
  assigned_zone_id = EXCLUDED.assigned_zone_id;

-- 3. SEED HELMETS (MC-001 through MC-016)
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
ON CONFLICT (id) DO UPDATE SET
  worker_id = EXCLUDED.worker_id,
  battery_level = EXCLUDED.battery_level;

-- 4. SEED INITIAL ZONE ASSIGNMENTS (4 workers per zone)
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

-- 5. SEED CANONICAL USER PROFILES
INSERT INTO profiles (id, auth_user_id, name, email, role, worker_id, active) VALUES
('PRF-001', 'auth-admin-001', 'Admin Operator', 'admin@minecare.local', 'ADMIN', NULL, TRUE),
('PRF-002', 'auth-sup-001', 'R. Supervisor', 'supervisor@minecare.local', 'SUPERVISOR', NULL, TRUE),
('PRF-003', 'auth-wrk-001', 'R. Marak', 'worker.marak@minecare.local', 'WORKER', 'WRK-001', TRUE),
('PRF-004', 'auth-wrk-002', 'S. Kujur', 'worker.kujur@minecare.local', 'WORKER', 'WRK-002', TRUE)
ON CONFLICT (email) DO UPDATE SET
  name = EXCLUDED.name,
  role = EXCLUDED.role,
  worker_id = EXCLUDED.worker_id;
