/**
 * MineCare - Safety Logic & Threshold Types
 * 
 * IMPORTANT DISCLAIMER:
 * Prototype thresholds are for experimental testing and validation.
 * They are NOT certified or industrially validated mine-safety limits.
 */

import type { HardwareOutputs } from './telemetry';

export type SafetyStatus = 'SAFE' | 'WARNING' | 'DANGER';

export type HazardTrigger = 
  | 'SOS_BUTTON_TRIGGERED'
  | 'FALL_IMPACT_DETECTED'
  | 'HIGH_RAW_GAS_LEVEL'
  | 'HIGH_TEMPERATURE'
  | 'MULTIPLE_HAZARDS'
  | 'NOMINAL';

export interface PrototypeThresholds {
  fallAccelerationThreshold: number; // 15.0 m/s²
  highGasRawThreshold: number;       // 800 (raw ADC 0-1023)
  highTemperatureThreshold: number;  // 40.0 °C
}

export const PROTOTYPE_THRESHOLDS: PrototypeThresholds = {
  fallAccelerationThreshold: 15.0,
  highGasRawThreshold: 800,
  highTemperatureThreshold: 40.0,
};

export interface SafetyEvaluationResult {
  status: SafetyStatus;
  primaryTrigger: HazardTrigger;
  triggerDetails: string[];
  outputs: HardwareOutputs;
  isPrototypeNotice: boolean;
}
