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
    dhtValid?: boolean;
    mpuValid?: boolean;
  }): SafetyEvaluation {
    const details: string[] = [];
    const dhtValid = packet.dhtValid ?? true;
    const mpuValid = packet.mpuValid ?? true;
    const isSensorFault = !dhtValid || !mpuValid;

    // Evaluate individual hazard conditions
    // Fall impact is only trustworthy when MPU6050 is valid
    const isFall = mpuValid && packet.totalAcceleration > PROTOTYPE_LIMITS.FALL_ACCELERATION;
    const isSos = Boolean(packet.sosPressed);
    const isHighGas = packet.gasValue > PROTOTYPE_LIMITS.HIGH_GAS_RAW;
    // High temperature is only trustworthy when DHT22 is valid
    const isHighTemp = dhtValid && packet.temperature > PROTOTYPE_LIMITS.HIGH_TEMPERATURE;

    if (isSos) {
      details.push('SOS Push-Button Emergency Activated by Worker');
    }
    if (isFall) {
      details.push(`Impact Fall Detected (${packet.totalAcceleration.toFixed(1)} m/s² > ${PROTOTYPE_LIMITS.FALL_ACCELERATION} m/s²)`);
    }
    if (isHighGas) {
      details.push(`Elevated Raw Gas Reading (${packet.gasValue} > ${PROTOTYPE_LIMITS.HIGH_GAS_RAW} ADC)`);
    }
    if (isHighTemp) {
      details.push(`Elevated Ambient Temperature (${packet.temperature.toFixed(1)}°C > ${PROTOTYPE_LIMITS.HIGH_TEMPERATURE}°C)`);
    }
    if (!dhtValid) {
      details.push('DHT22 Sensor Communication Fault / Disconnected');
    }
    if (!mpuValid) {
      details.push('MPU6050 Accelerometer/Gyro I2C Bus Fault / Disconnected');
    }

    const hazardCount = (isSos ? 1 : 0) + (isFall ? 1 : 0) + (isHighGas ? 1 : 0) + (isHighTemp ? 1 : 0);

    // 1. DANGER (Highest Priority: SOS or Fall)
    // Critical SOS emergency button ALWAYS takes precedence even during sensor fault
    if (isSos || isFall) {
      let primaryTrigger: HazardTrigger = 'NOMINAL';
      if (hazardCount > 1) {
        primaryTrigger = 'MULTIPLE_HAZARDS';
      } else if (isSos) {
        primaryTrigger = 'SOS_BUTTON_TRIGGERED';
      } else {
        primaryTrigger = 'FALL_IMPACT_DETECTED';
      }

      return {
        status: 'DANGER',
        primaryTrigger,
        triggerDetails: details,
        isPrototypeNotice: true,
        outputs: { greenLed: false, redLed: true, buzzer: true },
      };
    }

    // 2. WARNING (Medium Priority: Gas or Temperature)
    if (isHighGas || isHighTemp) {
      let primaryTrigger: HazardTrigger = 'NOMINAL';
      if (hazardCount > 1) {
        primaryTrigger = 'MULTIPLE_HAZARDS';
      } else if (isHighGas) {
        primaryTrigger = 'HIGH_RAW_GAS_LEVEL';
      } else {
        primaryTrigger = 'HIGH_TEMPERATURE';
      }

      return {
        status: 'WARNING',
        primaryTrigger,
        triggerDetails: details,
        isPrototypeNotice: true,
        outputs: { greenLed: false, redLed: true, buzzer: false },
      };
    }

    // 3. SENSOR FAULT FAIL-SAFE (Sensor disconnected or read failure)
    // Critical sensors MUST NOT silently appear SAFE or report confirmed healthy baseline
    if (isSensorFault) {
      return {
        status: 'SENSOR_FAULT',
        primaryTrigger: 'SENSOR_FAULT',
        triggerDetails: details,
        isPrototypeNotice: true,
        outputs: { greenLed: false, redLed: true, buzzer: false },
      };
    }

    // 4. SAFE (Nominal - only when all critical sensors are verified valid and within limits)
    return {
      status: 'SAFE',
      primaryTrigger: 'NOMINAL',
      triggerDetails: ['All sensor readings within prototype safe baseline thresholds'],
      isPrototypeNotice: true,
      outputs: { greenLed: true, redLed: false, buzzer: false },
    };
  }
}
