/**
 * MineCare - Telemetry Service (Phase 4 Real-Time Operations)
 *
 * Central coordinator for live telemetry & operational state:
 * - Subscribes to Supabase Realtime for authoritative database changes:
 *   * 'telemetry' (INSERT)
 *   * 'helmets' (UPDATE)
 *   * 'alerts' (INSERT | UPDATE)
 *   * 'zone_assignments' (INSERT | UPDATE)
 * - Employs backend SafetyEngine & AlertEngine as sole authoritative source
 * - Maintains 100-point rolling history buffer for charts
 * - Exposes real-time connection status (CONNECTED, CONNECTING, DISCONNECTED, ERROR)
 * - Provides clean subscription lifecycle and unmount cleanup
 */

import type { ITelemetryProvider } from './ITelemetryProvider';
import { MockTelemetryProvider } from './MockTelemetryProvider';
import type { HelmetTelemetryPacket, TelemetryHistoryPoint, ScenarioType } from '../../types/telemetry';
import type { SafetyEvaluationResult } from '../../types/safety';
import type { HelmetDevice, ConnectivityStatus } from '../../types/helmet';
import type { SafetyAlert } from '../../types/alert';
import { ZoneAssignmentProvider } from '../zones/ZoneAssignmentProvider';
import { alertService } from '../api/alertService';
import { helmetService } from '../api/helmetService';
import { simulationService } from '../api/simulationService';
import {
  SupabaseRealtimeService,
  type RealtimeConnectionState,
} from '../realtime/SupabaseRealtimeService';
import type { DbAlert, DbHelmet, DbTelemetry, DbZoneAssignment } from '../../backend/types';

export type ServiceListener = () => void;

export class TelemetryService {
  private static instance: TelemetryService | null = null;
  private provider: ITelemetryProvider;
  private zoneProvider: ZoneAssignmentProvider;
  private realtimeService: SupabaseRealtimeService;

  // Realtime cleanup unsubscribers
  private realtimeUnsubscribers: Array<() => void> = [];

  // State caches
  private latestPackets: Map<string, HelmetTelemetryPacket> = new Map();
  private safetyStates: Map<string, SafetyEvaluationResult> = new Map();
  private telemetryHistories: Map<string, TelemetryHistoryPoint[]> = new Map();
  private lastSeenTimestamps: Map<string, number> = new Map();
  private connectivityStates: Map<string, ConnectivityStatus> = new Map();
  private alerts: SafetyAlert[] = [];
  private lastTelemetryTime: string = '';

  // Listeners for UI state updates
  private listeners: Set<ServiceListener> = new Set();

  private constructor() {
    this.provider = new MockTelemetryProvider();
    this.zoneProvider = ZoneAssignmentProvider.getInstance();
    this.realtimeService = SupabaseRealtimeService.getInstance();
    this.init();
  }

  public static getInstance(): TelemetryService {
    if (!TelemetryService.instance) {
      TelemetryService.instance = new TelemetryService();
    }
    return TelemetryService.instance;
  }

  /**
   * Reset instance (for test isolation)
   */
  public static resetInstance(): void {
    if (TelemetryService.instance) {
      TelemetryService.instance.cleanup();
      TelemetryService.instance = null;
    }
  }

  private init(): void {
    // 1. Initialize fleet baselines so UI immediately renders commissioned helmets
    const registered = this.provider.getRegisteredHelmetIds();
    registered.forEach((id) => {
      this.latestPackets.set(id, this.createPlaceholderPacket(id));
      this.connectivityStates.set(id, 'ONLINE');
      this.safetyStates.set(id, {
        status: 'SAFE',
        primaryTrigger: 'NOMINAL',
        triggerDetails: ['All parameters normal'],
        outputs: { greenLed: true, redLed: false, buzzer: false },
        isPrototypeNotice: true,
      });
    });

    // 2. Setup Supabase Realtime Subscriptions
    this.setupRealtimeSubscriptions();

    // 3. Listen to zone assignment updates
    this.zoneProvider.subscribe(() => {
      this.notifyListeners();
    });

    // 4. Connect telemetry provider simulator and subscribe
    this.provider.subscribeAll((packet) => {
      this.handleRealtimeTelemetry(packet);
    });
    this.provider.connect();

    // 5. Asynchronously load initial authoritative helmets and active alerts
    void this.loadInitialState();
  }

  public async loadInitialState(): Promise<void> {
    try {
      const [dbHelmets, dbAlerts] = await Promise.allSettled([
        helmetService.getHelmets(),
        alertService.getActiveAlerts(),
      ]);

      if (dbHelmets.status === 'fulfilled' && Array.isArray(dbHelmets.value)) {
        dbHelmets.value.forEach((h) => this.handleRealtimeHelmet(h));
      }

      if (dbAlerts.status === 'fulfilled' && Array.isArray(dbAlerts.value)) {
        this.alerts = dbAlerts.value.map((a) => {
          const worker = this.zoneProvider.getWorkerByHelmetId(a.helmet_id);
          return this.convertDbAlertToSafetyAlert(a, worker?.name, worker?.currentWorkZone || undefined);
        });
      }

      this.notifyListeners();
    } catch {
      // Fallback gracefully
    }
  }

  /**
   * Subscribe only to the 4 required authoritative operational tables
   */
  private setupRealtimeSubscriptions(): void {
    // Cleanup any existing subscriptions
    this.cleanupRealtime();

    // A. TELEMETRY (INSERT)
    const unsubTelemetry = this.realtimeService.subscribeTable<DbTelemetry>('telemetry', (payload) => {
      if (payload.eventType === 'INSERT' && payload.new) {
        this.handleRealtimeTelemetry(payload.new);
      }
    });

    // B. HELMETS (UPDATE)
    const unsubHelmets = this.realtimeService.subscribeTable<DbHelmet>('helmets', (payload) => {
      if (payload.new) {
        this.handleRealtimeHelmet(payload.new);
      }
    });

    // C. ALERTS (INSERT | UPDATE)
    const unsubAlerts = this.realtimeService.subscribeTable<DbAlert>('alerts', (payload) => {
      if (payload.new) {
        this.handleRealtimeAlert(payload.new, payload.eventType);
      }
    });

    // D. ZONE_ASSIGNMENTS (INSERT | UPDATE)
    const unsubZones = this.realtimeService.subscribeTable<DbZoneAssignment>('zone_assignments', (payload) => {
      if (payload.new) {
        this.handleRealtimeZoneAssignment(payload.new);
      }
    });

    this.realtimeUnsubscribers = [unsubTelemetry, unsubHelmets, unsubAlerts, unsubZones];
  }

  private cleanupRealtime(): void {
    this.realtimeUnsubscribers.forEach((unsub) => unsub());
    this.realtimeUnsubscribers = [];
  }

  public reattachRealtimeSubscriptions(): void {
    this.setupRealtimeSubscriptions();
  }

  public getActiveSubscriptionCount(): number {
    return this.realtimeUnsubscribers.length;
  }

  public cleanup(): void {
    this.cleanupRealtime();
    this.provider.disconnect();
    this.listeners.clear();
  }

  // --- Realtime Event Handlers ---

  private handleRealtimeTelemetry(row: DbTelemetry | any): void {
    const helmetId = row.helmet_id || row.helmetId;
    if (!helmetId) return;

    const gasVal = Number(row.gas_value ?? row.mq2?.rawGasValue ?? row.gasConcentration ?? 200);
    const tempVal = Number(row.temperature ?? row.dht22?.temperature ?? 26.5);
    const humidityVal = Number(row.humidity ?? row.dht22?.humidity ?? 55.0);
    const isSos = Boolean(row.sos_pressed ?? row.sosPressed ?? false);
    const isFall = Boolean(row.fall_detected ?? row.fallDetected ?? false);
    const totalAccel = Number(row.total_acceleration ?? row.mpu6050?.totalAcceleration ?? 9.81);

    const derivedStatus = (isSos || isFall || totalAccel > 15)
      ? 'DANGER'
      : (gasVal > 800 || tempVal > 40)
      ? 'WARNING'
      : 'SAFE';
    const safetyStatus = (row.safety_status || row.safetyStatus || row.status || derivedStatus) as any;

    const packet: HelmetTelemetryPacket = {
      packetId: row.id || row.packetId || `PKT-${helmetId}-${Date.now()}`,
      helmetId,
      timestamp: row.timestamp || new Date().toISOString(),
      sequenceNumber: Number(row.sequence_number ?? row.sequenceNumber ?? 0),
      dht22: { temperature: tempVal, humidity: humidityVal },
      mq2: { rawGasValue: gasVal },
      mpu6050: {
        accelX: Number(row.acceleration_x ?? row.mpu6050?.accelX ?? 0),
        accelY: Number(row.acceleration_y ?? row.mpu6050?.accelY ?? 0),
        accelZ: Number(row.acceleration_z ?? row.mpu6050?.accelZ ?? 9.81),
        totalAcceleration: totalAccel,
        gyroX: Number(row.gyro_x ?? row.mpu6050?.gyroX ?? 0),
        gyroY: Number(row.gyro_y ?? row.mpu6050?.gyroY ?? 0),
        gyroZ: Number(row.gyro_z ?? row.mpu6050?.gyroZ ?? 0),
      },
      sosPressed: isSos,
      fallDetected: isFall,
      sensorHealth: { dht22: true, mq2: true, mpu6050: true },
      outputs: {
        greenLed: safetyStatus === 'SAFE',
        redLed: safetyStatus === 'DANGER',
        buzzer: safetyStatus === 'DANGER',
      },
      rssi: -65,
      batteryVolts: 4.1,
    };

    this.latestPackets.set(helmetId, packet);
    this.lastSeenTimestamps.set(helmetId, Date.now());
    this.connectivityStates.set(helmetId, 'ONLINE');

    // Update authoritative safety state
    this.safetyStates.set(helmetId, {
      status: safetyStatus,
      primaryTrigger:
        safetyStatus === 'SAFE'
          ? 'NOMINAL'
          : isSos
          ? 'SOS_BUTTON_TRIGGERED'
          : isFall || totalAccel > 15
          ? 'FALL_IMPACT_DETECTED'
          : gasVal > 800 && tempVal > 40
          ? 'MULTIPLE_HAZARDS'
          : gasVal > 800
          ? 'HIGH_RAW_GAS_LEVEL'
          : 'HIGH_TEMPERATURE',
      triggerDetails: [],
      outputs: {
        greenLed: safetyStatus === 'SAFE',
        redLed: safetyStatus === 'DANGER',
        buzzer: safetyStatus === 'DANGER',
      },
      isPrototypeNotice: true,
    });

    // Update rolling history buffer (100 points)
    const history = this.telemetryHistories.get(helmetId) || [];
    const dateObj = new Date(row.timestamp);
    const timeFormatted = dateObj.toTimeString().split(' ')[0];

    const historyPoint: TelemetryHistoryPoint = {
      timestamp: row.timestamp,
      timeFormatted,
      temperature: Number(row.temperature),
      humidity: Number(row.humidity),
      rawGasValue: Number(row.gas_value),
      totalAcceleration: Number(row.total_acceleration),
      accelX: Number(row.acceleration_x),
      accelY: Number(row.acceleration_y),
      accelZ: Number(row.acceleration_z),
      gyroX: Number(row.gyro_x),
      gyroY: Number(row.gyro_y),
      gyroZ: Number(row.gyro_z),
      sosPressed: Boolean(row.sos_pressed),
      fallDetected: Boolean(row.fall_detected),
    };

    history.push(historyPoint);
    if (history.length > 100) {
      history.shift();
    }
    this.telemetryHistories.set(helmetId, history);

    // Update authoritative last telemetry time for dashboard
    this.lastTelemetryTime = timeFormatted;

    this.notifyListeners();
  }

  private handleRealtimeHelmet(row: DbHelmet | any): void {
    const helmetId = row.id || row.helmet_code || row.helmetId;
    if (!helmetId) return;
    const isOnline = Boolean(row.online !== undefined ? row.online : row.is_online ?? true);

    this.connectivityStates.set(helmetId, isOnline ? 'ONLINE' : 'OFFLINE');

    const existingSafety = this.safetyStates.get(helmetId);
    if (existingSafety) {
      existingSafety.status = row.status;
    } else {
      this.safetyStates.set(helmetId, {
        status: row.status,
        primaryTrigger: 'NOMINAL',
        triggerDetails: [],
        outputs: {
          greenLed: row.status === 'SAFE',
          redLed: row.status === 'DANGER',
          buzzer: row.status === 'DANGER',
        },
        isPrototypeNotice: true,
      });
    }

    this.notifyListeners();
  }

  private handleRealtimeAlert(row: DbAlert | any, eventType: string): void {
    const helmetId = row.helmet_id || row.helmetId;
    const worker = this.zoneProvider.getWorkerByHelmetId(helmetId);
    const alert = this.convertDbAlertToSafetyAlert(row, worker?.name, worker?.currentWorkZone || undefined);

    const existingIndex = this.alerts.findIndex((a) => a.id === row.id);

    if (existingIndex >= 0) {
      // UPDATE: Update in place
      this.alerts[existingIndex] = alert;
    } else if (eventType === 'INSERT') {
      // INSERT: Prepend to active alerts
      this.alerts.unshift(alert);
      if (this.alerts.length > 200) {
        this.alerts.pop();
      }
    } else {
      this.alerts.unshift(alert);
    }

    this.notifyListeners();
  }

  private handleRealtimeZoneAssignment(row: DbZoneAssignment): void {
    this.zoneProvider.applyRealtimeAssignment({
      worker_id: row.worker_id,
      zone_id: row.zone_id,
      active: Boolean(row.active),
    });
    this.notifyListeners();
  }

  private convertDbAlertToSafetyAlert(
    row: DbAlert,
    workerName?: string,
    shaftLocation?: string
  ): SafetyAlert {
    const isCritical = row.severity === 'CRITICAL';
    const isResolved = row.status === 'RESOLVED' || Boolean(row.resolved_at);

    return {
      id: row.id,
      timestamp: row.triggered_at,
      helmetId: row.helmet_id,
      workerId: row.worker_id || 'UNKNOWN',
      workerName: workerName || (row.worker_id ? `Worker (${row.worker_id})` : `Worker (${row.helmet_id})`),
      shaftLocation: shaftLocation || 'Portal / Surface',
      severity: row.severity,
      safetyStatus: isCritical ? 'DANGER' : 'WARNING',
      category: row.type,
      title: isCritical ? `CRITICAL SAFETY ALERT: ${row.type}` : `WARNING: Elevated Parameter`,
      description: row.message,
      readingsSnapshot: {
        temperature: row.readings_snapshot?.temperature ?? 0,
        humidity: row.readings_snapshot?.humidity ?? 0,
        rawGasValue: row.readings_snapshot?.gas_value ?? 0,
        totalAcceleration: row.readings_snapshot?.total_acceleration ?? 9.8,
        sosPressed: Boolean(row.readings_snapshot?.sos_pressed),
        fallDetected: Boolean(row.readings_snapshot?.fall_detected),
      },
      acknowledged: row.status === 'ACKNOWLEDGED' || Boolean(row.acknowledged_at),
      acknowledgedBy: row.acknowledged_by || undefined,
      acknowledgedAt: row.acknowledged_at || undefined,
      resolved: isResolved,
      resolvedAt: row.resolved_at || undefined,
      supervisorNotes: row.supervisor_notes || undefined,
    };
  }

  // --- Realtime Connection & Status Accessors ---

  public getRealtimeConnectionState(): RealtimeConnectionState {
    return this.realtimeService.getConnectionState();
  }

  public getRealtimeProviderName(): string {
    return this.realtimeService.getProviderName();
  }

  public onRealtimeConnectionStateChange(listener: (state: RealtimeConnectionState) => void): () => void {
    return this.realtimeService.onConnectionStateChange(listener);
  }

  public getLastTelemetryTime(): string {
    if (this.lastTelemetryTime) return this.lastTelemetryTime;
    const now = new Date();
    return now.toTimeString().split(' ')[0];
  }

  public getZoneProvider(): ZoneAssignmentProvider {
    return this.zoneProvider;
  }

  public getRealtimeService(): SupabaseRealtimeService {
    return this.realtimeService;
  }

  public subscribe(listener: ServiceListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private notifyListeners(): void {
    this.listeners.forEach((listener) => {
      try {
        listener();
      } catch (e) {
        console.error('Error in TelemetryService listener', e);
      }
    });
  }

  // --- Public Data Accessors ---

  public getHelmets(): HelmetDevice[] {
    const registeredIds = this.provider.getRegisteredHelmetIds();

    return registeredIds.map((id) => {
      const telemetry = this.latestPackets.get(id) || this.createPlaceholderPacket(id);
      const safety: SafetyEvaluationResult = this.safetyStates.get(id) || {
        status: 'SAFE',
        primaryTrigger: 'NOMINAL',
        triggerDetails: [],
        outputs: { greenLed: true, redLed: false, buzzer: false },
        isPrototypeNotice: true,
      };
      const connectivity = this.connectivityStates.get(id) || 'ONLINE';
      const worker = this.zoneProvider.getWorkerByHelmetId(id);
      const currentWorkZone = worker?.currentWorkZone ?? null;
      const assignedZone = worker?.assignedZone || 'Portal / Surface';

      return {
        helmetId: id,
        serialNumber: `SN-MC8266-${id.replace('MC-', '00')}`,
        firmwareVersion: 'v1.4.2-proto',
        assignedWorkerId: worker?.workerId || null,
        assignedShaft: currentWorkZone || 'Checked Out',
        assignedZone,
        currentWorkZone,
        connectivity,
        lastHeartbeat: telemetry.timestamp,
        telemetry,
        safety,
      };
    });
  }

  public getHelmet(helmetId: string): HelmetDevice | undefined {
    return this.getHelmets().find((h) => h.helmetId === helmetId);
  }

  public getTelemetryHistory(helmetId: string): TelemetryHistoryPoint[] {
    return this.telemetryHistories.get(helmetId) || [];
  }

  public getAlerts(): SafetyAlert[] {
    return [...this.alerts];
  }

  public acknowledgeAlert(alertId: string, supervisorName: string = 'Supervisor On-Duty'): void {
    const alert = this.alerts.find((a) => a.id === alertId);
    if (alert) {
      alert.acknowledged = true;
      alert.acknowledgedBy = supervisorName;
      alert.acknowledgedAt = new Date().toISOString();
      this.notifyListeners();
    }

    // Call backend authoritative endpoint
    alertService.acknowledgeAlert(alertId, supervisorName).catch(() => {});
  }

  public resolveAlert(alertId: string, notes?: string): void {
    const alert = this.alerts.find((a) => a.id === alertId);
    if (alert) {
      alert.resolved = true;
      alert.resolvedAt = new Date().toISOString();
      if (notes) alert.supervisorNotes = notes;
      this.notifyListeners();
    }

    // Call backend authoritative endpoint
    alertService.resolveAlert(alertId, notes).catch(() => {});
  }

  public async triggerScenario(scenario: ScenarioType, helmetId?: string): Promise<void> {
    const targetHelmetId = helmetId || 'MC-001';

    // 1. Immediately drive local mock provider state
    if (this.provider && typeof this.provider.triggerScenario === 'function') {
      this.provider.triggerScenario(scenario, targetHelmetId);
    }

    // 2. Dispatch authorized simulation scenario to backend
    const response = await simulationService.runScenario(scenario, targetHelmetId);
    if (response) {
      if (response.telemetry) {
        this.handleRealtimeTelemetry(response.telemetry);
      }
      if (response.helmet) {
        this.handleRealtimeHelmet(response.helmet);
      }
      if (response.safety) {
        const existing = this.safetyStates.get(targetHelmetId);
        if (existing) {
          existing.status = response.safety.status;
          existing.primaryTrigger = response.safety.primaryTrigger;
          existing.triggerDetails = response.safety.triggerDetails || [];
          existing.outputs = response.safety.outputs;
        } else {
          this.safetyStates.set(targetHelmetId, {
            status: response.safety.status,
            primaryTrigger: response.safety.primaryTrigger,
            triggerDetails: response.safety.triggerDetails || [],
            outputs: response.safety.outputs,
            isPrototypeNotice: true,
          });
        }
      }
      if (response.alert) {
        this.handleRealtimeAlert(response.alert, 'INSERT');
      }
      if (response.alerts && Array.isArray(response.alerts)) {
        response.alerts.forEach((alert: any) => {
          this.handleRealtimeAlert(alert, alert.resolved || alert.status === 'RESOLVED' ? 'UPDATE' : 'INSERT');
        });
      }
      if (response.resolvedAlerts && Array.isArray(response.resolvedAlerts)) {
        response.resolvedAlerts.forEach((alert: any) => {
          this.handleRealtimeAlert(alert, 'UPDATE');
        });
      }
      this.notifyListeners();
    }
  }

  public getProvider(): ITelemetryProvider {
    return this.provider;
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
      batteryVolts: 4.1,
    };
  }
}
