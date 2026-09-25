/**
 * MineCare - Mock Telemetry Provider
 * 
 * Drives 16 simulated helmets streaming telemetry every 2 seconds.
 * Implements deterministic & stateful multi-step scenarios:
 * 1. NORMAL: 24–32°C, 50–70% hum, 150–350 raw gas, ~9–11 m/s² accel, status SAFE
 * 2. HIGH TEMPERATURE: 32 -> 35 -> 38 -> 41 -> 43 (°C) -> Warning > 40°C
 * 3. HIGH GAS: 300 -> 450 -> 620 -> 790 -> 850 -> 910 (raw) -> Warning > 800
 * 4. FALL: 9.8 -> 10.1 -> 22.4 -> 18.1 -> 9.7 (m/s²) -> Danger > 15.0 m/s²
 * 5. SOS: sosPressed = true -> Danger
 * 6. MULTIPLE ALERTS: compound gas > 800, temp > 40°C, SOS = true -> Danger
 * 7. RECOVERY: Gas 910->650->400->250, Temp 43->38->31 -> returns SAFE
 * 8. OFFLINE: Stops sending packets -> backend detects STALE then OFFLINE
 */

import type { ITelemetryProvider, TelemetryCallback, Unsubscribe } from './ITelemetryProvider';
import type { HelmetTelemetryPacket, ScenarioType } from '../../types/telemetry';
import { SafetyEvaluator } from './SafetyEvaluator';
import { INITIAL_WORKERS } from '../../data/mockData';
import { telemetryApiService } from '../api/telemetryService';
import { DatabaseRepository } from '../../backend/db/DatabaseRepository';
import { SafetyEngine } from '../../backend/safety/SafetyEngine';
import { AlertEngine } from '../../backend/alerts/AlertEngine';
import { RealtimePublisher } from '../../backend/realtime/RealtimePublisher';

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
    const baselines: Record<string, { temp: number; hum: number; gas: number; accel: number; batt: number }> = {
      'MC-001': { temp: 25.5, hum: 57, gas: 210, accel: 9.8, batt: 68 },
      'MC-002': { temp: 27.8, hum: 53, gas: 227, accel: 9.6, batt: 69 },
      'MC-003': { temp: 29.1, hum: 57, gas: 207, accel: 9.7, batt: 70 },
      'MC-004': { temp: 28.1, hum: 62, gas: 221, accel: 10.2, batt: 71 },
      'MC-005': { temp: 31.2, hum: 58, gas: 274, accel: 9.7, batt: 71 },
      'MC-006': { temp: 30.5, hum: 61, gas: 251, accel: 10.3, batt: 72 },
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
          state.sosPressed = false;
          state.fallDetected = false;
          state.isHelmetOffline = false;
          state.dht22Healthy = true;
          state.mq2Healthy = true;
          state.mpu6050Healthy = true;
          state.temperature = 26.5;
          state.humidity = 58;
          state.rawGas = 220;
          state.accelX = 0.1;
          state.accelY = 0.2;
          state.accelZ = 9.81;
          break;

        case 'HIGH_TEMPERATURE':
          state.isHelmetOffline = false;
          state.temperature = 32.0; // Starts ramp: 32 -> 35 -> 38 -> 41 -> 43
          state.sosPressed = false;
          state.fallDetected = false;
          break;

        case 'HIGH_GAS':
          state.isHelmetOffline = false;
          state.rawGas = 300; // Starts ramp: 300 -> 450 -> 620 -> 790 -> 850 -> 910
          state.sosPressed = false;
          state.fallDetected = false;
          break;

        case 'FALL_DETECTED':
          state.isHelmetOffline = false;
          state.sosPressed = false;
          // Step 0 of fall spike: 9.8 -> 10.1 -> 22.4 -> 18.1 -> 9.7
          state.accelX = 0.1;
          state.accelY = 0.2;
          state.accelZ = 9.8;
          state.fallDetected = false;
          break;

        case 'SOS_ACTIVATED':
          state.isHelmetOffline = false;
          state.sosPressed = true;
          break;

        case 'MULTIPLE_ALERTS':
          state.isHelmetOffline = false;
          state.rawGas = 915; // > 800
          state.temperature = 42.5; // > 40°C
          state.sosPressed = true; // SOS
          state.accelZ = 9.81;
          break;

        case 'RECOVERY':
          state.isHelmetOffline = false;
          state.sosPressed = false;
          state.fallDetected = false;
          // Begins recovery descent: Gas 910 -> 650 -> 400 -> 250, Temp 43 -> 38 -> 31
          state.rawGas = 910;
          state.temperature = 43.0;
          break;

        case 'HELMET_OFFLINE':
          state.isHelmetOffline = true;
          break;

        case 'SENSOR_OFFLINE':
          state.dht22Healthy = false;
          state.mpu6050Healthy = false;
          break;
      }
    });
  }

  public tick(): void {
    const nowIso = new Date().toISOString();

    this.activeHelmets.forEach((state) => {
      // If offline scenario is triggered for this helmet, halt transmission
      if (state.isHelmetOffline) {
        return;
      }

      state.sequence++;
      const step = state.scenarioStep;
      state.scenarioStep++;

      // --- Stateful Multi-Step Scenario Progression ---

      if (state.currentScenario === 'SAFE') {
        // 1. NORMAL: 24–32°C, 50–70% hum, 150–350 raw gas, ~9–11 m/s² accel, status SAFE
        state.temperature += (Math.random() - 0.5) * 0.1;
        state.temperature = Math.max(24.0, Math.min(32.0, Number(state.temperature.toFixed(1))));

        state.humidity += (Math.random() - 0.5) * 0.2;
        state.humidity = Math.max(50.0, Math.min(70.0, Number(state.humidity.toFixed(1))));

        state.rawGas += Math.floor((Math.random() - 0.5) * 4);
        state.rawGas = Math.max(150, Math.min(350, state.rawGas));

        state.accelX = (Math.random() - 0.5) * 0.2;
        state.accelY = (Math.random() - 0.5) * 0.2;
        state.accelZ = 9.81 + (Math.random() - 0.5) * 0.3;
        state.fallDetected = false;
        state.sosPressed = false;

      } else if (state.currentScenario === 'HIGH_TEMPERATURE') {
        // 2. HIGH TEMPERATURE: 32 → 35 → 38 → 41 → 43 -> Warning once > 40°C
        const tempRamp = [32.0, 35.0, 38.0, 41.0, 43.0];
        if (step < tempRamp.length) {
          state.temperature = tempRamp[step];
        } else {
          state.temperature = 43.2 + (Math.random() * 0.4 - 0.2);
        }
        state.temperature = Number(state.temperature.toFixed(1));

      } else if (state.currentScenario === 'HIGH_GAS') {
        // 3. HIGH GAS: 300 → 450 → 620 → 790 → 850 → 910 -> Warning once > 800
        const gasRamp = [300, 450, 620, 790, 850, 910, 920, 930, 915];
        if (step < gasRamp.length) {
          state.rawGas = gasRamp[step];
        } else {
          state.rawGas = 915 + Math.floor(Math.random() * 15);
        }

      } else if (state.currentScenario === 'FALL_DETECTED') {
        // 4. FALL: 9.8 → 10.1 → 22.4 → 18.1 → 9.7 -> Danger once > 15.0 m/s²
        if (step === 0) {
          state.accelX = 0.1;
          state.accelY = 0.2;
          state.accelZ = 9.8;
          state.fallDetected = false;
        } else if (step === 1) {
          state.accelX = 1.2;
          state.accelY = 0.5;
          state.accelZ = 10.0;
          state.fallDetected = false;
        } else if (step === 2) {
          // Impact spike (total = 22.4 m/s²)
          state.accelX = 11.2;
          state.accelY = 10.4;
          state.accelZ = 16.2;
          state.fallDetected = true;
        } else if (step === 3) {
          // Settling (total = 18.1 m/s²)
          state.accelX = 9.0;
          state.accelY = 8.5;
          state.accelZ = 12.8;
          state.fallDetected = false;
        } else {
          // Settled on ground (total = 9.7 m/s²)
          state.accelX = 0.2;
          state.accelY = 0.2;
          state.accelZ = 9.7;
          state.fallDetected = false;
        }

      } else if (state.currentScenario === 'SOS_ACTIVATED') {
        // 5. SOS: sosPressed = true
        state.sosPressed = true;
        state.accelZ = 9.81;

      } else if (state.currentScenario === 'MULTIPLE_ALERTS') {
        // 6. MULTIPLE ALERTS: gas > 800 AND temp > 40°C AND SOS = true
        state.rawGas = 915;
        state.temperature = 42.5;
        state.sosPressed = true;
        state.accelZ = 9.81;

      } else if (state.currentScenario === 'RECOVERY') {
        // 7. RECOVERY: Gas 910 → 650 → 400 → 250, Temp 43 → 38 → 31
        const gasRecovery = [910, 650, 400, 250];
        const tempRecovery = [43.0, 38.0, 31.0, 26.5];

        if (step < gasRecovery.length) {
          state.rawGas = gasRecovery[step];
          state.temperature = tempRecovery[step];
        } else {
          state.rawGas = 220;
          state.temperature = 26.5;
          state.currentScenario = 'SAFE';
        }
        state.sosPressed = false;
        state.fallDetected = false;
      }

      const totalAccel = Math.sqrt(
        state.accelX * state.accelX +
        state.accelY * state.accelY +
        state.accelZ * state.accelZ
      );

      const isFall = totalAccel > 15.0 || state.fallDetected;

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

      // Ingest through authoritative Telemetry API (/api/v1/telemetry)
      telemetryApiService
        .sendTelemetry({
          packetId: packet.packetId,
          helmetId: packet.helmetId,
          timestamp: packet.timestamp,
          sequenceNumber: packet.sequenceNumber,
          temperature: packet.dht22.temperature,
          humidity: packet.dht22.humidity,
          gasValue: packet.mq2.rawGasValue,
          accelX: packet.mpu6050.accelX,
          accelY: packet.mpu6050.accelY,
          accelZ: packet.mpu6050.accelZ,
          totalAcceleration: packet.mpu6050.totalAcceleration,
          gyroX: packet.mpu6050.gyroX,
          gyroY: packet.mpu6050.gyroY,
          gyroZ: packet.mpu6050.gyroZ,
          fallDetected: packet.fallDetected,
          sosPressed: packet.sosPressed,
          batteryVolts: packet.batteryVolts,
          rssi: packet.rssi,
        })
        .catch(() => {
          // Graceful fallback for offline / test environments
          try {
            const db = DatabaseRepository.getInstance();
            const safety = SafetyEngine.evaluate({
              temperature: packet.dht22.temperature,
              gasValue: packet.mq2.rawGasValue,
              totalAcceleration: packet.mpu6050.totalAcceleration,
              sosPressed: packet.sosPressed,
            });

            const telemetryRecord = {
              id: packet.packetId,
              helmet_id: packet.helmetId,
              timestamp: packet.timestamp,
              sequence_number: packet.sequenceNumber,
              temperature: packet.dht22.temperature,
              humidity: packet.dht22.humidity,
              gas_value: packet.mq2.rawGasValue,
              acceleration_x: packet.mpu6050.accelX,
              acceleration_y: packet.mpu6050.accelY,
              acceleration_z: packet.mpu6050.accelZ,
              total_acceleration: packet.mpu6050.totalAcceleration,
              gyro_x: packet.mpu6050.gyroX,
              gyro_y: packet.mpu6050.gyroY,
              gyro_z: packet.mpu6050.gyroZ,
              fall_detected: packet.fallDetected,
              sos_pressed: packet.sosPressed,
              safety_status: safety.status,
              created_at: new Date().toISOString(),
            };

            db.saveTelemetry(telemetryRecord);

            const helmet = db.getHelmetWithDetails(packet.helmetId);
            const alertResult = AlertEngine.processAlerts(
              db.getAlertsStore(),
              packet.helmetId,
              helmet?.worker_id || null,
              packet as any,
              safety
            );

            // Publish authoritative changes to Realtime broker
            const pub = RealtimePublisher.getInstance();
            pub.publish('telemetry', 'INSERT', telemetryRecord);
            if (helmet) pub.publish('helmets', 'UPDATE', helmet);
            if (alertResult.createdAlert) pub.publish('alerts', 'INSERT', alertResult.createdAlert);
            alertResult.resolvedAlerts.forEach((r) => pub.publish('alerts', 'UPDATE', r));
          } catch {
            // Ignore offline fallback error
          }
        });

      // Notify any local provider subscribers
      this.subscribers.forEach((cb) => {
        try {
          cb(packet);
        } catch (e) {
          console.error('Error in telemetry subscriber', e);
        }
      });

      const specificSubs = this.helmetSubscribers.get(state.helmetId);
      if (specificSubs) {
        specificSubs.forEach((cb) => {
          try {
            cb(packet);
          } catch (e) {
            console.error('Error in helmet subscriber', e);
          }
        });
      }
    });
  }
}
