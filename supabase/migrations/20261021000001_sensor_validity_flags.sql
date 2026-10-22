-- ====================================================================
-- MINECARE PHASE 2 — SENSOR VALIDITY FLAGS & SENSOR_FAULT SUPPORT
-- ====================================================================
-- Tracks DHT22 and MPU6050 physical communication integrity flags.
-- Extends safety status constraints to formally permit SENSOR_FAULT.
-- ====================================================================

-- 1. Add sensor health integrity columns to telemetry table
ALTER TABLE telemetry 
ADD COLUMN IF NOT EXISTS dht_valid BOOLEAN NOT NULL DEFAULT TRUE,
ADD COLUMN IF NOT EXISTS mpu_valid BOOLEAN NOT NULL DEFAULT TRUE;

-- 2. Extend safety_status check constraints on telemetry table
ALTER TABLE telemetry DROP CONSTRAINT IF EXISTS telemetry_safety_status_check;
ALTER TABLE telemetry ADD CONSTRAINT telemetry_safety_status_check 
CHECK (safety_status IN ('SAFE', 'WARNING', 'DANGER', 'SENSOR_FAULT'));

-- 3. Extend status check constraints on helmets table
ALTER TABLE helmets DROP CONSTRAINT IF EXISTS helmets_status_check;
ALTER TABLE helmets ADD CONSTRAINT helmets_status_check 
CHECK (status IN ('SAFE', 'WARNING', 'DANGER', 'SENSOR_FAULT'));
