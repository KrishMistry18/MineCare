/**
 * MineCare - Authoritative Central Safety Engine
 *
 * SPECIFICATION & PRECEDENCE:
 * 1. DANGER (Highest priority):
 *    - SOS push-button pressed (sos_pressed = true)
 *    - OR fall impact detected (total_acceleration > 15.0 m/s²)
 * 2. WARNING (Medium priority):
 *    - Elevated raw gas level (gas_value > 800 ADC)
 *    - OR high ambient temperature (temperature > 40.0°C)
 * 3. SAFE:
 *    - All sensor parameters within prototype baseline thresholds.
 *
 * NOTICE:
 * These are experimental prototype thresholds for software validation and are NOT
 * industrially certified mine safety standards. MQ-2 is raw ADC (0-1023), not ppm.
 */

import type { SafetyStatus, HazardTrigger } from '../../types/safety';

export interface SafetyEvaluation {
  status: SafetyStatus;
  primaryTrigger: HazardTrigger;
  triggerDetails: string[];
  isPrototypeNotice: boolean;
  outputs: {
    greenLed: boolean;
    redLed: boolean;
    buzzer: boolean;
  };
}

export const PROTOTYPE_LIMITS = {
  FALL_ACCELERATION: 15.0, // m/s²
  HIGH_GAS_RAW: 800,       // ADC raw units (0 - 1023)
  HIGH_TEMPERATURE: 40.0,  // °C
} as const;

export class SafetyEngine {
  public static evaluate(packet: {
    temperature: number;
    gasValue: number;
    totalAcceleration: number;
    sosPressed: boolean;
  }): SafetyEvaluation {
    const details: string[] = [];

    // 1. DANGER (Highest Priority)
    const isFall = packet.totalAcceleration > PROTOTYPE_LIMITS.FALL_ACCELERATION;
    const isSos = Boolean(packet.sosPressed);

    if (isSos || isFall) {
      let primaryTrigger: HazardTrigger = 'NOMINAL';
      if (isSos && isFall) {
        primaryTrigger = 'MULTIPLE_HAZARDS';
        details.push('SOS Push-Button Emergency Triggered');
        details.push(`Impact Fall Detected (${packet.totalAcceleration.toFixed(1)} m/s² > ${PROTOTYPE_LIMITS.FALL_ACCELERATION} m/s²)`);
      } else if (isSos) {
        primaryTrigger = 'SOS_BUTTON_TRIGGERED';
        details.push('SOS Push-Button Emergency Activated by Worker');
      } else {
        primaryTrigger = 'FALL_IMPACT_DETECTED';
        details.push(`Impact Fall Threshold Exceeded (${packet.totalAcceleration.toFixed(1)} m/s² > ${PROTOTYPE_LIMITS.FALL_ACCELERATION} m/s²)`);
      }

      return {
        status: 'DANGER',
        primaryTrigger,
        triggerDetails: details,
        isPrototypeNotice: true,
        outputs: { greenLed: false, redLed: true, buzzer: true },
      };
    }

    // 2. WARNING (Medium Priority)
    const isHighGas = packet.gasValue > PROTOTYPE_LIMITS.HIGH_GAS_RAW;
    const isHighTemp = packet.temperature > PROTOTYPE_LIMITS.HIGH_TEMPERATURE;

    if (isHighGas || isHighTemp) {
      let primaryTrigger: HazardTrigger = 'NOMINAL';
      if (isHighGas && isHighTemp) {
        primaryTrigger = 'MULTIPLE_HAZARDS';
        details.push(`Elevated Raw Gas Reading (${packet.gasValue} > ${PROTOTYPE_LIMITS.HIGH_GAS_RAW} ADC)`);
        details.push(`Elevated Ambient Temperature (${packet.temperature.toFixed(1)}°C > ${PROTOTYPE_LIMITS.HIGH_TEMPERATURE}°C)`);
      } else if (isHighGas) {
        primaryTrigger = 'HIGH_RAW_GAS_LEVEL';
        details.push(`Elevated Raw Gas Reading (${packet.gasValue} > ${PROTOTYPE_LIMITS.HIGH_GAS_RAW} ADC)`);
      } else {
        primaryTrigger = 'HIGH_TEMPERATURE';
        details.push(`Elevated Ambient Temperature (${packet.temperature.toFixed(1)}°C > ${PROTOTYPE_LIMITS.HIGH_TEMPERATURE}°C)`);
      }

      return {
        status: 'WARNING',
        primaryTrigger,
        triggerDetails: details,
        isPrototypeNotice: true,
        outputs: { greenLed: false, redLed: true, buzzer: false },
      };
    }

    // 3. SAFE (Nominal)
    return {
      status: 'SAFE',
      primaryTrigger: 'NOMINAL',
      triggerDetails: ['All sensor readings within prototype safe baseline thresholds'],
      isPrototypeNotice: true,
      outputs: { greenLed: true, redLed: false, buzzer: false },
    };
  }
}
