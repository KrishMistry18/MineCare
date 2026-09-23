/**
 * MineCare - Telemetry Service
 * 
 * Central coordinator between:
 * Telemetry Source -> Telemetry Service -> State Store -> Dashboard
 * 
 * - Ingests telemetry packets from ITelemetryProvider
 * - Runs SafetyEvaluator for safety status & hardware output states
 * - Maintains 100-sample rolling time-series buffer for charts
 * - Manages incident alerts and alert history
 * - Tracks heartbeats and offline timeouts
 * - Provides swap-in hook for ESP8266TelemetryProvider
 */

import type { ITelemetryProvider } from './ITelemetryProvider';
import { MockTelemetryProvider } from './MockTelemetryProvider';
import { SafetyEvaluator } from './SafetyEvaluator';
import type { HelmetTelemetryPacket, TelemetryHistoryPoint, ScenarioType } from '../../types/telemetry';
import type { SafetyEvaluationResult } from '../../types/safety';
import type { HelmetDevice, ConnectivityStatus } from '../../types/helmet';
import type { SafetyAlert } from '../../types/alert';
import { INITIAL_WORKERS } from '../../data/mockData';

export type ServiceListener = () => void;

export class TelemetryService {
  private static instance: TelemetryService | null = null;
  private provider: ITelemetryProvider;
  private unsubscribeProvider: (() => void) | null = null;

  // State caches
  private latestPackets: Map<string, HelmetTelemetryPacket> = new Map();
  private safetyStates: Map<string, SafetyEvaluationResult> = new Map();
  private telemetryHistories: Map<string, TelemetryHistoryPoint[]> = new Map();
  private lastSeenTimestamps: Map<string, number> = new Map();
  private connectivityStates: Map<string, ConnectivityStatus> = new Map();
  private alerts: SafetyAlert[] = [];
  private lastAlertTriggers: Map<string, string> = new Map();

  // Listeners for UI state updates
  private listeners: Set<ServiceListener> = new Set();

  private constructor() {
    this.provider = new MockTelemetryProvider();
    this.init();
  }

  public static getInstance(): TelemetryService {
    if (!TelemetryService.instance) {
      TelemetryService.instance = new TelemetryService();
    }
    return TelemetryService.instance;
  }

  private init(): void {
    // Start listening to provider
    this.unsubscribeProvider = this.provider.subscribeAll((packet) => {
      this.handleIncomingPacket(packet);
    });

    // Check for offline helmets every 3 seconds
    setInterval(() => {
      this.checkHeartbeats();
    }, 3000);

    // Connect provider
    this.provider.connect();
  }

  /**
   * Swap out the telemetry provider (e.g., from MockTelemetryProvider to ESP8266TelemetryProvider)
   */
  public async setProvider(newProvider: ITelemetryProvider): Promise<void> {
    if (this.unsubscribeProvider) {
      this.unsubscribeProvider();
      this.unsubscribeProvider = null;
    }
    await this.provider.disconnect();

    this.provider = newProvider;
    this.unsubscribeProvider = this.provider.subscribeAll((packet) => {
      this.handleIncomingPacket(packet);
    });
    await this.provider.connect();
    this.notifyListeners();
  }

  public getProvider(): ITelemetryProvider {
    return this.provider;
  }

  public subscribe(listener: ServiceListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private notifyListeners(): void {
    this.listeners.forEach((listener) => {
      try { listener(); } catch (e) { console.error('Error in TelemetryService listener', e); }
    });
  }

  private handleIncomingPacket(packet: HelmetTelemetryPacket): void {
    const helmetId = packet.helmetId;
    const now = Date.now();
    const wasOffline = this.connectivityStates.get(helmetId) === 'OFFLINE';

    this.latestPackets.set(helmetId, packet);
    this.lastSeenTimestamps.set(helmetId, now);
    this.connectivityStates.set(helmetId, 'ONLINE');

    // Auto-resolve OFFLINE alerts when packets resume
    if (wasOffline) {
      this.alerts.forEach(alert => {
        if (alert.helmetId === helmetId && alert.category === 'HELMET_OFFLINE' && !alert.resolved) {
          alert.resolved = true;
          alert.resolvedAt = new Date().toISOString();
          alert.supervisorNotes = 'Auto-resolved: Telemetry packet stream re-established.';
        }
      });
    }

    // Run safety evaluation
    const safety = SafetyEvaluator.evaluate(packet);
    this.safetyStates.set(helmetId, safety);

    // Update rolling history (limit to 100 points)
    const history = this.telemetryHistories.get(helmetId) || [];
    const dateObj = new Date(packet.timestamp);
    const timeFormatted = dateObj.toTimeString().split(' ')[0];

    const historyPoint: TelemetryHistoryPoint = {
      timestamp: packet.timestamp,
      timeFormatted,
      temperature: packet.dht22.temperature,
      humidity: packet.dht22.humidity,
      rawGasValue: packet.mq2.rawGasValue,
      totalAcceleration: packet.mpu6050.totalAcceleration,
      accelX: packet.mpu6050.accelX,
      accelY: packet.mpu6050.accelY,
      accelZ: packet.mpu6050.accelZ,
      gyroX: packet.mpu6050.gyroX,
      gyroY: packet.mpu6050.gyroY,
      gyroZ: packet.mpu6050.gyroZ,
      sosPressed: packet.sosPressed,
      fallDetected: packet.fallDetected,
    };

    history.push(historyPoint);
    if (history.length > 100) {
      history.shift();
    }
    this.telemetryHistories.set(helmetId, history);

    // Alert Generation & Resolution Logic
    this.processAlerts(helmetId, packet, safety);

    this.notifyListeners();
  }

  private processAlerts(
    helmetId: string, 
    packet: HelmetTelemetryPacket, 
    safety: SafetyEvaluationResult
  ): void {
    // When returning to SAFE, resolve any active hazard alerts for this helmet
    if (safety.status === 'SAFE') {
      this.lastAlertTriggers.delete(helmetId);

      let hadUnresolved = false;
      this.alerts.forEach(alert => {
        if (alert.helmetId === helmetId && !alert.resolved && alert.category !== 'HELMET_OFFLINE') {
          alert.resolved = true;
          alert.resolvedAt = new Date().toISOString();
          alert.supervisorNotes = 'Auto-resolved: Environmental/biometric parameters restored to safe baseline.';
          hadUnresolved = true;
        }
      });

      if (hadUnresolved) {
        this.notifyListeners();
      }
      return;
    }

    const triggerKey = `${safety.status}_${safety.primaryTrigger}`;
    const lastKey = this.lastAlertTriggers.get(helmetId);

    if (triggerKey === lastKey) {
      // Update readings snapshot for ongoing active incident without spawning duplicates
      const existingAlert = this.alerts.find(a => a.helmetId === helmetId && !a.resolved);
      if (existingAlert) {
        existingAlert.readingsSnapshot = {
          temperature: packet.dht22.temperature,
          humidity: packet.dht22.humidity,
          rawGasValue: packet.mq2.rawGasValue,
          totalAcceleration: packet.mpu6050.totalAcceleration,
          sosPressed: packet.sosPressed,
          fallDetected: packet.fallDetected,
        };
        existingAlert.description = safety.triggerDetails.join(' | ');
      }
      return;
    }

    this.lastAlertTriggers.set(helmetId, triggerKey);

      const worker = INITIAL_WORKERS.find(w => w.assignedHelmetId === helmetId);
      const isCritical = safety.status === 'DANGER';

      let category: SafetyAlert['category'] = 'GAS_HAZARD';
      if (safety.primaryTrigger === 'SOS_BUTTON_TRIGGERED') category = 'SOS_EMERGENCY';
      else if (safety.primaryTrigger === 'FALL_IMPACT_DETECTED') category = 'WORKER_FALL';
      else if (safety.primaryTrigger === 'MULTIPLE_HAZARDS') category = 'MULTI_HAZARD';
      else if (safety.primaryTrigger === 'HIGH_TEMPERATURE') category = 'HEAT_STRESS';

      const alert: SafetyAlert = {
        id: `ALT-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
        timestamp: packet.timestamp,
        helmetId,
        workerId: worker?.workerId || 'UNKNOWN',
        workerName: worker?.name || `Worker (${helmetId})`,
        shaftLocation: worker?.zone || 'Portal / Surface',
        severity: isCritical ? 'CRITICAL' : 'WARNING',
        safetyStatus: safety.status,
        category,
        title: isCritical ? `CRITICAL SAFETY ALERT: ${safety.primaryTrigger}` : `WARNING: Elevated Parameter`,
        description: safety.triggerDetails.join(' | '),
        readingsSnapshot: {
          temperature: packet.dht22.temperature,
          humidity: packet.dht22.humidity,
          rawGasValue: packet.mq2.rawGasValue,
          totalAcceleration: packet.mpu6050.totalAcceleration,
          sosPressed: packet.sosPressed,
          fallDetected: packet.fallDetected,
        },
        acknowledged: false,
        resolved: false,
      };

      this.alerts.unshift(alert);
      // Keep up to 200 alerts in memory
      if (this.alerts.length > 200) {
        this.alerts.pop();
      }
  }

  private checkHeartbeats(): void {
    const now = Date.now();
    let changed = false;

    this.lastSeenTimestamps.forEach((lastSeen, helmetId) => {
      const diff = now - lastSeen;
      const currentConn = this.connectivityStates.get(helmetId);

      // If no packet for > 8 seconds, mark as OFFLINE
      if (diff > 8000 && currentConn !== 'OFFLINE') {
        this.connectivityStates.set(helmetId, 'OFFLINE');
        changed = true;

        const worker = INITIAL_WORKERS.find(w => w.assignedHelmetId === helmetId);
        this.alerts.unshift({
          id: `ALT-OFFLINE-${Date.now()}`,
          timestamp: new Date().toISOString(),
          helmetId,
          workerId: worker?.workerId || 'UNKNOWN',
          workerName: worker?.name || `Worker (${helmetId})`,
          shaftLocation: worker?.zone || 'Portal / Surface',
          severity: 'WARNING',
          safetyStatus: 'WARNING',
          category: 'HELMET_OFFLINE',
          title: `HELMET TELEMETRY OFFLINE: ${helmetId}`,
          description: `Missing packet heartbeat for > 8 seconds. Telemetry stream disrupted.`,
          readingsSnapshot: {
            temperature: 0,
            humidity: 0,
            rawGasValue: 0,
            totalAcceleration: 0,
            sosPressed: false,
            fallDetected: false,
          },
          acknowledged: false,
          resolved: false,
        });
      }
    });

    if (changed) {
      this.notifyListeners();
    }
  }

  // --- Public Data Accessors ---

  public getHelmets(): HelmetDevice[] {
    const registeredIds = this.provider.getRegisteredHelmetIds();

    return registeredIds.map(id => {
      const telemetry = this.latestPackets.get(id) || this.createPlaceholderPacket(id);
      const safety = this.safetyStates.get(id) || SafetyEvaluator.evaluate(telemetry);
      const connectivity = this.connectivityStates.get(id) || 'ONLINE';
      const worker = INITIAL_WORKERS.find(w => w.assignedHelmetId === id);

      return {
        helmetId: id,
        serialNumber: `SN-MC8266-${id.replace('MC-', '00')}`,
        firmwareVersion: 'v1.4.2-proto',
        assignedWorkerId: worker?.workerId || null,
        assignedShaft: worker?.zone || 'Portal / Surface',
        connectivity,
        lastHeartbeat: telemetry.timestamp,
        telemetry,
        safety,
      };
    });
  }

  public getHelmet(helmetId: string): HelmetDevice | undefined {
    return this.getHelmets().find(h => h.helmetId === helmetId);
  }

  public getTelemetryHistory(helmetId: string): TelemetryHistoryPoint[] {
    return this.telemetryHistories.get(helmetId) || [];
  }

  public getAlerts(): SafetyAlert[] {
    return [...this.alerts];
  }

  public acknowledgeAlert(alertId: string, supervisorName: string = 'Supervisor On-Duty'): void {
    const alert = this.alerts.find(a => a.id === alertId);
    if (alert) {
      alert.acknowledged = true;
      alert.acknowledgedBy = supervisorName;
      alert.acknowledgedAt = new Date().toISOString();
      this.notifyListeners();
    }
  }

  public resolveAlert(alertId: string, notes?: string): void {
    const alert = this.alerts.find(a => a.id === alertId);
    if (alert) {
      alert.resolved = true;
      alert.resolvedAt = new Date().toISOString();
      if (notes) alert.supervisorNotes = notes;
      this.notifyListeners();
    }
  }

  public triggerScenario(scenario: ScenarioType, helmetId?: string): void {
    if (this.provider.triggerScenario) {
      this.provider.triggerScenario(scenario, helmetId);
    }
  }

  private createPlaceholderPacket(helmetId: string): HelmetTelemetryPacket {
    return {
      packetId: `PKT-${helmetId}-INIT`,
      helmetId,
      timestamp: new Date().toISOString(),
      sequenceNumber: 0,
      dht22: { temperature: 26.5, humidity: 60.0 },
      mq2: { rawGasValue: 220 },
      mpu6050: {
        accelX: 0,
        accelY: 0,
        accelZ: 9.81,
        totalAcceleration: 9.81,
        gyroX: 0,
        gyroY: 0,
        gyroZ: 0,
      },
      sosPressed: false,
      fallDetected: false,
      sensorHealth: { dht22: true, mq2: true, mpu6050: true },
      outputs: { greenLed: true, redLed: false, buzzer: false },
      rssi: -65,
      batteryVolts: 4.10,
    };
  }
}
