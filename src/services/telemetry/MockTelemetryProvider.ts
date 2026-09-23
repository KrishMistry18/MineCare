/**
 * MineCare - Mock Telemetry Provider
 * 
 * Drives 16 simulated helmets streaming telemetry every 2 seconds.
 * Matching Lovable reference behavior exactly.
 */

import type { ITelemetryProvider, TelemetryCallback, Unsubscribe } from './ITelemetryProvider';
import type { HelmetTelemetryPacket, ScenarioType } from '../../types/telemetry';
import { SafetyEvaluator } from './SafetyEvaluator';
import { INITIAL_WORKERS } from '../../data/mockData';

interface HelmetSimState {
  helmetId: string;
  temperature: number;
  humidity: number;
  rawGas: number;
  accelX: number;
  accelY: number;
  accelZ: number;
  gyroX: number;
  gyroY: number;
  gyroZ: number;
  sosPressed: boolean;
  fallDetected: boolean;
  dht22Healthy: boolean;
  mq2Healthy: boolean;
  mpu6050Healthy: boolean;
  isHelmetOffline: boolean;
  currentScenario: ScenarioType;
  sequence: number;
  battery: number;
  rssi: number;
  scenarioStep: number;
}

export class MockTelemetryProvider implements ITelemetryProvider {
  public readonly providerId = 'MOCK_TELEMETRY_ENGINE_V1';
  public readonly isSimulation = true;

  private activeHelmets: Map<string, HelmetSimState> = new Map();
  private subscribers: Set<TelemetryCallback> = new Set();
  private helmetSubscribers: Map<string, Set<TelemetryCallback>> = new Map();
  private intervalTimer: ReturnType<typeof setInterval> | null = null;
  private intervalMs: number = 2000;

  constructor() {
    this.initializeFleet();
  }

  private initializeFleet(): void {
    // 16 Baselines matching Lovable reference screenshots
    const baselines: Record<string, { temp: number; hum: number; gas: number; accel: number; batt: number }> = {
      'MC-001': { temp: 24.3, hum: 57, gas: 193, accel: 10.0, batt: 68 },
      'MC-002': { temp: 27.8, hum: 53, gas: 227, accel: 9.6, batt: 69 },
      'MC-003': { temp: 29.1, hum: 57, gas: 207, accel: 9.7, batt: 70 },
      'MC-004': { temp: 28.1, hum: 62, gas: 221, accel: 10.2, batt: 71 },
      'MC-005': { temp: 31.8, hum: 58, gas: 274, accel: 9.7, batt: 71 },
      'MC-006': { temp: 30.9, hum: 61, gas: 251, accel: 10.3, batt: 72 },
      'MC-007': { temp: 24.2, hum: 62, gas: 188, accel: 9.9, batt: 67 },
      'MC-008': { temp: 27.8, hum: 59, gas: 232, accel: 10.1, batt: 68 },
      'MC-009': { temp: 28.6, hum: 64, gas: 219, accel: 9.8, batt: 69 },
      'MC-010': { temp: 26.5, hum: 56, gas: 202, accel: 10.0, batt: 70 },
      'MC-011': { temp: 30.2, hum: 60, gas: 245, accel: 9.7, batt: 71 },
      'MC-012': { temp: 29.4, hum: 58, gas: 238, accel: 10.2, batt: 72 },
      'MC-013': { temp: 25.1, hum: 61, gas: 195, accel: 9.9, batt: 66 },
      'MC-014': { temp: 27.3, hum: 54, gas: 218, accel: 9.8, batt: 67 },
      'MC-015': { temp: 28.9, hum: 63, gas: 225, accel: 10.1, batt: 68 },
      'MC-016': { temp: 26.8, hum: 59, gas: 210, accel: 9.9, batt: 69 },
    };

    INITIAL_WORKERS.forEach((w) => {
      const b = baselines[w.assignedHelmetId] || { temp: 26.0, hum: 58, gas: 210, accel: 9.8, batt: 70 };
      this.activeHelmets.set(w.assignedHelmetId, {
        helmetId: w.assignedHelmetId,
        temperature: b.temp,
        humidity: b.hum,
        rawGas: b.gas,
        accelX: 0.1,
        accelY: 0.2,
        accelZ: b.accel,
        gyroX: 0.5,
        gyroY: -0.3,
        gyroZ: 0.2,
        sosPressed: false,
        fallDetected: false,
        dht22Healthy: true,
        mq2Healthy: true,
        mpu6050Healthy: true,
        isHelmetOffline: false,
        currentScenario: 'SAFE',
        sequence: 1,
        battery: b.batt,
        rssi: -65,
        scenarioStep: 0,
      });
    });
  }

  public async connect(): Promise<void> {
    if (this.intervalTimer) return;
    this.intervalTimer = setInterval(() => this.tick(), this.intervalMs);
  }

  public async disconnect(): Promise<void> {
    if (this.intervalTimer) {
      clearInterval(this.intervalTimer);
      this.intervalTimer = null;
    }
  }

  public subscribeAll(callback: TelemetryCallback): Unsubscribe {
    this.subscribers.add(callback);
    return () => {
      this.subscribers.delete(callback);
    };
  }

  public subscribeHelmet(helmetId: string, callback: TelemetryCallback): Unsubscribe {
    if (!this.helmetSubscribers.has(helmetId)) {
      this.helmetSubscribers.set(helmetId, new Set());
    }
    const helmetSet = this.helmetSubscribers.get(helmetId)!;
    helmetSet.add(callback);

    return () => {
      helmetSet.delete(callback);
    };
  }

  public getRegisteredHelmetIds(): string[] {
    return Array.from(this.activeHelmets.keys());
  }

  public setSamplingRateMs(intervalMs: number): void {
    this.intervalMs = Math.max(500, intervalMs);
    if (this.intervalTimer) {
      clearInterval(this.intervalTimer);
      this.intervalTimer = setInterval(() => this.tick(), this.intervalMs);
    }
  }

  public triggerScenario(scenario: ScenarioType, helmetId?: string): void {
    const targetIds = helmetId ? [helmetId] : ['MC-001'];

    targetIds.forEach(id => {
      const state = this.activeHelmets.get(id);
      if (!state) return;

      state.currentScenario = scenario;
      state.scenarioStep = 0;

      switch (scenario) {
        case 'SAFE':
        case 'RECOVERY':
          state.sosPressed = false;
          state.fallDetected = false;
          state.isHelmetOffline = false;
          state.dht22Healthy = true;
          state.mq2Healthy = true;
          state.mpu6050Healthy = true;
          state.temperature = 25.5 + (Math.random() * 2 - 1);
          state.humidity = 58 + (Math.random() * 4 - 2);
          state.rawGas = 205 + Math.floor(Math.random() * 25);
          state.accelX = 0.1;
          state.accelY = 0.2;
          state.accelZ = 9.81;
          break;

        case 'HIGH_TEMPERATURE':
          state.temperature = 43.2; // Exceeds 40°C prototype threshold
          break;

        case 'HIGH_GAS':
          state.rawGas = 875; // Exceeds 800 raw ADC threshold
          break;

        case 'FALL_DETECTED':
          state.accelX = 8.5;
          state.accelY = 9.2;
          state.accelZ = 12.8;
          state.fallDetected = true;
          break;

        case 'SOS_ACTIVATED':
          state.sosPressed = true;
          break;

        case 'MULTIPLE_ALERTS':
          state.rawGas = 915;
          state.sosPressed = true;
          state.temperature = 42.1;
          break;

        case 'SENSOR_OFFLINE':
          state.dht22Healthy = false;
          state.mpu6050Healthy = false;
          break;

        case 'HELMET_OFFLINE':
          state.isHelmetOffline = true;
          break;
      }
    });
  }

  private tick(): void {
    const nowIso = new Date().toISOString();

    this.activeHelmets.forEach((state) => {
      if (state.isHelmetOffline) {
        return;
      }

      state.sequence++;
      state.scenarioStep++;

      // Subtle stochastic walk for realistic mining shaft telemetry
      if (state.currentScenario === 'SAFE') {
        state.temperature += (Math.random() - 0.5) * 0.1;
        state.temperature = Math.max(22, Math.min(34, state.temperature));

        state.humidity += (Math.random() - 0.5) * 0.2;
        state.humidity = Math.max(45, Math.min(75, state.humidity));

        state.rawGas += Math.floor((Math.random() - 0.5) * 4);
        state.rawGas = Math.max(160, Math.min(320, state.rawGas));

        state.accelX = (Math.random() - 0.5) * 0.3;
        state.accelY = (Math.random() - 0.5) * 0.3;
        state.accelZ = 9.81 + (Math.random() - 0.5) * 0.5;
      } else if (state.currentScenario === 'FALL_DETECTED') {
        if (state.scenarioStep <= 2) {
          state.accelX = 9.5;
          state.accelY = 8.4;
          state.accelZ = 13.6;
        } else {
          state.accelX = 9.75;
          state.accelY = 0.8;
          state.accelZ = 0.4;
        }
      } else if (state.currentScenario === 'HIGH_GAS') {
        state.rawGas = 850 + Math.floor(Math.random() * 60);
      } else if (state.currentScenario === 'HIGH_TEMPERATURE') {
        state.temperature = 42.0 + (Math.random() * 1.5);
      }

      const totalAccel = Math.sqrt(
        state.accelX * state.accelX +
        state.accelY * state.accelY +
        state.accelZ * state.accelZ
      );

      const isFall = totalAccel > 15.0;

      const safetyEval = SafetyEvaluator.evaluate({
        dht22: {
          temperature: state.dht22Healthy ? Number(state.temperature.toFixed(1)) : -999,
          humidity: state.dht22Healthy ? Number(state.humidity.toFixed(1)) : -999,
        },
        mq2: {
          rawGasValue: state.mq2Healthy ? state.rawGas : 0,
        },
        mpu6050: {
          accelX: Number(state.accelX.toFixed(2)),
          accelY: Number(state.accelY.toFixed(2)),
          accelZ: Number(state.accelZ.toFixed(2)),
          totalAcceleration: Number(totalAccel.toFixed(1)),
          gyroX: Number(state.gyroX.toFixed(2)),
          gyroY: Number(state.gyroY.toFixed(2)),
          gyroZ: Number(state.gyroZ.toFixed(2)),
        },
        sosPressed: state.sosPressed,
      });

      const packet: HelmetTelemetryPacket = {
        packetId: `PKT-${state.helmetId}-${Date.now().toString().slice(-6)}`,
        helmetId: state.helmetId,
        timestamp: nowIso,
        sequenceNumber: state.sequence,
        dht22: {
          temperature: state.dht22Healthy ? Number(state.temperature.toFixed(1)) : -999,
          humidity: state.dht22Healthy ? Number(state.humidity.toFixed(1)) : -999,
        },
        mq2: {
          rawGasValue: state.mq2Healthy ? state.rawGas : 0,
        },
        mpu6050: {
          accelX: Number(state.accelX.toFixed(2)),
          accelY: Number(state.accelY.toFixed(2)),
          accelZ: Number(state.accelZ.toFixed(2)),
          totalAcceleration: Number(totalAccel.toFixed(1)),
          gyroX: Number(state.gyroX.toFixed(2)),
          gyroY: Number(state.gyroY.toFixed(2)),
          gyroZ: Number(state.gyroZ.toFixed(2)),
        },
        sosPressed: state.sosPressed,
        fallDetected: isFall,
        sensorHealth: {
          dht22: state.dht22Healthy,
          mq2: state.mq2Healthy,
          mpu6050: state.mpu6050Healthy,
        },
        outputs: safetyEval.outputs,
        rssi: state.rssi,
        batteryVolts: Number(state.battery),
      };

      this.subscribers.forEach(cb => {
        try { cb(packet); } catch (e) { console.error('Error in telemetry subscriber', e); }
      });

      const specificSubs = this.helmetSubscribers.get(state.helmetId);
      if (specificSubs) {
        specificSubs.forEach(cb => {
          try { cb(packet); } catch (e) { console.error('Error in helmet subscriber', e); }
        });
      }
    });
  }
}
