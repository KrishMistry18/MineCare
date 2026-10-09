/**
 * MineCare - Helmet Fleet Contract
 */

import type { HelmetTelemetryPacket } from './telemetry';
import type { SafetyEvaluationResult } from './safety';

export type ConnectivityStatus = 'ONLINE' | 'OFFLINE' | 'DEGRADED';

export interface PinoutMapping {
  component: string;
  pin: string;
  gpio: string;
  type: 'SENSOR' | 'ACTUATOR' | 'INPUT';
  confirmationStatus: 'CONFIRMED' | 'PROPOSED_SOFTWARE_MAPPING';
  notes: string;
}

export const HARDWARE_PINOUT_SPEC: PinoutMapping[] = [
  {
    component: 'DHT22 (Temp & Humidity)',
    pin: 'D2',
    gpio: 'GPIO4',
    type: 'SENSOR',
    confirmationStatus: 'CONFIRMED',
    notes: 'Single-bus digital temperature and relative humidity data',
  },
  {
    component: 'MPU6050 SDA',
    pin: 'D6',
    gpio: 'GPIO12',
    type: 'SENSOR',
    confirmationStatus: 'CONFIRMED',
    notes: 'I2C Data line for 3-axis accel and 3-axis gyro',
  },
  {
    component: 'MPU6050 SCL',
    pin: 'D7',
    gpio: 'GPIO13',
    type: 'SENSOR',
    confirmationStatus: 'CONFIRMED',
    notes: 'I2C Clock line',
  },
  {
    component: 'MQ-2 Gas Sensor AOUT',
    pin: 'A0',
    gpio: 'ADC0',
    type: 'SENSOR',
    confirmationStatus: 'CONFIRMED',
    notes: 'Analog raw voltage (0-1023 ADC). Uncalibrated; not ppm.',
  },
  {
    component: 'SOS Push Button',
    pin: 'D1',
    gpio: 'GPIO5',
    type: 'INPUT',
    confirmationStatus: 'PROPOSED_SOFTWARE_MAPPING',
    notes: 'Proposed software mapping; not physically confirmed.',
  },
  {
    component: 'Green LED (Safe)',
    pin: 'D0',
    gpio: 'GPIO16',
    type: 'ACTUATOR',
    confirmationStatus: 'CONFIRMED',
    notes: 'Nominal indicator (Active HIGH via 330Ω to GND). Non-strapping pin.',
  },
  {
    component: 'Red LED (Alert/Danger)',
    pin: 'D4',
    gpio: 'GPIO2',
    type: 'ACTUATOR',
    confirmationStatus: 'CONFIRMED',
    notes: 'Hazard indicator (Active LOW via 330Ω to 3.3V to ensure GPIO2 stays HIGH at boot).',
  },
  {
    component: 'Piezo Buzzer (Alarm)',
    pin: 'D5',
    gpio: 'GPIO14',
    type: 'ACTUATOR',
    confirmationStatus: 'CONFIRMED',
    notes: 'Moved from D3 to D5 to prevent GPIO0 bootloader lockup. Non-strapping pin.',
  },
];

export interface HelmetDevice {
  helmetId: string;
  serialNumber: string;
  firmwareVersion: string;
  assignedWorkerId: string | null;
  assignedShaft: string;
  assignedZone?: string;
  currentWorkZone?: string | null;
  connectivity: ConnectivityStatus;
  lastHeartbeat: string;
  telemetry: HelmetTelemetryPacket;
  safety: SafetyEvaluationResult;
}
