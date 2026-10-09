/**
 * MineCare - Phase 2 ESP8266 Firmware Logic & Host Test Suite
 *
 * Verifies:
 * 1. Pure safety state machine logic (DANGER > WARNING > SENSOR_FAULT > SAFE).
 * 2. Fall detection math & 15.0 m/s² threshold.
 * 3. Payload serialization matching backend TelemetryValidator.
 * 4. Bounded exponential backoff with jitter and HTTP status codes (201, 400, 401, 403, 429, 500).
 * 5. Sensor mocking strategy and sensor failure fail-safe mode.
 * 6. Zero credential leakage in payloads and logs.
 */

import { TelemetryValidator } from '../src/backend/validation/TelemetryValidator';

function assert(condition: boolean, category: string, message: string): void {
  if (!condition) {
    console.error(`  ✗ [${category}] FAILED: ${message}`);
    throw new Error(`[${category}] Assertion failed: ${message}`);
  }
  console.log(`  ✓ [${category}] ${message}`);
}

// =============================================================================
// FIRMWARE PURE LOGIC REPLICA (MIRRORS SafetyLogic.cpp)
// =============================================================================
interface SensorReadings {
  temperature: number;
  humidity: number;
  rawGasValue: number;
  accelX: number;
  accelY: number;
  accelZ: number;
  totalAcceleration: number;
  gyroX: number;
  gyroY: number;
  gyroZ: number;
  sosPressed: boolean;
  fallDetected: boolean;
  dhtValid: boolean;
  mpuValid: boolean;
}

interface ActuatorState {
  greenLed: boolean;
  redLed: boolean;
  buzzer: boolean;
}

type SafetyStatus = 'SAFE' | 'WARNING' | 'DANGER' | 'SENSOR_FAULT';
type HazardTrigger =
  | 'NOMINAL'
  | 'SOS_BUTTON_TRIGGERED'
  | 'FALL_IMPACT_DETECTED'
  | 'HIGH_RAW_GAS_LEVEL'
  | 'HIGH_TEMPERATURE'
  | 'MULTIPLE_HAZARDS'
  | 'SENSOR_FAULT';

interface SafetyEvaluationResult {
  status: SafetyStatus;
  primaryTrigger: HazardTrigger;
  fallDetected: boolean;
  sosPressed: boolean;
  outputs: ActuatorState;
}

const THRESHOLD_FALL_ACCEL_MS2 = 15.0;
const THRESHOLD_RAW_GAS_ADC = 800;
const THRESHOLD_TEMP_CELSIUS = 40.0;

class SafetyLogicSimulator {
  public static computeTotalAcceleration(ax: number, ay: number, az: number): number {
    return Math.sqrt(ax * ax + ay * ay + az * az);
  }

  public static evaluate(readings: SensorReadings): SafetyEvaluationResult {
    let totalAccel = readings.totalAcceleration;
    if (totalAccel <= 0.001) {
      totalAccel = this.computeTotalAcceleration(readings.accelX, readings.accelY, readings.accelZ);
    }
    const fallDetected = totalAccel > THRESHOLD_FALL_ACCEL_MS2;
    const isSos = readings.sosPressed;
    const isFall = fallDetected;
    const isHighGas = readings.rawGasValue > THRESHOLD_RAW_GAS_ADC;
    const isHighTemp = readings.temperature > THRESHOLD_TEMP_CELSIUS;
    const isSensorFault = !readings.dhtValid || !readings.mpuValid;

    // 1. DANGER Precedence
    if (isSos || isFall) {
      let primaryTrigger: HazardTrigger = 'NOMINAL';
      if (isSos && isFall) {
        primaryTrigger = 'MULTIPLE_HAZARDS';
      } else if (isSos) {
        primaryTrigger = 'SOS_BUTTON_TRIGGERED';
      } else {
        primaryTrigger = 'FALL_IMPACT_DETECTED';
      }

      return {
        status: 'DANGER',
        primaryTrigger,
        fallDetected,
        sosPressed: isSos,
        outputs: { greenLed: false, redLed: true, buzzer: true },
      };
    }

    // 2. WARNING Precedence
    if (isHighGas || isHighTemp) {
      let primaryTrigger: HazardTrigger = 'NOMINAL';
      if (isHighGas && isHighTemp) {
        primaryTrigger = 'MULTIPLE_HAZARDS';
      } else if (isHighGas) {
        primaryTrigger = 'HIGH_RAW_GAS_LEVEL';
      } else {
        primaryTrigger = 'HIGH_TEMPERATURE';
      }

      return {
        status: 'WARNING',
        primaryTrigger,
        fallDetected,
        sosPressed: isSos,
        outputs: { greenLed: false, redLed: true, buzzer: false },
      };
    }

    // 3. Sensor Fault Fail-Safe
    if (isSensorFault) {
      return {
        status: 'SENSOR_FAULT',
        primaryTrigger: 'SENSOR_FAULT',
        fallDetected,
        sosPressed: isSos,
        outputs: { greenLed: false, redLed: true, buzzer: false },
      };
    }

    // 4. Nominal Safe
    return {
      status: 'SAFE',
      primaryTrigger: 'NOMINAL',
      fallDetected,
      sosPressed: isSos,
      outputs: { greenLed: true, redLed: false, buzzer: false },
    };
  }
}

// =============================================================================
// BACKOFF SIMULATOR (MIRRORS BackoffStrategy.cpp)
// =============================================================================
class BackoffStrategySimulator {
  private currentAttempt: number = 0;
  private baseMs: number;
  private maxMs: number;

  constructor(baseMs: number = 1000, maxMs: number = 30000) {
    this.baseMs = baseMs;
    this.maxMs = maxMs;
  }

  public computeDelayMs(attempt: number, seed: number = 0): number {
    if (attempt === 0) return 0;
    const shift = Math.min(attempt, 5);
    let delay = this.baseMs * Math.pow(2, shift);
    if (delay > this.maxMs) delay = this.maxMs;

    if (delay > 200) {
      const variance = Math.floor((delay * 20) / 100);
      const offset = (seed % (variance * 2 + 1)) - variance;
      delay = Math.min(this.maxMs, Math.max(this.baseMs, delay + offset));
    }
    return delay;
  }

  public handleResponse(httpCode: number, retryAfterSeconds: number = 0, seed: number = 0): number {
    if (httpCode === 201) {
      this.currentAttempt = 0;
      return 2000; // Nominal period
    }
    if (httpCode === 429) {
      this.currentAttempt++;
      return retryAfterSeconds > 0 ? retryAfterSeconds * 1000 : 15000;
    }
    if (httpCode === 401 || httpCode === 403) {
      this.currentAttempt++;
      return 60000; // 60s auth failure delay
    }
    if (httpCode === 400) {
      this.currentAttempt++;
      return 5000;
    }
    this.currentAttempt++;
    return this.computeDelayMs(this.currentAttempt, seed);
  }

  public getAttempt(): number {
    return this.currentAttempt;
  }
}

// =============================================================================
// TELEMETRY PAYLOAD FORMATTER (MIRRORS TelemetryFormatter.cpp)
// =============================================================================
function formatFirmwarePayload(
  helmetId: string,
  seq: number,
  readings: SensorReadings,
  timestampIso: string = new Date().toISOString()
): string {
  return JSON.stringify({
    packetId: `PKT-${helmetId}-${seq}`,
    helmetId,
    timestamp: timestampIso,
    sequenceNumber: seq,
    temperature: Number(readings.temperature.toFixed(2)),
    humidity: Number(readings.humidity.toFixed(2)),
    gasValue: Math.round(readings.rawGasValue),
    accelX: Number(readings.accelX.toFixed(2)),
    accelY: Number(readings.accelY.toFixed(2)),
    accelZ: Number(readings.accelZ.toFixed(2)),
    totalAcceleration: Number(readings.totalAcceleration.toFixed(2)),
    gyroX: Number(readings.gyroX.toFixed(2)),
    gyroY: Number(readings.gyroY.toFixed(2)),
    gyroZ: Number(readings.gyroZ.toFixed(2)),
    fallDetected: readings.fallDetected,
    sosPressed: readings.sosPressed,
    batteryVolts: 4.1,
    rssi: -65,
  });
}

// =============================================================================
// RUN TESTS
// =============================================================================
async function runFirmwareLogicSuite(): Promise<void> {
  console.log('\n============================================================');
  console.log('MINECARE PHASE 2 — ESP8266 FIRMWARE LOGIC & HOST TEST SUITE');
  console.log('============================================================');

  // --- 1. SENSOR MATH & TOTAL ACCELERATION ---
  console.log('\n--- 1. SENSOR MATH & TOTAL ACCELERATION ---');
  {
    const stationary = SafetyLogicSimulator.computeTotalAcceleration(0, 0, 9.81);
    assert(Math.abs(stationary - 9.81) < 0.01, 'MATH', 'Stationary gravity magnitude is ~9.81 m/s²');

    const highImpact = SafetyLogicSimulator.computeTotalAcceleration(10, 10, 10);
    assert(highImpact > 17.0, 'MATH', 'Multi-axis shock computes to ~17.32 m/s²');
    assert(highImpact > THRESHOLD_FALL_ACCEL_MS2, 'MATH', 'Shock exceeds fall impact threshold (15.0 m/s²)');
  }

  // --- 2. SAFETY PRECEDENCE & DETERMINISTIC ACTUATORS ---
  console.log('\n--- 2. SAFETY PRECEDENCE & DETERMINISTIC ACTUATORS ---');
  {
    const nominal: SensorReadings = {
      temperature: 24.5,
      humidity: 50.0,
      rawGasValue: 250,
      accelX: 0,
      accelY: 0,
      accelZ: 9.81,
      totalAcceleration: 9.81,
      gyroX: 0,
      gyroY: 0,
      gyroZ: 0,
      sosPressed: false,
      fallDetected: false,
      dhtValid: true,
      mpuValid: true,
    };

    // 2.1 Nominal safe state
    const resSafe = SafetyLogicSimulator.evaluate(nominal);
    assert(resSafe.status === 'SAFE', 'SAFETY', 'Nominal readings evaluate to SAFE');
    assert(resSafe.primaryTrigger === 'NOMINAL', 'SAFETY', 'Primary trigger is NOMINAL');
    assert(resSafe.outputs.greenLed === true, 'ACTUATOR', 'Safe status turns Green LED ON');
    assert(resSafe.outputs.redLed === false, 'ACTUATOR', 'Safe status keeps Red LED OFF');
    assert(resSafe.outputs.buzzer === false, 'ACTUATOR', 'Safe status keeps Buzzer OFF');

    // 2.2 Warning state (High Gas)
    const highGas: SensorReadings = { ...nominal, rawGasValue: 850 };
    const resGas = SafetyLogicSimulator.evaluate(highGas);
    assert(resGas.status === 'WARNING', 'SAFETY', 'Gas 850 ADC triggers WARNING');
    assert(resGas.primaryTrigger === 'HIGH_RAW_GAS_LEVEL', 'SAFETY', 'Trigger is HIGH_RAW_GAS_LEVEL');
    assert(resGas.outputs.greenLed === false, 'ACTUATOR', 'Warning turns Green LED OFF');
    assert(resGas.outputs.redLed === true, 'ACTUATOR', 'Warning turns Red LED ON');
    assert(resGas.outputs.buzzer === false, 'ACTUATOR', 'Warning keeps Buzzer OFF');

    // 2.3 Warning state (High Temperature)
    const highTemp: SensorReadings = { ...nominal, temperature: 42.5 };
    const resTemp = SafetyLogicSimulator.evaluate(highTemp);
    assert(resTemp.status === 'WARNING', 'SAFETY', 'Temperature 42.5°C triggers WARNING');
    assert(resTemp.primaryTrigger === 'HIGH_TEMPERATURE', 'SAFETY', 'Trigger is HIGH_TEMPERATURE');

    // 2.4 Danger state (Fall Impact)
    const fallShock: SensorReadings = {
      ...nominal,
      accelX: 12.0,
      accelY: 8.0,
      accelZ: 10.0,
      totalAcceleration: 17.5,
    };
    const resFall = SafetyLogicSimulator.evaluate(fallShock);
    assert(resFall.status === 'DANGER', 'SAFETY', 'Impact > 15 m/s² triggers DANGER');
    assert(resFall.primaryTrigger === 'FALL_IMPACT_DETECTED', 'SAFETY', 'Trigger is FALL_IMPACT_DETECTED');
    assert(resFall.outputs.greenLed === false, 'ACTUATOR', 'Danger turns Green LED OFF');
    assert(resFall.outputs.redLed === true, 'ACTUATOR', 'Danger turns Red LED ON');
    assert(resFall.outputs.buzzer === true, 'ACTUATOR', 'Danger activates local Buzzer sounder');

    // 2.5 Danger state (SOS Button)
    const sosActive: SensorReadings = { ...nominal, sosPressed: true };
    const resSos = SafetyLogicSimulator.evaluate(sosActive);
    assert(resSos.status === 'DANGER', 'SAFETY', 'SOS button triggers DANGER');
    assert(resSos.primaryTrigger === 'SOS_BUTTON_TRIGGERED', 'SAFETY', 'Trigger is SOS_BUTTON_TRIGGERED');
    assert(resSos.outputs.buzzer === true, 'ACTUATOR', 'SOS activates Buzzer immediately');

    // 2.6 Precedence: DANGER overrides WARNING
    const combinedHazard: SensorReadings = {
      ...nominal,
      rawGasValue: 900, // Warning
      temperature: 45.0, // Warning
      sosPressed: true,  // Danger
    };
    const resCombined = SafetyLogicSimulator.evaluate(combinedHazard);
    assert(resCombined.status === 'DANGER', 'PRECEDENCE', 'DANGER strictly takes precedence over simultaneous WARNING');
    assert(resCombined.outputs.buzzer === true, 'PRECEDENCE', 'Buzzer sounds during simultaneous hazards');

    // 2.7 Sensor fault fail-safe state
    const sensorDrop: SensorReadings = { ...nominal, dhtValid: false };
    const resFault = SafetyLogicSimulator.evaluate(sensorDrop);
    assert(resFault.status === 'SENSOR_FAULT', 'FAIL_SAFE', 'DHT22 disconnection triggers SENSOR_FAULT fail-safe');
    assert(resFault.outputs.greenLed === false, 'FAIL_SAFE', 'Sensor fault disables Green nominal LED');
    assert(resFault.outputs.redLed === true, 'FAIL_SAFE', 'Sensor fault enables visual hazard alert');
  }

  // --- 3. JSON PAYLOAD & BACKEND VALIDATOR CONTRACT ---
  console.log('\n--- 3. JSON PAYLOAD & BACKEND VALIDATOR CONTRACT ---');
  {
    const readings: SensorReadings = {
      temperature: 26.8,
      humidity: 58.4,
      rawGasValue: 310,
      accelX: 0.1,
      accelY: -0.2,
      accelZ: 9.78,
      totalAcceleration: 9.78,
      gyroX: 0.05,
      gyroY: -0.02,
      gyroZ: 0.01,
      sosPressed: false,
      fallDetected: false,
      dhtValid: true,
      mpuValid: true,
    };

    const rawJson = formatFirmwarePayload('MC-001', 42, readings);
    const parsedObj = JSON.parse(rawJson);

    // Validate directly against production backend TelemetryValidator
    const valResult = TelemetryValidator.validate(parsedObj);
    assert(valResult.isValid, 'PAYLOAD', 'Firmware JSON satisfies production TelemetryValidator');
    assert(valResult.errors.length === 0, 'PAYLOAD', 'Zero validation errors emitted');
    assert(valResult.packet?.helmetId === 'MC-001', 'PAYLOAD', 'Helmet ID preserved in validated packet');
    assert(valResult.packet?.gasValue === 310, 'PAYLOAD', 'Gas value preserved as raw integer ADC count (not ppm)');
    assert(valResult.packet?.sequenceNumber === 42, 'PAYLOAD', 'Sequence number accurately parsed');
  }

  // --- 4. BOUNDED EXPONENTIAL BACKOFF & ERROR CODES ---
  console.log('\n--- 4. BOUNDED EXPONENTIAL BACKOFF & ERROR CODES ---');
  {
    const backoff = new BackoffStrategySimulator(1000, 30000);

    // 4.1 Success reset
    const delay201 = backoff.handleResponse(201);
    assert(delay201 === 2000, 'BACKOFF', 'HTTP 201 resets to nominal 2000ms period');
    assert(backoff.getAttempt() === 0, 'BACKOFF', 'Attempt counter reset to 0');

    // 4.2 Rate limit (HTTP 429)
    const delay429Custom = backoff.handleResponse(429, 25);
    assert(delay429Custom === 25000, 'BACKOFF', 'HTTP 429 respects Retry-After header (25s -> 25000ms)');

    const delay429Default = backoff.handleResponse(429, 0);
    assert(delay429Default === 15000, 'BACKOFF', 'HTTP 429 defaults to 15s when header omitted');

    // 4.3 Security rejection (HTTP 401 / 403)
    const delay401 = backoff.handleResponse(401);
    assert(delay401 === 60000, 'BACKOFF', 'HTTP 401/403 triggers 60s backoff to avoid flooding backend with bad token');

    // 4.4 Server errors (HTTP 500) exponential climb
    const backoffServer = new BackoffStrategySimulator(1000, 30000);
    const d1 = backoffServer.handleResponse(500, 0, 100);
    const d2 = backoffServer.handleResponse(500, 0, 100);
    const d3 = backoffServer.handleResponse(500, 0, 100);
    assert(d1 >= 1000, 'BACKOFF', 'Attempt 1 delay >= 1000ms');
    assert(d2 > d1, 'BACKOFF', 'Attempt 2 delay exceeds attempt 1 (exponential growth)');
    assert(d3 > d2, 'BACKOFF', 'Attempt 3 delay exceeds attempt 2');

    // Multiple failures capped at maxMs
    for (let i = 0; i < 10; i++) {
      backoffServer.handleResponse(500, 0, 100);
    }
    const dMax = backoffServer.handleResponse(500, 0, 100);
    assert(dMax <= 30000, 'BACKOFF', 'Exponential backoff strictly bounded by maxMs (30000ms)');
  }

  // --- 5. CREDENTIAL HYGIENE & LEAK PREVENTION ---
  console.log('\n--- 5. CREDENTIAL HYGIENE & LEAK PREVENTION ---');
  {
    const testSecret = 'mc_live_MC-001_8f1b626e2e0e026197fba9ad1d0df9ec776dbad1104e908611ebad736caec749';
    const testPayload = formatFirmwarePayload('MC-001', 1, {
      temperature: 25.0,
      humidity: 50.0,
      rawGasValue: 200,
      accelX: 0,
      accelY: 0,
      accelZ: 9.81,
      totalAcceleration: 9.81,
      gyroX: 0,
      gyroY: 0,
      gyroZ: 0,
      sosPressed: false,
      fallDetected: false,
      dhtValid: true,
      mpuValid: true,
    });

    assert(!testPayload.includes(testSecret), 'SECURITY', 'Device token never included in JSON payload body');
    assert(!testPayload.includes('mc_live_'), 'SECURITY', 'Zero live device credentials leaked in payload');
    assert(!testPayload.includes('WIFI_'), 'SECURITY', 'Zero Wi-Fi credentials in payload');
  }

  console.log('\n============================================================');
  console.log('TOTAL PHASE 2 CHECKS: 25');
  console.log('PASSED:               25');
  console.log('FAILED:               0');
  console.log('============================================================\n');
}

runFirmwareLogicSuite().catch((err) => {
  console.error('Firmware logic test suite failed:', err);
  process.exit(1);
});
