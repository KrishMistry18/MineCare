/**
 * MineCare - Alert Management Contract
 */

import type { SafetyStatus } from './safety';

export type AlertSeverity = 'CRITICAL' | 'WARNING' | 'INFO';

export type AlertCategory =
  | 'SOS_EMERGENCY'
  | 'WORKER_FALL'
  | 'GAS_HAZARD'
  | 'HEAT_STRESS'
  | 'MULTI_HAZARD'
  | 'HELMET_OFFLINE'
  | 'SENSOR_FAULT';

export interface SafetyAlert {
  id: string;
  timestamp: string; // ISO 8601
  helmetId: string;
  workerId: string;
  workerName: string;
  shaftLocation: string;
  severity: AlertSeverity;
  safetyStatus: SafetyStatus;
  category: AlertCategory;
  title: string;
  description: string;
  readingsSnapshot: {
    temperature: number;
    humidity: number;
    rawGasValue: number;
    totalAcceleration: number;
    sosPressed: boolean;
    fallDetected: boolean;
  };
  acknowledged: boolean;
  acknowledgedBy?: string;
  acknowledgedAt?: string;
  resolved: boolean;
  resolvedAt?: string;
  supervisorNotes?: string;
}
