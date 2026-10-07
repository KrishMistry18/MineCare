/**
 * MineCare - Authoritative Server-Side Scenario Simulation Engine
 *
 * Drives deterministic scenario simulation through the authoritative
 * production telemetry ingestion boundary (/api/v1/telemetry) with bound device tokens.
 *
 * Supported Scenarios:
 * 1. SAFE / NORMAL:
 *    - Ambient baseline readings (26.5°C, 58% hum, 220 raw gas, 9.81 m/s² accel, status SAFE)
 * 2. HIGH_TEMPERATURE:
 *    - Ambient temperature 42.5°C (> 40.0°C prototype limit) -> WARNING, HEAT_STRESS alert
 * 3. HIGH_GAS:
 *    - Raw MQ-2 gas reading 915 ADC (> 800 prototype limit) -> WARNING, GAS_HAZARD alert
 * 4. FALL / FALL_DETECTED:
 *    - Total acceleration 22.4 m/s² (> 15.0 m/s²) -> DANGER, WORKER_FALL alert
 * 5. SOS / SOS_ACTIVATED:
 *    - sosPressed = true -> DANGER, SOS_EMERGENCY alert
 * 6. MULTIPLE_HAZARDS / MULTIPLE_ALERTS:
 *    - Compound gas (915), temp (42.5°C), and SOS (true) -> DANGER (preserves DANGER > WARNING > SAFE)
 * 7. RECOVERY:
 *    - Normalizes sensors to safe baseline -> SAFE, resolves active environmental alerts
 * 8. HELMET_OFFLINE:
 *    - Transitions helmet to offline status
 *
 * PROTOTYPE SAFETY NOTICE:
 * MQ-2 values are raw ADC units (0–1023), not ppm or methane concentration.
 * Prototype thresholds are for software demonstration and not certified mine safety limits.
 */

import type { ScenarioType } from '../../types/telemetry';
import type { ValidatedTelemetryPacket } from '../types';

export class SimulationEngine {
  private static sequenceNumbers: Map<string, number> = new Map();

  /**
   * Generates sequential packet sequence numbers per helmet.
   */
  public static getNextSequence(helmetId: string): number {
    const next = (this.sequenceNumbers.get(helmetId) || 100) + 1;
    this.sequenceNumbers.set(helmetId, next);
    return next;
  }

  /**
   * Canonicalizes human and programmatic scenario identifier inputs.
   */
  public static normalizeScenario(rawScenario: string): ScenarioType {
    const upper = rawScenario.trim().toUpperCase().replace(/[\s-]+/g, '_');
    if (upper === 'HIGH_GAS' || upper === 'HIGHGAS') return 'HIGH_GAS';
    if (upper === 'HIGH_TEMPERATURE' || upper === 'HIGHTEMPERATURE' || upper === 'HIGH_TEMP') return 'HIGH_TEMPERATURE';
    if (upper === 'FALL' || upper === 'FALL_DETECTED' || upper === 'FALLDETECTED') return 'FALL_DETECTED';
    if (upper === 'SOS' || upper === 'SOS_ACTIVATED' || upper === 'SOSACTIVATED' || upper === 'SOS_EMERGENCY') return 'SOS_ACTIVATED';
    if (
      upper === 'MULTIPLE_HAZARDS' ||
      upper === 'MULTIPLE_ALERTS' ||
      upper === 'MULTIPLEALERTS' ||
      upper === 'MULTIPLEHAZARDS'
    ) {
      return 'MULTIPLE_ALERTS';
    }
    if (upper === 'RECOVERY') return 'RECOVERY';
    if (upper === 'HELMET_OFFLINE' || upper === 'OFFLINE') return 'HELMET_OFFLINE';
    if (upper === 'SAFE' || upper === 'NORMAL') return 'SAFE';
    return 'SAFE';
  }

  /**
   * Constructs an authoritative telemetry packet representing the scenario.
   */
  public static buildScenarioPacket(
    helmetId: string,
    rawScenario: string
  ): ValidatedTelemetryPacket {
    const scenario = this.normalizeScenario(rawScenario);
    const seq = this.getNextSequence(helmetId);
    const now = new Date().toISOString();
    const packetId = `PKT-${helmetId}-SIM-${Date.now().toString().slice(-6)}`;

    // Raw MQ-2 ADC values (0–1023), NOT ppm
    let temperature = 26.5;
    let humidity = 58.0;
    let gasValue = 220;
    let accelX = 0.1;
    let accelY = 0.2;
    let accelZ = 9.81;
    let totalAcceleration = 9.81;
    let gyroX = 0.0;
    let gyroY = 0.0;
    let gyroZ = 0.0;
    let fallDetected = false;
    let sosPressed = false;

    switch (scenario) {
      case 'HIGH_GAS':
        // MQ-2 raw ADC value > 800 prototype warning threshold
        gasValue = 915;
        temperature = 26.5;
        humidity = 58.0;
        break;

      case 'HIGH_TEMPERATURE':
        // DHT22 temperature > 40.0°C prototype warning threshold
        temperature = 42.5;
        gasValue = 220;
        humidity = 62.0;
        break;

      case 'FALL_DETECTED':
        // Total acceleration > 15.0 m/s² prototype danger threshold
        accelX = 11.2;
        accelY = 10.4;
        accelZ = 16.2;
        totalAcceleration = 22.4;
        gyroX = 5.2;
        gyroY = 3.1;
        gyroZ = 4.0;
        fallDetected = true;
        break;

      case 'SOS_ACTIVATED':
        // Worker emergency push-button pressed -> DANGER
        sosPressed = true;
        break;

      case 'MULTIPLE_ALERTS':
        // Gas > 800, Temp > 40°C, and SOS pressed -> DANGER (preserves DANGER > WARNING > SAFE)
        gasValue = 915;
        temperature = 42.5;
        humidity = 62.0;
        sosPressed = true;
        break;

      case 'RECOVERY':
        // Normalized parameters -> returns to SAFE and resolves active hazard alerts
        gasValue = 220;
        temperature = 26.5;
        humidity = 58.0;
        totalAcceleration = 9.81;
        fallDetected = false;
        sosPressed = false;
        break;

      case 'SAFE':
      default:
        gasValue = 220;
        temperature = 26.5;
        humidity = 58.0;
        accelZ = 9.81;
        totalAcceleration = 9.81;
        break;
    }

    return {
      packetId,
      helmetId,
      timestamp: now,
      sequenceNumber: seq,
      temperature,
      humidity,
      gasValue,
      accelX,
      accelY,
      accelZ,
      totalAcceleration,
      gyroX,
      gyroY,
      gyroZ,
      fallDetected,
      sosPressed,
      batteryVolts: 4.1,
      rssi: -65,
    };
  }
}
