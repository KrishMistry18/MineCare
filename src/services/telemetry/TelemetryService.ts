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
import type { SafetyEvaluationResult, SafetyStatus } from '../../types/safety';
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
  private latestPacketTimestamps: Map<string, number> = new Map();
  private helmetDataLoadingStates: Map<string, 'IDLE' | 'LOADING' | 'LOADED' | 'ERROR'> = new Map();
  private helmetErrorStates: Map<string, string> = new Map();
  private alerts: SafetyAlert[] = [];
  private lastTelemetryTime: string = '';
  private latestTelemetryTimestamp: number = 0;
  private dbHelmetsList: DbHelmet[] = [];
  private hydrationPromise: Promise<void> | null = null;

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
      TelemetryService.instance.latestPackets.clear();
      TelemetryService.instance.safetyStates.clear();
      TelemetryService.instance.telemetryHistories.clear();
      TelemetryService.instance.lastSeenTimestamps.clear();
      TelemetryService.instance.connectivityStates.clear();
      TelemetryService.instance.latestPacketTimestamps.clear();
      TelemetryService.instance.helmetDataLoadingStates.clear();
      TelemetryService.instance.helmetErrorStates.clear();
      TelemetryService.instance.alerts = [];
      TelemetryService.instance.lastTelemetryTime = '';
      TelemetryService.instance.latestTelemetryTimestamp = 0;
      TelemetryService.instance.dbHelmetsList = [];
      TelemetryService.instance.hydrationPromise = null;
      TelemetryService.instance = null;
    }
  }

  private init(): void {
    // 1. Initialize registered helmets with unhydrated / offline state without fake normal packets
    const registered = this.provider.getRegisteredHelmetIds();
    registered.forEach((id) => {
      this.connectivityStates.set(id, 'OFFLINE');
      this.helmetDataLoadingStates.set(id, 'IDLE');
      this.safetyStates.set(id, {
        status: 'SAFE',
        primaryTrigger: 'NOMINAL',
        triggerDetails: ['No telemetry recorded'],
        outputs: { greenLed: false, redLed: false, buzzer: false },
        isPrototypeNotice: false,
      });
    });

    // 2. Setup Supabase Realtime Subscriptions
    this.setupRealtimeSubscriptions();

    // 3. Listen to zone assignment updates
    this.zoneProvider.subscribe(() => {
      this.notifyListeners();
    });

    // 4. Listen to Realtime connection state for automatic state reconciliation on reconnect
    this.realtimeService.onConnectionStateChange((state) => {
      if (state === 'CONNECTED') {
        void this.reconcileBackendState();
      }
    });

    // 5. Subscribe to local mock provider
    this.provider.subscribeAll((packet) => {
      this.handleRealtimeTelemetry(packet);
    });

    // 6. Asynchronously load initial authoritative helmets, latest telemetry, and alert history
    void this.loadInitialState();
  }

  public async reconcileBackendState(): Promise<void> {
    await this.loadInitialState();
  }

  public async loadInitialState(): Promise<void> {
    if (this.hydrationPromise) {
      return this.hydrationPromise;
    }
    this.hydrationPromise = this.executeInitialStateLoad();
    try {
      await this.hydrationPromise;
    } finally {
      this.hydrationPromise = null;
    }
  }

  private async executeInitialStateLoad(): Promise<void> {
    try {
      // 1. Fetch helmets, active alerts, and resolved alert history concurrently
      const [dbHelmetsRes, activeAlertsRes, historyAlertsRes] = await Promise.allSettled([
        helmetService.getHelmets(),
        alertService.getActiveAlerts(),
        alertService.getAlertHistory(),
      ]);

      if (dbHelmetsRes.status === 'fulfilled' && Array.isArray(dbHelmetsRes.value)) {
        this.dbHelmetsList = dbHelmetsRes.value;
        dbHelmetsRes.value.forEach((h) => this.handleRealtimeHelmet(h));
      }

      // 2. Load alerts: combine active and resolved alert history without duplicates
      const alertsMap = new Map<string, SafetyAlert>();
      if (historyAlertsRes.status === 'fulfilled' && Array.isArray(historyAlertsRes.value)) {
        historyAlertsRes.value.forEach((a) => {
          const worker = this.zoneProvider.getWorkerByHelmetId(a.helmet_id);
          alertsMap.set(a.id, this.convertDbAlertToSafetyAlert(a, worker?.name, worker?.currentWorkZone || undefined));
        });
      }
      if (activeAlertsRes.status === 'fulfilled' && Array.isArray(activeAlertsRes.value)) {
        activeAlertsRes.value.forEach((a) => {
          const worker = this.zoneProvider.getWorkerByHelmetId(a.helmet_id);
          alertsMap.set(a.id, this.convertDbAlertToSafetyAlert(a, worker?.name, worker?.currentWorkZone || undefined));
        });
      }
      // Preserve any active alerts that arrived via realtime during network request
      this.alerts.forEach((existing) => {
        if (!alertsMap.has(existing.id)) {
          alertsMap.set(existing.id, existing);
        }
      });
      this.alerts = Array.from(alertsMap.values()).sort(
        (a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
      );

      // 3. Hydrate actual latest persisted telemetry for each helmet
      const helmetIdsToHydrate = this.dbHelmetsList.length > 0
        ? this.dbHelmetsList.map((h) => h.id)
        : this.provider.getRegisteredHelmetIds();

      await Promise.allSettled(
        helmetIdsToHydrate.map(async (helmetId) => {
          this.helmetDataLoadingStates.set(helmetId, 'LOADING');
          try {
            const latestTelemetry = await helmetService.getLatestTelemetry(helmetId);
            if (latestTelemetry) {
              const packetTime = new Date(latestTelemetry.timestamp).getTime();
              const currentLatest = this.latestPacketTimestamps.get(helmetId) || 0;

              // Race condition guard: Older initial API response cannot overwrite newer realtime readings
              if (packetTime >= currentLatest) {
                this.latestPacketTimestamps.set(helmetId, packetTime);
                const parsedPacket = this.parseDbTelemetryToPacket(latestTelemetry);
                this.latestPackets.set(helmetId, parsedPacket);
                this.helmetDataLoadingStates.set(helmetId, 'LOADED');
                this.helmetErrorStates.delete(helmetId);

                // Update connectivity based on actual measurement timestamp
                const conn = this.evaluatePacketConnectivity(latestTelemetry.timestamp, Date.now());
                this.connectivityStates.set(helmetId, conn);

                // Update authoritative safety state
                this.updateAuthoritativeSafetyState(helmetId, parsedPacket);

                const dateObj = new Date(latestTelemetry.timestamp);
                if (!this.lastTelemetryTime || packetTime > this.latestTelemetryTimestamp) {
                  this.latestTelemetryTimestamp = packetTime;
                  this.lastTelemetryTime = dateObj.toTimeString().split(' ')[0];
                }
              }
            } else {
              this.helmetDataLoadingStates.set(helmetId, 'LOADED');
            }
          } catch (err: any) {
            if (err?.status === 404 || err?.message?.includes('No telemetry recorded')) {
              // Helmet has NO telemetry history in database
              this.helmetDataLoadingStates.set(helmetId, 'LOADED');
              this.helmetErrorStates.delete(helmetId);
              if (!this.latestPackets.has(helmetId)) {
                this.connectivityStates.set(helmetId, 'OFFLINE');
              }
            } else {
              // API failure: display loading/error state. Never silently substitute fake normal readings.
              this.helmetDataLoadingStates.set(helmetId, 'ERROR');
              this.helmetErrorStates.set(helmetId, err?.message || 'Failed to fetch latest telemetry');
            }
          }

          // Fetch persisted history points if available
          try {
            const history = await helmetService.getTelemetryHistory(helmetId, 50);
            if (Array.isArray(history) && history.length > 0) {
              const currentHistory = this.telemetryHistories.get(helmetId) || [];
              if (currentHistory.length === 0) {
                const mapped = history.map((row) => ({
                  timestamp: row.timestamp,
                  timeFormatted: new Date(row.timestamp).toTimeString().split(' ')[0],
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
                }));
                this.telemetryHistories.set(helmetId, mapped);
              }
            }
          } catch {
            // Silently ignore history fetch errors
          }
        })
      );

      this.notifyListeners();
    } catch (e) {
      console.error('Error during initial state loading', e);
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

  // --- Realtime Event Handlers & Data Processing ---

  public handleRealtimeTelemetry(row: DbTelemetry | any): void {
    const helmetId = row.helmet_id || row.helmetId;
    if (!helmetId) return;

    const packetTime = new Date(row.timestamp || Date.now()).getTime();
    const currentLatest = this.latestPacketTimestamps.get(helmetId) || 0;

    // Race condition guard: Older out-of-order realtime packet cannot overwrite newer reading
    if (packetTime < currentLatest) {
      return;
    }
    this.latestPacketTimestamps.set(helmetId, packetTime);

    const packet = this.parseDbTelemetryToPacket(row);
    this.latestPackets.set(helmetId, packet);
    this.lastSeenTimestamps.set(helmetId, Date.now());
    this.connectivityStates.set(helmetId, this.evaluatePacketConnectivity(packet.timestamp, Date.now()));
    this.helmetDataLoadingStates.set(helmetId, 'LOADED');
    this.helmetErrorStates.delete(helmetId);

    // Update authoritative safety state
    this.updateAuthoritativeSafetyState(helmetId, packet);

    // Update rolling history buffer (100 points)
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

    // Update authoritative last telemetry time for dashboard
    this.lastTelemetryTime = timeFormatted;
    this.latestTelemetryTimestamp = packetTime;

    this.notifyListeners();
  }

  public parseDbTelemetryToPacket(row: DbTelemetry | any): HelmetTelemetryPacket {
    const helmetId = row.helmet_id || row.helmetId;
    const gasVal = Number(row.gas_value ?? row.mq2?.rawGasValue ?? row.gasConcentration ?? 0);
    const tempVal = Number(row.temperature ?? row.dht22?.temperature ?? 0);
    const humidityVal = Number(row.humidity ?? row.dht22?.humidity ?? 0);
    const isSos = Boolean(row.sos_pressed ?? row.sosPressed ?? false);
    const isFall = Boolean(row.fall_detected ?? row.fallDetected ?? false);
    const totalAccel = Number(row.total_acceleration ?? row.mpu6050?.totalAcceleration ?? 9.81);

    const dhtValid = Boolean(
      row.dht_valid ?? row.dhtValid ?? row.sensorHealth?.dht22 ?? (row.tempValid !== false && row.humidityValid !== false && true)
    );
    const mpuValid = Boolean(
      row.mpu_valid ?? row.mpuValid ?? row.sensorHealth?.mpu6050 ?? true
    );
    const isSensorFault = !dhtValid || !mpuValid;

    const derivedStatus: SafetyStatus = (isSos || (mpuValid && (isFall || totalAccel > 15)))
      ? 'DANGER'
      : (gasVal > 800 || (dhtValid && tempVal > 40))
      ? 'WARNING'
      : isSensorFault
      ? 'SENSOR_FAULT'
      : 'SAFE';
    let safetyStatus = (row.safety_status || row.safetyStatus || row.status || derivedStatus) as SafetyStatus;
    if (isSensorFault && safetyStatus === 'SAFE') {
      safetyStatus = 'SENSOR_FAULT';
    }

    const packetId = row.id || row.packetId || `PKT-${helmetId}-${Date.now()}`;
    const isSimulated = Boolean(
      row.is_simulated ||
      row.isSimulated ||
      (typeof packetId === 'string' && packetId.includes('-SIM-')) ||
      row.telemetrySource === 'SIMULATION'
    );

    return {
      packetId,
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
      sensorHealth: {
        dht22: dhtValid,
        mq2: true, // Note: MQ-2 is single-ended analog; see documentation
        mpu6050: mpuValid,
      },
      outputs: {
        greenLed: safetyStatus === 'SAFE',
        redLed: safetyStatus !== 'SAFE',
        buzzer: safetyStatus === 'DANGER',
      },
      rssi: row.rssi !== undefined ? Number(row.rssi) : -65,
      batteryVolts: row.battery_volts !== undefined ? Number(row.battery_volts) : 4.1,
      isSimulated,
      telemetrySource: isSimulated ? 'SIMULATION' : 'DATABASE',
    };
  }

  public updateAuthoritativeSafetyState(helmetId: string, packet: HelmetTelemetryPacket): void {
    const isSos = packet.sosPressed;
    const isFall = packet.fallDetected;
    const totalAccel = packet.mpu6050.totalAcceleration;
    const gasVal = packet.mq2.rawGasValue;
    const tempVal = packet.dht22.temperature;
    const dhtValid = packet.sensorHealth.dht22;
    const mpuValid = packet.sensorHealth.mpu6050;
    const isSensorFault = !dhtValid || !mpuValid;

    const derivedStatus: SafetyStatus = (isSos || (mpuValid && (isFall || totalAccel > 15)))
      ? 'DANGER'
      : (gasVal > 800 || (dhtValid && tempVal > 40))
      ? 'WARNING'
      : isSensorFault
      ? 'SENSOR_FAULT'
      : 'SAFE';

    // Check for active unresolved alerts for this helmet
    const activeAlertsForHelmet = this.alerts.filter((a) => a.helmetId === helmetId && !a.resolved);
    const hasActiveCritical = activeAlertsForHelmet.some(
      (a) => a.severity === 'CRITICAL' || a.safetyStatus === 'DANGER'
    );
    const hasActiveWarning = activeAlertsForHelmet.some(
      (a) => (a.severity === 'WARNING' || a.safetyStatus === 'WARNING') && a.category !== 'SENSOR_FAULT'
    );
    const hasActiveSensorFault = activeAlertsForHelmet.some(
      (a) => a.category === 'SENSOR_FAULT' || a.safetyStatus === 'SENSOR_FAULT'
    );

    const effectiveStatus: SafetyStatus =
      derivedStatus === 'DANGER' || hasActiveCritical
        ? 'DANGER'
        : derivedStatus === 'WARNING' || hasActiveWarning
        ? 'WARNING'
        : derivedStatus === 'SENSOR_FAULT' || isSensorFault || hasActiveSensorFault
        ? 'SENSOR_FAULT'
        : 'SAFE';

    this.safetyStates.set(helmetId, {
      status: effectiveStatus,
      primaryTrigger:
        effectiveStatus === 'SAFE'
          ? 'NOMINAL'
          : isSos || hasActiveCritical
          ? 'SOS_BUTTON_TRIGGERED'
          : (mpuValid && (isFall || totalAccel > 15))
          ? 'FALL_IMPACT_DETECTED'
          : gasVal > 800 && (dhtValid && tempVal > 40)
          ? 'MULTIPLE_HAZARDS'
          : gasVal > 800
          ? 'HIGH_RAW_GAS_LEVEL'
          : (dhtValid && tempVal > 40)
          ? 'HIGH_TEMPERATURE'
          : 'SENSOR_FAULT',
      triggerDetails: isSensorFault
        ? [
            ...(!dhtValid ? ['DHT22 Temperature/Humidity Sensor Offline'] : []),
            ...(!mpuValid ? ['MPU6050 Accelerometer/Gyroscope I2C Fault'] : []),
          ]
        : [],
      outputs: {
        greenLed: effectiveStatus === 'SAFE',
        redLed: effectiveStatus !== 'SAFE',
        buzzer: effectiveStatus === 'DANGER',
      },
      isPrototypeNotice: true,
    });
  }

  public evaluatePacketConnectivity(lastSeenIso: string, nowMs: number = Date.now()): ConnectivityStatus {
    const lastSeenMs = Date.parse(lastSeenIso);
    if (isNaN(lastSeenMs)) return 'OFFLINE';
    const diff = nowMs - lastSeenMs;
    if (diff < 4000) return 'ONLINE';
    if (diff <= 8000) return 'STALE';
    return 'OFFLINE';
  }

  private handleRealtimeHelmet(row: DbHelmet | any): void {
    const helmetId = row.id || row.helmet_code || row.helmetId;
    if (!helmetId) return;

    // Track helmet in list if new
    const existingIdx = this.dbHelmetsList.findIndex(h => h.id === helmetId);
    if (existingIdx >= 0) {
      this.dbHelmetsList[existingIdx] = { ...this.dbHelmetsList[existingIdx], ...row };
    } else if (row.id) {
      this.dbHelmetsList.push(row);
    }

    const isOnline = Boolean(row.online !== undefined ? row.online : row.is_online ?? false);
    const lastSeenConn = row.last_seen ? this.evaluatePacketConnectivity(row.last_seen, Date.now()) : 'OFFLINE';
    const effectiveConn: ConnectivityStatus = isOnline ? lastSeenConn : 'OFFLINE';

    this.connectivityStates.set(helmetId, effectiveConn);

    const existingSafety = this.safetyStates.get(helmetId);
    if (existingSafety) {
      if (row.status) {
        existingSafety.status = row.status;
      }
    } else {
      this.safetyStates.set(helmetId, {
        status: row.status || 'SAFE',
        primaryTrigger: 'NOMINAL',
        triggerDetails: [],
        outputs: {
          greenLed: row.status === 'SAFE',
          redLed: row.status === 'DANGER',
          buzzer: row.status === 'DANGER',
        },
        isPrototypeNotice: false,
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
    return 'No data recorded';
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
    const allIds = new Set<string>([
      ...this.dbHelmetsList.map((h) => h.id),
      ...registeredIds,
    ]);

    return Array.from(allIds).map((id) => {
      const dbHelmet = this.dbHelmetsList.find((h) => h.id === id);
      const telemetry = this.latestPackets.get(id) || null;
      const hasData = telemetry !== null;
      const dataLoadingState = this.helmetDataLoadingStates.get(id) || 'IDLE';
      const errorMessage = this.helmetErrorStates.get(id) || null;

      // Connectivity status
      let connectivity: ConnectivityStatus = this.connectivityStates.get(id) || 'OFFLINE';
      const isDbOffline = dbHelmet && (dbHelmet.online === false || (dbHelmet as any).is_online === false);
      if (isDbOffline) {
        connectivity = 'OFFLINE';
      } else if (telemetry) {
        connectivity = this.evaluatePacketConnectivity(telemetry.timestamp, Date.now());
      } else if (dbHelmet?.last_seen) {
        connectivity = this.evaluatePacketConnectivity(dbHelmet.last_seen, Date.now());
      } else {
        connectivity = 'OFFLINE';
      }
      this.connectivityStates.set(id, connectivity);

      // Safety status
      const existingSafety = this.safetyStates.get(id);
      let safety: SafetyEvaluationResult = existingSafety || {
        status: (dbHelmet?.status as SafetyStatus) || 'SAFE',
        primaryTrigger: 'NOMINAL',
        triggerDetails: hasData ? ['All parameters normal'] : ['No telemetry recorded'],
        outputs: { greenLed: false, redLed: false, buzzer: false },
        isPrototypeNotice: false,
      };

      const worker = this.zoneProvider.getWorkerByHelmetId(id);
      const currentWorkZone = worker?.currentWorkZone ?? null;
      const assignedZone = worker?.assignedZone || 'Portal / Surface';
      const lastHeartbeat = telemetry?.timestamp || dbHelmet?.last_seen || '';

      const isSimulated = Boolean(telemetry?.isSimulated || telemetry?.packetId?.includes('-SIM-'));

      return {
        helmetId: id,
        serialNumber: `SN-MC8266-${id.replace('MC-', '00')}`,
        firmwareVersion: 'v1.4.2-proto',
        assignedWorkerId: worker?.workerId || dbHelmet?.worker_id || null,
        assignedShaft: currentWorkZone || 'Checked Out',
        assignedZone,
        currentWorkZone,
        connectivity,
        lastHeartbeat,
        telemetry,
        safety,
        hasData,
        dataLoadingState,
        errorMessage,
        telemetrySource: telemetry ? (isSimulated ? 'SIMULATION' : 'DATABASE') : 'NO_DATA',
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

      // Check if helmet still has any active unresolved alerts
      const remainingForHelmet = this.alerts.filter((a) => a.helmetId === alert.helmetId && !a.resolved);
      if (remainingForHelmet.length === 0) {
        const existingSafety = this.safetyStates.get(alert.helmetId);
        if (existingSafety) {
          existingSafety.status = 'SAFE';
          existingSafety.primaryTrigger = 'NOMINAL';
          existingSafety.triggerDetails = [];
          existingSafety.outputs = {
            greenLed: true,
            redLed: false,
            buzzer: false,
          };
        }
      }

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
        this.handleRealtimeTelemetry({
          ...response.telemetry,
          isSimulated: true,
          telemetrySource: 'SIMULATION',
        });
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
}
