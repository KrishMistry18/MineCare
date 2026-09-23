/**
 * MineCare - Prototype Safety Threshold Evaluator
 * 
 * Authoritative single evaluation logic delegated to SafetyEngine.
 * 
 * STRICT SPECIFICATION:
 * Priority: DANGER -> WARNING -> SAFE
 * 
 * DANGER if:
 *   - SOS is pressed
 *   - OR fall is detected (totalAcceleration > 15.0 m/s²)
 *   Outputs: Green LED OFF, Red LED ON, Buzzer ON
 * 
 * WARNING if:
 *   - rawGasValue > 800
 *   - OR temperature > 40°C
 *   Outputs: Green LED OFF, Red LED ON, Buzzer OFF
 * 
 * SAFE otherwise:
 *   Outputs: Green LED ON, Red LED OFF, Buzzer OFF
 * 
 * IMPORTANT DISCLAIMER:
 * These are PROTOTYPE thresholds and are not scientifically or industrially
 * certified safety limits. MQ-2 provides raw ADC values (0-1023) and is not ppm.
 */

import type { HelmetTelemetryPacket } from '../../types/telemetry';
import type { SafetyEvaluationResult } from '../../types/safety';
import { SafetyEngine } from '../../backend/safety/SafetyEngine';

export class SafetyEvaluator {
  /**
   * Pure evaluation function delegating to centralized authoritative SafetyEngine
   */
  public static evaluate(
    packet: Pick<HelmetTelemetryPacket, 'dht22' | 'mq2' | 'mpu6050' | 'sosPressed'>
  ): SafetyEvaluationResult {
    return SafetyEngine.evaluate({
      temperature: packet.dht22.temperature,
      gasValue: packet.mq2.rawGasValue,
      totalAcceleration: packet.mpu6050.totalAcceleration,
      sosPressed: packet.sosPressed,
    });
  }
}
