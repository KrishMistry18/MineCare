/**
 * MineCare - Telemetry Contract
 * Note: MQ-2 sensor value is strictly RAW analog reading (0 - 1023).
 * No uncalibrated ppm conversion is performed.
 */

export interface MPU6050Reading {
  accelX: number; // m/s²
  accelY: number; // m/s²
  accelZ: number; // m/s²
  totalAcceleration: number; // sqrt(ax^2 + ay^2 + az^2) in m/s²
  gyroX: number;  // °/s
  gyroY: number;  // °/s
  gyroZ: number;  // °/s
}

export interface DHT22Reading {
  temperature: number; // °C
  humidity: number;    // %
}

export interface MQ2Reading {
  rawGasValue: number; // 0 - 1023 raw analog value from A0
}

export interface SensorHealth {
  dht22: boolean;
  mq2: boolean;
  mpu6050: boolean;
}

export interface HardwareOutputs {
  greenLed: boolean; // Proposed D0 / GPIO16
  redLed: boolean;   // Proposed D4 / GPIO2
  buzzer: boolean;   // Proposed D3 / GPIO0
}

export interface HelmetTelemetryPacket {
  packetId: string;
  helmetId: string;
  timestamp: string; // ISO 8601
  sequenceNumber: number;
  dht22: DHT22Reading;
  mq2: MQ2Reading;
  mpu6050: MPU6050Reading;
  sosPressed: boolean; // Proposed D1 / GPIO5
  fallDetected: boolean; // Evaluated threshold: totalAcceleration > 15.0 m/s²
  sensorHealth: SensorHealth;
  outputs: HardwareOutputs;
  rssi: number; // dBm signal indicator (-40 to -90)
  batteryVolts: number; // Simulated battery voltage (3.5 - 4.2V)
}

export type ScenarioType =
  | 'SAFE'
  | 'HIGH_TEMPERATURE'
  | 'HIGH_GAS'
  | 'FALL_DETECTED'
  | 'SOS_ACTIVATED'
  | 'MULTIPLE_ALERTS'
  | 'SENSOR_OFFLINE'
  | 'HELMET_OFFLINE'
  | 'RECOVERY';

export interface TelemetryHistoryPoint {
  timestamp: string;
  timeFormatted: string;
  temperature: number;
  humidity: number;
  rawGasValue: number;
  totalAcceleration: number;
  accelX: number;
  accelY: number;
  accelZ: number;
  gyroX: number;
  gyroY: number;
  gyroZ: number;
  sosPressed: boolean;
  fallDetected: boolean;
}
