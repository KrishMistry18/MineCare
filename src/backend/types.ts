/**
 * MineCare - Backend Core Types & DTOs
 */

import type { SafetyStatus } from '../types/safety';
import type { AlertSeverity, AlertCategory } from '../types/alert';

export type ConnectivityState = 'ONLINE' | 'STALE' | 'OFFLINE';

export type UserRole = 'ADMIN' | 'SUPERVISOR' | 'WORKER';

export interface DbUserProfile {
  id: string;
  auth_user_id: string;
  name: string;
  email: string;
  role: UserRole;
  worker_id: string | null;
  active: boolean;
  created_at: string;
  updated_at: string;
}

export interface DbAuditLog {
  id: string;
  user_id: string;
  user_email: string;
  role: UserRole;
  action: string;
  target_type: string;
  target_id: string;
  details?: Record<string, unknown>;
  created_at: string;
}

export interface AuthSession {
  token: string;
  user: DbUserProfile;
  expires_at: number;
}

export interface DbMineZone {
  id: string;
  name: string;
  level: string;
  depth_meters: number;
  description: string;
  status: 'ACTIVE' | 'MAINTENANCE' | 'RESTRICTED' | 'CLEAR';
  created_at: string;
  updated_at: string;
}

export interface DbWorker {
  id: string;
  worker_code: string;
  name: string;
  role: string;
  shift: 'A' | 'B' | 'C';
  assigned_zone_id: string | null;
  status: 'ACTIVE' | 'INACTIVE' | 'ON_LEAVE';
  battery_level: number;
  created_at: string;
  updated_at: string;
}

export interface DbHelmet {
  id: string;
  helmet_code: string;
  worker_id: string | null;
  status: SafetyStatus;
  online: boolean;
  last_seen: string;
  battery_level: number;
  serial_number: string;
  firmware_version: string;
  created_at: string;
  updated_at: string;
}

export interface DbZoneAssignment {
  id: string;
  worker_id: string;
  helmet_id: string;
  zone_id: string;
  assigned_at: string;
  checked_in_at: string;
  checked_out_at: string | null;
  assignment_type: 'CHECK_IN' | 'SUPERVISOR_REASSIGN' | 'DEFAULT_INITIAL';
  active: boolean;
  created_at: string;
}

export interface DbTelemetry {
  id: string;
  helmet_id: string;
  timestamp: string;
  sequence_number: number;
  temperature: number;
  humidity: number;
  gas_value: number; // RAW 0-1023 ADC, not ppm
  acceleration_x: number;
  acceleration_y: number;
  acceleration_z: number;
  total_acceleration: number;
  gyro_x: number;
  gyro_y: number;
  gyro_z: number;
  fall_detected: boolean;
  sos_pressed: boolean;
  safety_status: SafetyStatus;
  created_at: string;
}

export interface DbAlert {
  id: string;
  helmet_id: string;
  worker_id: string | null;
  type: AlertCategory;
  severity: AlertSeverity;
  message: string;
  status: 'TRIGGERED' | 'ACKNOWLEDGED' | 'RESOLVED';
  triggered_at: string;
  acknowledged_at: string | null;
  acknowledged_by: string | null;
  resolved_at: string | null;
  supervisor_notes: string | null;
  readings_snapshot?: {
    temperature: number;
    humidity: number;
    gas_value: number;
    total_acceleration: number;
    sos_pressed: boolean;
    fall_detected: boolean;
  };
  created_at: string;
  updated_at: string;
}

// Ingestion Payload
export interface TelemetryIngestPayload {
  packetId?: string;
  helmetId: string;
  timestamp?: string;
  sequenceNumber?: number;
  dht22?: {
    temperature: number;
    humidity: number;
  };
  mq2?: {
    rawGasValue: number;
  };
  mpu6050?: {
    accelX: number;
    accelY: number;
    accelZ: number;
    totalAcceleration?: number;
    gyroX?: number;
    gyroY?: number;
    gyroZ?: number;
  };
  // Flat properties fallback
  temperature?: number;
  humidity?: number;
  gasValue?: number;
  rawGasValue?: number;
  accelX?: number;
  accelY?: number;
  accelZ?: number;
  totalAcceleration?: number;
  gyroX?: number;
  gyroY?: number;
  gyroZ?: number;
  fallDetected?: boolean;
  sosPressed?: boolean;
  batteryVolts?: number;
  rssi?: number;
}

export interface ValidatedTelemetryPacket {
  packetId: string;
  helmetId: string;
  timestamp: string;
  sequenceNumber: number;
  temperature: number;
  humidity: number;
  gasValue: number;
  accelX: number;
  accelY: number;
  accelZ: number;
  totalAcceleration: number;
  gyroX: number;
  gyroY: number;
  gyroZ: number;
  fallDetected: boolean;
  sosPressed: boolean;
  batteryVolts: number;
  rssi: number;
}

export interface SystemHealthStatus {
  status: 'OPERATIONAL' | 'DEGRADED' | 'OFFLINE';
  timestamp: string;
  uptimeSeconds: number;
  services: {
    backend: { status: 'ONLINE' | 'OFFLINE'; port: number; version: string };
    database: { status: 'CONNECTED' | 'LOCAL_FALLBACK' | 'ERROR'; engine: string; activeRecords: number };
    telemetrySource: { status: 'STREAMING' | 'IDLE'; producer: string; packetRateHz: number };
    realtime: { status: 'ACTIVE' | 'POLLING_FALLBACK'; provider: string };
    auth: { status: 'OPERATIONAL' | 'DEGRADED'; provider: string; totalUsers: number; rlsEnforced: boolean };
  };
  metrics: {
    totalHelmets: number;
    onlineHelmets: number;
    activeWorkers: number;
    activeAlerts: number;
    totalZones: number;
  };
}
