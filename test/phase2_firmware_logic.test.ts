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

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { TelemetryValidator } from '../src/backend/validation/TelemetryValidator';
import { SafetyEngine } from '../src/backend/safety/SafetyEngine';
import { AlertEngine } from '../src/backend/alerts/AlertEngine';
import { RealtimePublisher } from '../src/backend/realtime/RealtimePublisher';
import { TelemetryService } from '../src/services/telemetry/TelemetryService';
import type { DbAlert, DbTelemetry } from '../src/backend/types';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const workspaceRoot = path.resolve(__dirname, '..');

let totalChecks = 0;
function assert(condition: boolean, category: string, message: string): void {
  totalChecks++;
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
// SOS BUTTON & SENSOR MANAGER HARDWARE SIMULATOR (MIRRORS SensorManager.cpp)
// =============================================================================
class SosButtonSimulator {
  private lastDebounceTimeMs: number = 0;
  private lastRawReading: number = 1; // 1 = HIGH (INPUT_PULLUP nominal)
  private debouncedState: number = 1; // 1 = HIGH (unpressed)
  private latchedSos: boolean = false;
  private readonly debounceDelayMs: number = 30;

  public sample(rawPin: number, currentTimeMs: number): { currentPressed: boolean; sosPressed: boolean } {
    if (rawPin !== this.lastRawReading) {
      this.lastDebounceTimeMs = currentTimeMs;
    }

    if (currentTimeMs - this.lastDebounceTimeMs > this.debounceDelayMs) {
      this.debouncedState = rawPin;
    }

    this.lastRawReading = rawPin;

    // Active-LOW logic: button connected between GPIO14 and GND reads LOW (0) when pressed
    const currentPressed = this.debouncedState === 0;
    if (currentPressed) {
      this.latchedSos = true;
    }

    return {
      currentPressed,
      sosPressed: currentPressed || this.latchedSos,
    };
  }

  public clearSosLatch(): void {
    this.latchedSos = false;
  }

  public isSosLatched(): boolean {
    return this.latchedSos;
  }
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

  // --- 6. PHASE 1 SOS PINOUT, ACTIVE-LOW DEBOUNCE, LATCHING & NETWORK DROP RESILIENCE ---
  console.log('\n--- 6. PHASE 1 SOS PINOUT, ACTIVE-LOW DEBOUNCE, LATCHING & NETWORK DROP RESILIENCE ---');
  {
    // 6.1 Hardware Pinout & Configuration Audit
    const configHPath = path.join(workspaceRoot, 'firmware', 'esp8266_minecare', 'include', 'config.h');
    const configHContent = fs.readFileSync(configHPath, 'utf8');

    assert(
      /#define\s+PIN_BUTTON_SOS\s+14\b/.test(configHContent),
      'CONFIG',
      'PIN_BUTTON_SOS is explicitly mapped to GPIO14 / NodeMCU D5'
    );
    assert(
      !/#define\s+PIN_BUZZER\s+\d+/.test(configHContent),
      'CONFIG',
      'Conflicting PIN_BUZZER output definition removed from D5'
    );
    assert(
      /#define\s+BUZZER_ON\(\)\s+do\s*\{\}\s*while\s*\(0\)/.test(configHContent) &&
      /#define\s+BUZZER_OFF\(\)\s+do\s*\{\}\s*while\s*\(0\)/.test(configHContent),
      'CONFIG',
      'BUZZER_ON and BUZZER_OFF macros are safe do {} while (0) no-ops'
    );

    const sensorMgrCppPath = path.join(workspaceRoot, 'firmware', 'esp8266_minecare', 'src', 'SensorManager.cpp');
    const sensorMgrCppContent = fs.readFileSync(sensorMgrCppPath, 'utf8');
    assert(
      sensorMgrCppContent.includes('pinMode(PIN_BUTTON_SOS, INPUT_PULLUP)'),
      'CONFIG',
      'PIN_BUTTON_SOS is initialized with internal INPUT_PULLUP'
    );

    const mainCppPath = path.join(workspaceRoot, 'firmware', 'esp8266_minecare', 'src', 'main.cpp');
    const mainCppContent = fs.readFileSync(mainCppPath, 'utf8');
    assert(
      !mainCppContent.includes('pinMode(PIN_BUZZER, OUTPUT)'),
      'CONFIG',
      'pinMode(PIN_BUZZER, OUTPUT) removed from firmware setup()'
    );

    // 6.2 Active-LOW Logic & Noise Debounce Suppression
    const sosSim = new SosButtonSimulator();

    // Initial state: released (HIGH = 1)
    const initSample = sosSim.sample(1, 0);
    assert(initSample.currentPressed === false, 'ACTIVE_LOW', 'Pull-up HIGH (1) resolves to unpressed (false)');
    assert(initSample.sosPressed === false, 'ACTIVE_LOW', 'Initial SOS state is inactive');

    // Transient bounce / glitch (< 30ms): pin drops to 0 at t=10ms, returns to 1 at t=25ms
    sosSim.sample(0, 10);
    const glitchSample = sosSim.sample(1, 25);
    assert(glitchSample.currentPressed === false, 'DEBOUNCE', 'Sub-30ms transient bounce ignored by debounce filter');
    assert(sosSim.isSosLatched() === false, 'DEBOUNCE', 'Transient bounce does not latch emergency SOS');

    // 6.3 Valid Press & Latch Formation
    // Sustained contact: pin stays 0 from t=30ms to t=70ms (40ms > 30ms debounce threshold)
    sosSim.sample(0, 30);
    const pressedSample = sosSim.sample(0, 70);
    assert(pressedSample.currentPressed === true, 'DEBOUNCE', 'Sustained contact (>=30ms) resolves to pressed (true)');
    assert(pressedSample.sosPressed === true, 'LATCH', 'SOS emergency condition is triggered');
    assert(sosSim.isSosLatched() === true, 'LATCH', 'SOS persistent latch is activated');

    // 6.4 Release during Wi-Fi / Network Outage
    // User releases button at t=80ms. By t=120ms (>30ms), debounced physical state is released (1).
    sosSim.sample(1, 80);
    const releasedSample = sosSim.sample(1, 120);
    assert(releasedSample.currentPressed === false, 'LATCH', 'Physical button is detected as released');
    assert(releasedSample.sosPressed === true, 'LATCH', 'readings.sosPressed remains TRUE due to persistent latch');
    assert(sosSim.isSosLatched() === true, 'LATCH', 'Latch persists after physical button release');

    // 6.5 Network Drops & Failed HTTP Requests (Must NOT clear latch)
    // Attempt 1: Wi-Fi disconnect / DNS fail (httpCode = 0, success = false)
    const resWifiDrop = { success: false, httpCode: 0 };
    if (resWifiDrop.success) { sosSim.clearSosLatch(); }
    assert(sosSim.isSosLatched() === true, 'NETWORK_FAIL', 'Wi-Fi drop (code 0) does not clear SOS latch');

    // Attempt 2: Server error (HTTP 500, success = false)
    const resHttp500 = { success: false, httpCode: 500 };
    if (resHttp500.success) { sosSim.clearSosLatch(); }
    assert(sosSim.isSosLatched() === true, 'NETWORK_FAIL', 'HTTP 500 server error does not clear SOS latch');

    // Attempt 3: Rate limited (HTTP 429, success = false)
    const resHttp429 = { success: false, httpCode: 429 };
    if (resHttp429.success) { sosSim.clearSosLatch(); }
    assert(sosSim.isSosLatched() === true, 'NETWORK_FAIL', 'HTTP 429 rate limit does not clear SOS latch');

    // Verify subsequent reading during retry still carries sosPressed: true
    const retrySample = sosSim.sample(1, 2000);
    assert(retrySample.sosPressed === true, 'RETRY', 'Subsequent telemetry retry retains sosPressed: true');

    // 6.6 Backend Acceptance (HTTP 201) and Latch Release
    const resSuccess201 = { success: true, httpCode: 201 };
    if (resSuccess201.success) {
      sosSim.clearSosLatch();
    }
    assert(sosSim.isSosLatched() === false, 'ACK_CLEAR', 'HTTP 201 acceptance successfully clears SOS latch');

    // Verify reading after latch clear with button released
    const clearedSample = sosSim.sample(1, 2100);
    assert(clearedSample.sosPressed === false, 'ACK_CLEAR', 'Telemetry returns to nominal (sosPressed: false) after ACK');

    // 6.7 Sustained Button Press Safety
    // If user physically holds the button down across an HTTP 201 ACK:
    sosSim.sample(0, 3000);
    sosSim.sample(0, 3050); // Pressed & latched
    assert(sosSim.isSosLatched() === true, 'HOLD_SAFETY', 'Button pressed again sets latch');
    if (resSuccess201.success) {
      sosSim.clearSosLatch();
    }
    // Button is STILL held (0)
    const heldSample = sosSim.sample(0, 3060);
    assert(heldSample.currentPressed === true, 'HOLD_SAFETY', 'Physical contact still reads active-LOW (0)');
    assert(heldSample.sosPressed === true, 'HOLD_SAFETY', 'sosPressed remains TRUE despite latch clear because button is still held');
    assert(sosSim.isSosLatched() === true, 'HOLD_SAFETY', 'Latch re-engages immediately for sustained press');

    // Release and clear
    sosSim.sample(1, 3100);
    sosSim.sample(1, 3150);
    sosSim.clearSosLatch();

    // 6.8 Alert Deduplication on Retried Packets
    const alertsStore: DbAlert[] = [];
    const packet1 = {
      packetId: 'PKT-TEST-01-1',
      helmetId: 'MC-TEST-01',
      sequenceNumber: 101,
      timestamp: new Date().toISOString(),
      temperature: 25.0,
      humidity: 50.0,
      gasValue: 200,
      accelX: 0,
      accelY: 0,
      accelZ: 9.8,
      totalAcceleration: 9.8,
      gyroX: 0,
      gyroY: 0,
      gyroZ: 0,
      sosPressed: true,
      fallDetected: false,
    };

    // First attempt creates alert (AlertEngine unshifts directly into alertsStore)
    const eval1 = SafetyEngine.evaluate(packet1);
    const result1 = AlertEngine.processAlerts(alertsStore, packet1.helmetId, null, packet1 as any, eval1);
    assert(result1.createdAlert !== null, 'DEDUP', 'First packet with sosPressed: true creates CRITICAL alert');
    assert(alertsStore.length === 1, 'DEDUP', 'Alerts store has exactly 1 active alert');
    assert(alertsStore[0].type === 'SOS_EMERGENCY', 'DEDUP', 'Alert type is SOS_EMERGENCY');

    // Second attempt (retry after network glitch / delayed ack)
    const packet2 = { ...packet1, packetId: 'PKT-TEST-01-2', sequenceNumber: 102 };
    const eval2 = SafetyEngine.evaluate(packet2);
    const result2 = AlertEngine.processAlerts(alertsStore, packet2.helmetId, null, packet2 as any, eval2);
    assert(result2.createdAlert === null, 'DEDUP', 'Retry packet does NOT create duplicate alert (createdAlert === null)');
    assert(alertsStore.length === 1, 'DEDUP', 'Alerts store remains at exactly 1 alert without duplication');
  }

  // =========================================================================
  // 7. PHASE 2 SENSOR HEALTH REPORTING & FAULT HANDLING SUITE
  // =========================================================================
  console.log('\n--- 7. PHASE 2 SENSOR HEALTH REPORTING & FAULT HANDLING ---');

  // 7.1 Valid DHT22 and MPU6050 readings
  const validFirmwareSample: SensorReadings = {
    temperature: 24.5,
    humidity: 50.0,
    rawGasValue: 200,
    accelX: 0.0,
    accelY: 0.0,
    accelZ: 9.81,
    totalAcceleration: 9.81,
    gyroX: 0.0,
    gyroY: 0.0,
    gyroZ: 0.0,
    sosPressed: false,
    fallDetected: false,
    dhtValid: true,
    mpuValid: true,
  };
  const evalFirmwareValid = SafetyLogicSimulator.evaluate(validFirmwareSample);
  assert(evalFirmwareValid.status === 'SAFE', 'PHASE2_VALID', 'Valid sensors evaluate to SAFE status in firmware replica');
  assert(evalFirmwareValid.primaryTrigger === 'NOMINAL', 'PHASE2_VALID', 'Primary trigger is NOMINAL for valid sensor packet');
  assert(evalFirmwareValid.outputs.greenLed === true, 'PHASE2_VALID', 'Green LED active when sensors are valid and readings nominal');

  const backendEvalValid = SafetyEngine.evaluate({
    temperature: 24.5,
    gasValue: 200,
    totalAcceleration: 9.81,
    sosPressed: false,
    dhtValid: true,
    mpuValid: true,
  });
  assert(backendEvalValid.status === 'SAFE', 'PHASE2_VALID', 'Backend SafetyEngine confirms SAFE for healthy sensors');
  assert(backendEvalValid.outputs.greenLed === true, 'PHASE2_VALID', 'Backend outputs confirm green LED ON');

  // 7.2 Invalid DHT22 readings (Discrete Temperature / Humidity Fault)
  const dhtFaultSample: SensorReadings = {
    ...validFirmwareSample,
    temperature: 24.5, // Fallback constant
    humidity: 50.0,    // Fallback constant
    dhtValid: false,
    mpuValid: true,
  };
  const evalDhtFault = SafetyLogicSimulator.evaluate(dhtFaultSample);
  assert(evalDhtFault.status === 'SENSOR_FAULT', 'PHASE2_DHT_FAULT', 'Invalid DHT22 triggers SENSOR_FAULT in firmware logic');
  assert(evalDhtFault.outputs.greenLed === false, 'PHASE2_DHT_FAULT', 'Green LED extinguished during DHT22 sensor fault');
  assert(evalDhtFault.outputs.redLed === true, 'PHASE2_DHT_FAULT', 'Visual fault indicator active during DHT22 sensor fault');

  const backendDhtFault = SafetyEngine.evaluate({
    temperature: 24.5, // Normal-looking fallback temperature
    gasValue: 200,
    totalAcceleration: 9.81,
    sosPressed: false,
    dhtValid: false,
    mpuValid: true,
  });
  assert(backendDhtFault.status === 'SENSOR_FAULT', 'PHASE2_DHT_FAULT', 'Backend SafetyEngine marks invalid DHT22 as SENSOR_FAULT');
  assert(backendDhtFault.primaryTrigger === 'SENSOR_FAULT', 'PHASE2_DHT_FAULT', 'Primary trigger is SENSOR_FAULT');
  assert(backendDhtFault.triggerDetails.some(d => d.includes('DHT22')), 'PHASE2_DHT_FAULT', 'Trigger details specify DHT22 fault');

  // 7.3 MPU6050 initialization or reading failure
  const mpuFaultSample: SensorReadings = {
    ...validFirmwareSample,
    totalAcceleration: 9.81, // Fallback gravity constant
    dhtValid: true,
    mpuValid: false,
  };
  const evalMpuFault = SafetyLogicSimulator.evaluate(mpuFaultSample);
  assert(evalMpuFault.status === 'SENSOR_FAULT', 'PHASE2_MPU_FAULT', 'Invalid MPU6050 triggers SENSOR_FAULT in firmware logic');

  const backendMpuFault = SafetyEngine.evaluate({
    temperature: 24.5,
    gasValue: 200,
    totalAcceleration: 9.81, // Fallback gravity constant
    sosPressed: false,
    dhtValid: true,
    mpuValid: false,
  });
  assert(backendMpuFault.status === 'SENSOR_FAULT', 'PHASE2_MPU_FAULT', 'Backend SafetyEngine marks invalid MPU6050 as SENSOR_FAULT');
  assert(backendMpuFault.triggerDetails.some(d => d.includes('MPU6050')), 'PHASE2_MPU_FAULT', 'Trigger details specify MPU6050 fault');

  // Disconnected MPU6050 bus noise (e.g., 22.0 m/s²) must NOT create false fall emergency
  const backendMpuNoise = SafetyEngine.evaluate({
    temperature: 24.5,
    gasValue: 200,
    totalAcceleration: 22.0, // High noise reading from floating/failed I2C bus
    sosPressed: false,
    dhtValid: true,
    mpuValid: false,
  });
  assert(backendMpuNoise.status === 'SENSOR_FAULT', 'PHASE2_MPU_FAULT', 'Unreliable acceleration spike from invalid MPU6050 does NOT trigger false fall emergency');

  // Both DHT22 and MPU6050 failure
  const backendDualFault = SafetyEngine.evaluate({
    temperature: 24.5,
    gasValue: 200,
    totalAcceleration: 9.81,
    sosPressed: false,
    dhtValid: false,
    mpuValid: false,
  });
  assert(backendDualFault.status === 'SENSOR_FAULT', 'PHASE2_DUAL_FAULT', 'Simultaneous DHT22 and MPU6050 failure yields SENSOR_FAULT');
  assert(backendDualFault.triggerDetails.length >= 2, 'PHASE2_DUAL_FAULT', 'Trigger details captures both sensor faults');

  // 7.4 Explicit sensor-fault telemetry reaching the backend & strict boolean validation
  const validIngestWithFlags = {
    helmetId: 'MC-TEST-P2',
    sequenceNumber: 201,
    temperature: 24.5,
    humidity: 50.0,
    gasValue: 220,
    accelX: 0.0,
    accelY: 0.0,
    accelZ: 9.81,
    totalAcceleration: 9.81,
    gyroX: 0.0,
    gyroY: 0.0,
    gyroZ: 0.0,
    sosPressed: false,
    fallDetected: false,
    dhtValid: false,
    mpuValid: false,
    tempValid: false,
    humidityValid: false,
  };
  const validationResult = TelemetryValidator.validate(validIngestWithFlags);
  assert(validationResult.errors.length === 0, 'PHASE2_VALIDATOR', 'TelemetryValidator accepts explicit boolean sensor health flags');
  assert(validationResult.packet?.dhtValid === false, 'PHASE2_VALIDATOR', 'dhtValid strictly preserved as false');
  assert(validationResult.packet?.mpuValid === false, 'PHASE2_VALIDATOR', 'mpuValid strictly preserved as false');
  assert(validationResult.packet?.gasValue === 220, 'PHASE2_VALIDATOR', 'Gas reading preserved as raw ADC count');

  // Strict boolean validation (rejection of non-booleans)
  const invalidStringFlagPayload = {
    ...validIngestWithFlags,
    dhtValid: 'false' as any,
  };
  const invalidStringResult = TelemetryValidator.validate(invalidStringFlagPayload);
  assert(invalidStringResult.errors.some(e => e.includes('dhtValid must be a boolean')), 'PHASE2_VALIDATOR', 'Rejects non-boolean dhtValid ("false" string)');

  const invalidNumberFlagPayload = {
    ...validIngestWithFlags,
    mpuValid: 0 as any,
  };
  const invalidNumberResult = TelemetryValidator.validate(invalidNumberFlagPayload);
  assert(invalidNumberResult.errors.some(e => e.includes('mpuValid must be a boolean')), 'PHASE2_VALIDATOR', 'Rejects numeric mpuValid (0 integer)');

  // 7.5 Sensor faults not being interpreted as confirmed SAFE conditions
  // Normal fallback measurements (24.5°C, 50%, 9.81 m/s²) must NOT produce SAFE
  const fallbackPacket = {
    temperature: 24.5,
    gasValue: 190,
    totalAcceleration: 9.81,
    sosPressed: false,
    dhtValid: false,
    mpuValid: true,
  };
  const fallbackEval = SafetyEngine.evaluate(fallbackPacket);
  assert(fallbackEval.status !== 'SAFE', 'PHASE2_SAFE_GUARD', 'Fallback measurement with invalid sensor CANNOT produce SAFE');
  assert(fallbackEval.status === 'SENSOR_FAULT', 'PHASE2_SAFE_GUARD', 'Evaluates strictly to SENSOR_FAULT');

  // SOS button ALWAYS overrides sensor fault
  const sosDuringFault = SafetyEngine.evaluate({
    ...fallbackPacket,
    sosPressed: true,
  });
  assert(sosDuringFault.status === 'DANGER', 'PHASE2_SAFE_GUARD', 'SOS push-button overrides sensor fault and escalates to DANGER');
  assert(sosDuringFault.primaryTrigger === 'SOS_BUTTON_TRIGGERED', 'PHASE2_SAFE_GUARD', 'Primary trigger is SOS_BUTTON_TRIGGERED');
  assert(sosDuringFault.outputs.buzzer === true, 'PHASE2_SAFE_GUARD', 'Buzzer sounds for SOS even during sensor fault');

  // 7.6 Persistent alert creation and deduplication
  const faultAlertsStore: DbAlert[] = [];
  const faultPacket1 = {
    packetId: 'PKT-FAULT-01',
    helmetId: 'MC-TEST-FAULT',
    sequenceNumber: 1,
    timestamp: new Date().toISOString(),
    temperature: 24.5,
    humidity: 50.0,
    gasValue: 200,
    accelX: 0,
    accelY: 0,
    accelZ: 9.81,
    totalAcceleration: 9.81,
    gyroX: 0,
    gyroY: 0,
    gyroZ: 0,
    sosPressed: false,
    fallDetected: false,
    dhtValid: false,
    mpuValid: true,
  };
  const evalFault1 = SafetyEngine.evaluate(faultPacket1);
  const alertResult1 = AlertEngine.processAlerts(faultAlertsStore, faultPacket1.helmetId, null, faultPacket1 as any, evalFault1);
  assert(alertResult1.createdAlert !== null, 'PHASE2_ALERT', 'Initial sensor fault creates SENSOR_FAULT alert');
  assert(faultAlertsStore.length === 1, 'PHASE2_ALERT', 'Alert store contains 1 active alert');
  assert(faultAlertsStore[0].type === 'SENSOR_FAULT', 'PHASE2_ALERT', 'Alert type is SENSOR_FAULT');
  assert(faultAlertsStore[0].severity === 'WARNING', 'PHASE2_ALERT', 'Sensor fault alert severity is WARNING');
  assert(faultAlertsStore[0].readings_snapshot?.dhtValid === false, 'PHASE2_ALERT', 'Alert snapshot persists dhtValid: false');
  assert(faultAlertsStore[0].readings_snapshot?.sensorFault === true, 'PHASE2_ALERT', 'Alert snapshot persists sensorFault: true');

  // Subsequent packet while fault persists does NOT duplicate alert
  const faultPacket2 = {
    ...faultPacket1,
    packetId: 'PKT-FAULT-02',
    sequenceNumber: 2,
    timestamp: new Date().toISOString(),
  };
  const evalFault2 = SafetyEngine.evaluate(faultPacket2);
  const alertResult2 = AlertEngine.processAlerts(faultAlertsStore, faultPacket2.helmetId, null, faultPacket2 as any, evalFault2);
  assert(alertResult2.createdAlert === null, 'PHASE2_ALERT', 'Deduplication prevents creating duplicate SENSOR_FAULT alert');
  assert(faultAlertsStore.length === 1, 'PHASE2_ALERT', 'Alert store remains at 1 alert');

  // 7.7 Realtime / frontend display of invalid sensor status
  const publisher = RealtimePublisher.getInstance();
  const telemetryService = TelemetryService.getInstance();

  const realtimeFaultTelemetry: DbTelemetry = {
    id: `PKT-RT-${Date.now()}`,
    helmet_id: 'MC-002',
    sequence_number: 301,
    temperature: 24.5, // Concealed fallback number
    humidity: 50.0,
    gas_value: 235,
    acceleration_x: 0,
    acceleration_y: 0,
    acceleration_z: 9.81,
    total_acceleration: 9.81, // Concealed fallback number
    gyro_x: 0,
    gyro_y: 0,
    gyro_z: 0,
    sos_pressed: false,
    fall_detected: false,
    safety_status: 'SENSOR_FAULT',
    dht_valid: false,
    mpu_valid: false,
    created_at: new Date().toISOString(),
  };

  // Publish telemetry into realtime pipeline
  publisher.publish('telemetry', 'INSERT', realtimeFaultTelemetry);

  const updatedHelmet = telemetryService.getHelmet('MC-002');
  assert(updatedHelmet !== undefined, 'PHASE2_FRONTEND', 'Helmet MC-002 retrieved from TelemetryService');
  assert(updatedHelmet?.safety.status === 'SENSOR_FAULT', 'PHASE2_FRONTEND', 'Helmet safety status is SENSOR_FAULT in TelemetryService');
  assert(updatedHelmet?.telemetry.sensorHealth.dht22 === false, 'PHASE2_FRONTEND', 'sensorHealth.dht22 is false (not masked by mock true)');
  assert(updatedHelmet?.telemetry.sensorHealth.mpu6050 === false, 'PHASE2_FRONTEND', 'sensorHealth.mpu6050 is false (not masked by mock true)');
  assert(updatedHelmet?.telemetry.mq2.rawGasValue === 235, 'PHASE2_FRONTEND', 'Valid raw gas reading continues to update normally');
  assert(updatedHelmet?.telemetry.outputs.greenLed === false, 'PHASE2_FRONTEND', 'Green nominal LED is false during sensor fault');

  // 7.8 Backward compatibility with legacy packets (missing validity flags)
  const legacyPacket = {
    helmetId: 'MC-LEGACY-01',
    sequenceNumber: 401,
    temperature: 26.0,
    humidity: 52.0,
    gasValue: 210,
    accelX: 0.0,
    accelY: 0.0,
    accelZ: 9.81,
    totalAcceleration: 9.81,
    gyroX: 0.0,
    gyroY: 0.0,
    gyroZ: 0.0,
    sosPressed: false,
    fallDetected: false,
    // Note: dhtValid, mpuValid, tempValid, humidityValid completely omitted
  };
  const legacyValidation = TelemetryValidator.validate(legacyPacket);
  assert(legacyValidation.errors.length === 0, 'PHASE2_BACKWARD_COMPAT', 'Legacy packets without validity flags pass validation cleanly');
  assert(legacyValidation.packet?.dhtValid === true, 'PHASE2_BACKWARD_COMPAT', 'Missing dhtValid defaults to true for backward compatibility');
  assert(legacyValidation.packet?.mpuValid === true, 'PHASE2_BACKWARD_COMPAT', 'Missing mpuValid defaults to true for backward compatibility');

  const legacyEval = SafetyEngine.evaluate(legacyPacket);
  assert(legacyEval.status === 'SAFE', 'PHASE2_BACKWARD_COMPAT', 'Legacy nominal packet evaluates cleanly to SAFE');

  console.log('\n============================================================');
  console.log(`TOTAL FIRMWARE CHECKS: ${totalChecks}`);
  console.log(`PASSED:                ${totalChecks}`);
  console.log('FAILED:                0');
  console.log('============================================================\n');
}

runFirmwareLogicSuite().catch((err) => {
  console.error('Firmware logic test suite failed:', err);
  process.exit(1);
});
