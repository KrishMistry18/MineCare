/**
 * MineCare - Telemetry Ingestion Validator
 *
 * Validates incoming telemetry packets:
 * - Rejects malformed JSON, missing required fields, out-of-bounds metrics.
 * - Handles both nested sensor formats (DHT22, MQ-2, MPU6050) and flattened schemas.
 * - Ensures raw gas value is treated strictly as an ADC reading (0-1023), not ppm.
 */

import type { TelemetryIngestPayload, ValidatedTelemetryPacket } from '../types';

export interface ValidationResult {
  isValid: boolean;
  errors: string[];
  packet?: ValidatedTelemetryPacket;
}

export class TelemetryValidator {
  public static validate(payload: unknown): ValidationResult {
    const errors: string[] = [];

    if (!payload || typeof payload !== 'object') {
      return { isValid: false, errors: ['Payload must be a non-null JSON object'] };
    }

    const data = payload as TelemetryIngestPayload;

    // 1. Helmet ID validation
    if (!data.helmetId || typeof data.helmetId !== 'string' || data.helmetId.trim().length === 0) {
      errors.push('helmetId is required and must be a non-empty string');
    }

    // 2. Timestamp validation
    let timestamp = data.timestamp;
    if (!timestamp) {
      timestamp = new Date().toISOString();
    } else {
      const parsed = Date.parse(timestamp);
      if (isNaN(parsed)) {
        errors.push(`Invalid timestamp format: ${timestamp}`);
      } else {
        const diffMs = parsed - Date.now();
        // Reject if more than 1 day in the future
        if (diffMs > 86400000) {
          errors.push('Timestamp cannot be more than 24 hours in the future');
        }
      }
    }

    // 3. Temperature validation
    const tempRaw = data.dht22?.temperature ?? data.temperature;
    if (tempRaw === undefined || typeof tempRaw !== 'number' || isNaN(tempRaw) || !isFinite(tempRaw)) {
      errors.push('temperature must be a finite number');
    } else if (tempRaw < -50 || tempRaw > 120) {
      errors.push(`temperature value (${tempRaw}) is outside plausible physical range [-50, 120] °C`);
    }

    // 4. Humidity validation
    const humidityRaw = data.dht22?.humidity ?? data.humidity;
    if (humidityRaw === undefined || typeof humidityRaw !== 'number' || isNaN(humidityRaw) || !isFinite(humidityRaw)) {
      errors.push('humidity must be a finite number');
    } else if (humidityRaw < 0 || humidityRaw > 100) {
      errors.push(`humidity (${humidityRaw}) must be between 0% and 100%`);
    }

    // 5. Gas Value validation (MQ-2 Raw ADC 0-1023)
    const gasRaw = data.mq2?.rawGasValue ?? data.gasValue ?? data.rawGasValue;
    if (gasRaw === undefined || typeof gasRaw !== 'number' || isNaN(gasRaw) || !isFinite(gasRaw)) {
      errors.push('gas_value must be a finite number');
    } else if (gasRaw < 0 || gasRaw > 1023) {
      errors.push(`gas_value (${gasRaw}) must be an analog ADC reading between 0 and 1023`);
    }

    // 6. Acceleration validation
    const accelX = data.mpu6050?.accelX ?? data.accelX ?? 0;
    const accelY = data.mpu6050?.accelY ?? data.accelY ?? 0;
    const accelZ = data.mpu6050?.accelZ ?? data.accelZ ?? 9.81;

    if (typeof accelX !== 'number' || isNaN(accelX) || !isFinite(accelX) ||
        typeof accelY !== 'number' || isNaN(accelY) || !isFinite(accelY) ||
        typeof accelZ !== 'number' || isNaN(accelZ) || !isFinite(accelZ)) {
      errors.push('accelX, accelY, accelZ must be finite numbers');
    }

    let totalAcceleration = data.mpu6050?.totalAcceleration ?? data.totalAcceleration;
    if (totalAcceleration === undefined || typeof totalAcceleration !== 'number' || isNaN(totalAcceleration)) {
      totalAcceleration = Math.sqrt(accelX * accelX + accelY * accelY + accelZ * accelZ);
    }

    // 7. Gyroscope validation
    const gyroX = data.mpu6050?.gyroX ?? data.gyroX ?? 0;
    const gyroY = data.mpu6050?.gyroY ?? data.gyroY ?? 0;
    const gyroZ = data.mpu6050?.gyroZ ?? data.gyroZ ?? 0;

    if (typeof gyroX !== 'number' || isNaN(gyroX) || !isFinite(gyroX) ||
        typeof gyroY !== 'number' || isNaN(gyroY) || !isFinite(gyroY) ||
        typeof gyroZ !== 'number' || isNaN(gyroZ) || !isFinite(gyroZ)) {
      errors.push('gyroX, gyroY, gyroZ must be finite numbers');
    }

    // 8. Event booleans
    const fallDetected = Boolean(data.fallDetected ?? (totalAcceleration > 15.0));
    const sosPressed = Boolean(data.sosPressed);

    if (errors.length > 0) {
      return { isValid: false, errors };
    }

    const validated: ValidatedTelemetryPacket = {
      packetId: data.packetId || `PKT-${data.helmetId}-${Date.now()}`,
      helmetId: data.helmetId.trim(),
      timestamp: timestamp!,
      sequenceNumber: Number(data.sequenceNumber || 0),
      temperature: Number((tempRaw as number).toFixed(2)),
      humidity: Number((humidityRaw as number).toFixed(2)),
      gasValue: Math.round(gasRaw as number),
      accelX: Number(accelX.toFixed(2)),
      accelY: Number(accelY.toFixed(2)),
      accelZ: Number(accelZ.toFixed(2)),
      totalAcceleration: Number(totalAcceleration.toFixed(2)),
      gyroX: Number(gyroX.toFixed(2)),
      gyroY: Number(gyroY.toFixed(2)),
      gyroZ: Number(gyroZ.toFixed(2)),
      fallDetected,
      sosPressed,
      batteryVolts: Number((data.batteryVolts ?? 4.1).toFixed(2)),
      rssi: Number((data.rssi ?? -65).toFixed(0)),
    };

    return { isValid: true, errors: [], packet: validated };
  }
}
