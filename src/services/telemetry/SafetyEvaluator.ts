/**
 * MineCare - Prototype Safety Threshold Evaluator
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

import type { HardwareOutputs, HelmetTelemetryPacket } from '../../types/telemetry';
import { 
  PROTOTYPE_THRESHOLDS, 
  type HazardTrigger, 
  type SafetyEvaluationResult, 
  type SafetyStatus 
} from '../../types/safety';

export class SafetyEvaluator {
  /**
   * Pure evaluation function
   */
  public static evaluate(packet: Pick<HelmetTelemetryPacket, 'dht22' | 'mq2' | 'mpu6050' | 'sosPressed'>): SafetyEvaluationResult {
    const triggerDetails: string[] = [];
    let status: SafetyStatus = 'SAFE';
    let primaryTrigger: HazardTrigger = 'NOMINAL';

    // 1. Check DANGER condition (Highest priority)
    const isFall = packet.mpu6050.totalAcceleration > PROTOTYPE_THRESHOLDS.fallAccelerationThreshold;
    const isSos = packet.sosPressed;

    if (isSos || isFall) {
      status = 'DANGER';
      if (isSos && isFall) {
        primaryTrigger = 'MULTIPLE_HAZARDS';
        triggerDetails.push('SOS Push-Button Emergency Activated');
        triggerDetails.push(`Impact Fall Detected (${packet.mpu6050.totalAcceleration.toFixed(1)} m/s² > ${PROTOTYPE_THRESHOLDS.fallAccelerationThreshold} m/s²)`);
      } else if (isSos) {
        primaryTrigger = 'SOS_BUTTON_TRIGGERED';
        triggerDetails.push('SOS Push-Button Emergency Activated by Worker');
      } else {
        primaryTrigger = 'FALL_IMPACT_DETECTED';
        triggerDetails.push(`Impact Fall Threshold Exceeded (${packet.mpu6050.totalAcceleration.toFixed(1)} m/s² > ${PROTOTYPE_THRESHOLDS.fallAccelerationThreshold} m/s²)`);
      }
    } 
    // 2. Check WARNING condition (Medium priority)
    else {
      const isHighGas = packet.mq2.rawGasValue > PROTOTYPE_THRESHOLDS.highGasRawThreshold;
      const isHighTemp = packet.dht22.temperature > PROTOTYPE_THRESHOLDS.highTemperatureThreshold;

      if (isHighGas || isHighTemp) {
        status = 'WARNING';
        if (isHighGas && isHighTemp) {
          primaryTrigger = 'MULTIPLE_HAZARDS';
          triggerDetails.push(`Elevated Raw Gas Reading (${packet.mq2.rawGasValue} > ${PROTOTYPE_THRESHOLDS.highGasRawThreshold} ADC)`);
          triggerDetails.push(`Elevated Ambient Temperature (${packet.dht22.temperature.toFixed(1)}°C > ${PROTOTYPE_THRESHOLDS.highTemperatureThreshold}°C)`);
        } else if (isHighGas) {
          primaryTrigger = 'HIGH_RAW_GAS_LEVEL';
          triggerDetails.push(`Elevated Raw Gas Reading (${packet.mq2.rawGasValue} > ${PROTOTYPE_THRESHOLDS.highGasRawThreshold} ADC)`);
        } else {
          primaryTrigger = 'HIGH_TEMPERATURE';
          triggerDetails.push(`Elevated Ambient Temperature (${packet.dht22.temperature.toFixed(1)}°C > ${PROTOTYPE_THRESHOLDS.highTemperatureThreshold}°C)`);
        }
      } else {
        // 3. SAFE (Normal)
        status = 'SAFE';
        primaryTrigger = 'NOMINAL';
        triggerDetails.push('All sensor readings within prototype safe baseline thresholds');
      }
    }

    // Determine Hardware Outputs according to specification:
    // SAFE: Green LED ON, Red LED OFF, Buzzer OFF
    // WARNING: Green LED OFF, Red LED ON, Buzzer OFF
    // DANGER: Green LED OFF, Red LED ON, Buzzer ON
    const outputs: HardwareOutputs = {
      greenLed: status === 'SAFE',
      redLed: status === 'WARNING' || status === 'DANGER',
      buzzer: status === 'DANGER',
    };

    return {
      status,
      primaryTrigger,
      triggerDetails,
      outputs,
      isPrototypeNotice: true,
    };
  }
}
