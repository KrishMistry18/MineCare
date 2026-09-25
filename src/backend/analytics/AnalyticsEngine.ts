/**
 * MineCare - Historical Analytics & Intelligence Engine
 *
 * Implements authoritative server-side analytics, time bucketing,
 * statistical aggregation, safety evaluation, alert distribution,
 * zone occupancy history, and RBAC enforcement.
 *
 * IMPORTANT PRINCIPLES:
 * 1. Uses actual persisted telemetry, alerts, and zone assignments.
 * 2. Does NOT fabricate historical data, safety durations, or uptime percentages.
 * 3. Does NOT send huge raw datasets to the frontend; uses intelligent time-bucketing.
 * 4. Strictly enforces RBAC: Worker role only accesses their own permitted data.
 */

import type {
  DbTelemetry,
  DbAlert,
  DbZoneAssignment,
  DbHelmet,
  DbWorker,
  UserRole,
} from '../types';

export type TimeRangeValidation =
  | {
      valid: true;
      from: string;
      to: string;
      fromMs: number;
      toMs: number;
      durationMs: number;
      error?: undefined;
    }
  | {
      valid: false;
      error: string;
      from?: undefined;
      to?: undefined;
      fromMs?: undefined;
      toMs?: undefined;
      durationMs?: undefined;
    };

export interface MetricSummary {
  min: number | null;
  max: number | null;
  avg: number | null;
  latest: number | null;
  unit: string;
  threshold?: number;
}

export interface TelemetryAnalyticsResult {
  hasData: boolean;
  packetCount: number;
  message?: string;
  metrics: {
    temperature: MetricSummary;
    humidity: MetricSummary;
    gas: MetricSummary;
    acceleration: MetricSummary & {
      latestX: number | null;
      latestY: number | null;
      latestZ: number | null;
    };
    gyroscope: {
      latestX: number | null;
      latestY: number | null;
      latestZ: number | null;
      unit: string;
    };
  } | null;
  safetyBreakdown: {
    safePackets: number;
    warningPackets: number;
    dangerPackets: number;
    safePercentage: number;
    warningPercentage: number;
    dangerPercentage: number;
  } | null;
  trend: Array<{
    timestamp: string;
    timeFormatted: string;
    temperature: number;
    humidity: number;
    rawGasValue: number;
    totalAcceleration: number;
    accelX: number;
    accelY: number;
    accelZ: number;
    safetyStatus: string;
  }>;
}

export interface AlertAnalyticsResult {
  totalAlerts: number;
  activeAlerts: number;
  acknowledgedAlerts: number;
  resolvedAlerts: number;
  byType: Record<string, number>;
  bySeverity: Record<string, number>;
  byStatus: Record<string, number>;
  timeline: DbAlert[];
  timeBuckets: Array<{
    bucketStart: string;
    timeFormatted: string;
    count: number;
    criticalCount: number;
    warningCount: number;
  }>;
}

export interface ZoneAnalyticsSummary {
  zoneId: string;
  zoneName: string;
  level: string;
  depthMeters: number;
  uniqueWorkerCount: number;
  activeWorkerCount: number;
  checkInCount: number;
  alertCount: number;
  recentAssignments: DbZoneAssignment[];
}

export interface ConnectivityAnalyticsResult {
  currentFleetStatus: {
    online: number;
    stale: number;
    offline: number;
    total: number;
  };
  totalOfflineEventsInPeriod: number;
  interruptedHelmets: Array<{
    helmetId: string;
    workerName: string | null;
    offlineIncidentCount: number;
    lastSeen: string;
    currentConnectivity: string;
  }>;
  uptimePercentage: number | null;
  uptimeLimitationNotice: string;
}

export interface AnalyticsOverviewResult {
  timeRange: {
    from: string;
    to: string;
    durationHours: number;
  };
  kpi: {
    totalPackets: number;
    totalAlerts: number;
    activeAlerts: number;
    dangerEvents: number;
    warningEvents: number;
    avgTemperature: number | null;
    avgHumidity: number | null;
    avgRawGas: number | null;
    offlineHelmetCount: number;
  };
  telemetry: TelemetryAnalyticsResult;
  alerts: AlertAnalyticsResult;
  zones: ZoneAnalyticsSummary[];
  connectivity: ConnectivityAnalyticsResult;
  activeFilters: {
    helmetId?: string;
    workerId?: string;
    zoneId?: string;
  };
}

export class AnalyticsEngine {
  /**
   * Validate requested time range server-side.
   * Maximum span: 31 days.
   * from must be strictly before to.
   */
  public static validateTimeRange(
    fromParam?: string | null,
    toParam?: string | null
  ): TimeRangeValidation {
    const now = Date.now();

    // Default: Last 24 hours
    if (!fromParam && !toParam) {
      const toDate = new Date(now);
      const fromDate = new Date(now - 24 * 60 * 60 * 1000);
      return {
        valid: true,
        from: fromDate.toISOString(),
        to: toDate.toISOString(),
        fromMs: fromDate.getTime(),
        toMs: toDate.getTime(),
        durationMs: 24 * 60 * 60 * 1000,
      };
    }

    if (!fromParam || !toParam) {
      return {
        valid: false,
        error: 'Both "from" and "to" parameters must be specified when querying a custom time range.',
      };
    }

    const fromDate = new Date(fromParam);
    const toDate = new Date(toParam);

    if (isNaN(fromDate.getTime()) || isNaN(toDate.getTime())) {
      return {
        valid: false,
        error: 'Invalid date format. "from" and "to" must be valid ISO 8601 timestamps.',
      };
    }

    const fromMs = fromDate.getTime();
    const toMs = toDate.getTime();

    if (fromMs >= toMs) {
      return {
        valid: false,
        error: 'Invalid range: "from" timestamp must be earlier than "to" timestamp.',
      };
    }

    const durationMs = toMs - fromMs;
    const maxSpanMs = 31 * 24 * 60 * 60 * 1000 + 60 * 1000; // 31 days + 1 min tolerance

    if (durationMs > maxSpanMs) {
      return {
        valid: false,
        error: 'Range exceeds maximum allowable window of 31 days.',
      };
    }

    // Protect against distant future queries
    if (toMs > now + 10 * 60 * 1000) {
      return {
        valid: false,
        error: '"to" timestamp cannot be in the future.',
      };
    }

    return {
      valid: true,
      from: fromDate.toISOString(),
      to: toDate.toISOString(),
      fromMs,
      toMs,
      durationMs,
    };
  }

  /**
   * Check RBAC permission for analytics query
   */
  public static verifyRbacAccess(
    role: UserRole,
    userWorkerId: string | null,
    assignedHelmetId: string | null,
    requestedWorkerId?: string | null,
    requestedHelmetId?: string | null
  ): { allowed: boolean; effectiveWorkerId?: string; effectiveHelmetId?: string; error?: string } {
    if (role === 'ADMIN' || role === 'SUPERVISOR') {
      return {
        allowed: true,
        effectiveWorkerId: requestedWorkerId || undefined,
        effectiveHelmetId: requestedHelmetId || undefined,
      };
    }

    if (role === 'WORKER') {
      if (!userWorkerId) {
        return { allowed: false, error: 'Forbidden: Worker user profile is not linked to a worker ID.' };
      }

      // If specific workerId was requested, it must be their own
      if (requestedWorkerId && requestedWorkerId !== userWorkerId) {
        return { allowed: false, error: 'Forbidden: Workers may only access their own personal analytics.' };
      }

      // If specific helmetId was requested, it must be their assigned helmet
      if (requestedHelmetId && assignedHelmetId && requestedHelmetId !== assignedHelmetId) {
        return { allowed: false, error: 'Forbidden: Workers may only access their assigned helmet analytics.' };
      }

      // Automatically scope worker to their own ID and helmet
      return {
        allowed: true,
        effectiveWorkerId: userWorkerId,
        effectiveHelmetId: assignedHelmetId || undefined,
      };
    }

    return { allowed: false, error: 'Forbidden: Unrecognized role.' };
  }

  /**
   * Process Telemetry into statistical aggregates and bucketed chart points
   */
  public static computeTelemetryAnalytics(
    packets: DbTelemetry[],
    fromMs: number,
    toMs: number
  ): TelemetryAnalyticsResult {
    if (!packets || packets.length === 0) {
      return {
        hasData: false,
        packetCount: 0,
        message: 'No telemetry recorded for this period.',
        metrics: null,
        safetyBreakdown: null,
        trend: [],
      };
    }

    // Sort chronologically
    const sorted = [...packets].sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());

    let minTemp = Infinity;
    let maxTemp = -Infinity;
    let sumTemp = 0;

    let minHum = Infinity;
    let maxHum = -Infinity;
    let sumHum = 0;

    let minGas = Infinity;
    let maxGas = -Infinity;
    let sumGas = 0;

    let minAccel = Infinity;
    let maxAccel = -Infinity;
    let sumAccel = 0;

    let safeCount = 0;
    let warningCount = 0;
    let dangerCount = 0;

    sorted.forEach((p) => {
      const temp = Number(p.temperature);
      const hum = Number(p.humidity);
      const gas = Number(p.gas_value);
      const accel = Number(p.total_acceleration);

      if (temp < minTemp) minTemp = temp;
      if (temp > maxTemp) maxTemp = temp;
      sumTemp += temp;

      if (hum < minHum) minHum = hum;
      if (hum > maxHum) maxHum = hum;
      sumHum += hum;

      if (gas < minGas) minGas = gas;
      if (gas > maxGas) maxGas = gas;
      sumGas += gas;

      if (accel < minAccel) minAccel = accel;
      if (accel > maxAccel) maxAccel = accel;
      sumAccel += accel;

      if (p.safety_status === 'DANGER') dangerCount++;
      else if (p.safety_status === 'WARNING') warningCount++;
      else safeCount++;
    });

    const n = sorted.length;
    const latest = sorted[sorted.length - 1];

    const round1 = (val: number) => Math.round(val * 10) / 10;
    const round0 = (val: number) => Math.round(val);

    const metrics = {
      temperature: {
        min: round1(minTemp),
        max: round1(maxTemp),
        avg: round1(sumTemp / n),
        latest: round1(Number(latest.temperature)),
        unit: '°C',
        threshold: 40.0,
      },
      humidity: {
        min: round1(minHum),
        max: round1(maxHum),
        avg: round1(sumHum / n),
        latest: round1(Number(latest.humidity)),
        unit: '%',
      },
      gas: {
        min: round0(minGas),
        max: round0(maxGas),
        avg: round0(sumGas / n),
        latest: round0(Number(latest.gas_value)),
        unit: 'ADC (0-1023 RAW)',
        threshold: 800,
      },
      acceleration: {
        min: round1(minAccel),
        max: round1(maxAccel),
        avg: round1(sumAccel / n),
        latest: round1(Number(latest.total_acceleration)),
        latestX: round1(Number(latest.acceleration_x)),
        latestY: round1(Number(latest.acceleration_y)),
        latestZ: round1(Number(latest.acceleration_z)),
        unit: 'm/s²',
        threshold: 15.0,
      },
      gyroscope: {
        latestX: round1(Number(latest.gyro_x)),
        latestY: round1(Number(latest.gyro_y)),
        latestZ: round1(Number(latest.gyro_z)),
        unit: '°/s',
      },
    };

    const safetyBreakdown = {
      safePackets: safeCount,
      warningPackets: warningCount,
      dangerPackets: dangerCount,
      safePercentage: round1((safeCount / n) * 100),
      warningPercentage: round1((warningCount / n) * 100),
      dangerPercentage: round1((dangerCount / n) * 100),
    };

    // Time-bucketing downsampling for chart rendering:
    // If <= 100 points, keep all. If > 100 points, group into ~60 buckets.
    const trend = AnalyticsEngine.downsampleTelemetry(sorted, fromMs, toMs, 60);

    return {
      hasData: true,
      packetCount: n,
      metrics,
      safetyBreakdown,
      trend,
    };
  }

  /**
   * Intelligently bucket telemetry to keep client charts responsive and payload lean
   */
  private static downsampleTelemetry(
    sorted: DbTelemetry[],
    fromMs: number,
    toMs: number,
    targetBuckets: number
  ): Array<{
    timestamp: string;
    timeFormatted: string;
    temperature: number;
    humidity: number;
    rawGasValue: number;
    totalAcceleration: number;
    accelX: number;
    accelY: number;
    accelZ: number;
    safetyStatus: string;
  }> {
    if (sorted.length <= 100) {
      return sorted.map((p) => {
        const d = new Date(p.timestamp);
        return {
          timestamp: p.timestamp,
          timeFormatted: d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
          temperature: Number(p.temperature),
          humidity: Number(p.humidity),
          rawGasValue: Number(p.gas_value),
          totalAcceleration: Number(p.total_acceleration),
          accelX: Number(p.acceleration_x),
          accelY: Number(p.acceleration_y),
          accelZ: Number(p.acceleration_z),
          safetyStatus: p.safety_status,
        };
      });
    }

    const duration = toMs - fromMs;
    const bucketSize = duration / targetBuckets;
    const buckets: Array<DbTelemetry[]> = Array.from({ length: targetBuckets }, () => []);

    sorted.forEach((p) => {
      const t = new Date(p.timestamp).getTime();
      let index = Math.floor((t - fromMs) / bucketSize);
      if (index < 0) index = 0;
      if (index >= targetBuckets) index = targetBuckets - 1;
      buckets[index].push(p);
    });

    const result: Array<{
      timestamp: string;
      timeFormatted: string;
      temperature: number;
      humidity: number;
      rawGasValue: number;
      totalAcceleration: number;
      accelX: number;
      accelY: number;
      accelZ: number;
      safetyStatus: string;
    }> = [];

    buckets.forEach((group, idx) => {
      if (group.length === 0) return;

      const bucketCenterMs = fromMs + idx * bucketSize + bucketSize / 2;
      const bucketDate = new Date(bucketCenterMs);

      let sumTemp = 0;
      let sumHum = 0;
      let sumGas = 0;
      let maxAccel = 0;
      let sumX = 0;
      let sumY = 0;
      let sumZ = 0;
      let hasDanger = false;
      let hasWarning = false;

      group.forEach((item) => {
        sumTemp += Number(item.temperature);
        sumHum += Number(item.humidity);
        sumGas += Number(item.gas_value);
        const a = Number(item.total_acceleration);
        if (a > maxAccel) maxAccel = a;
        sumX += Number(item.acceleration_x);
        sumY += Number(item.acceleration_y);
        sumZ += Number(item.acceleration_z);
        if (item.safety_status === 'DANGER') hasDanger = true;
        if (item.safety_status === 'WARNING') hasWarning = true;
      });

      const count = group.length;
      const status = hasDanger ? 'DANGER' : hasWarning ? 'WARNING' : 'SAFE';

      result.push({
        timestamp: bucketDate.toISOString(),
        timeFormatted: bucketDate.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        temperature: Math.round((sumTemp / count) * 10) / 10,
        humidity: Math.round((sumHum / count) * 10) / 10,
        rawGasValue: Math.round(sumGas / count),
        totalAcceleration: Math.round(maxAccel * 10) / 10,
        accelX: Math.round((sumX / count) * 10) / 10,
        accelY: Math.round((sumY / count) * 10) / 10,
        accelZ: Math.round((sumZ / count) * 10) / 10,
        safetyStatus: status,
      });
    });

    return result;
  }

  /**
   * Process Alerts into category breakdowns and time distributions
   */
  public static computeAlertAnalytics(
    alerts: DbAlert[],
    fromMs: number,
    toMs: number
  ): AlertAnalyticsResult {
    const byType: Record<string, number> = {
      GAS_HAZARD: 0,
      HEAT_STRESS: 0,
      WORKER_FALL: 0,
      SOS_EMERGENCY: 0,
      HELMET_OFFLINE: 0,
    };
    const bySeverity: Record<string, number> = {
      CRITICAL: 0,
      WARNING: 0,
      INFO: 0,
    };
    const byStatus: Record<string, number> = {
      TRIGGERED: 0,
      ACKNOWLEDGED: 0,
      RESOLVED: 0,
    };

    let activeAlerts = 0;
    let acknowledgedAlerts = 0;
    let resolvedAlerts = 0;

    alerts.forEach((a) => {
      byType[a.type] = (byType[a.type] || 0) + 1;
      bySeverity[a.severity] = (bySeverity[a.severity] || 0) + 1;
      byStatus[a.status] = (byStatus[a.status] || 0) + 1;

      if (a.status === 'TRIGGERED') activeAlerts++;
      else if (a.status === 'ACKNOWLEDGED') acknowledgedAlerts++;
      else if (a.status === 'RESOLVED') resolvedAlerts++;
    });

    // Time buckets (e.g. 12 buckets across the window)
    const numBuckets = 12;
    const duration = toMs - fromMs;
    const bucketDuration = duration / numBuckets;

    const timeBuckets: Array<{
      bucketStart: string;
      timeFormatted: string;
      count: number;
      criticalCount: number;
      warningCount: number;
    }> = [];

    for (let i = 0; i < numBuckets; i++) {
      const bStart = fromMs + i * bucketDuration;
      const bEnd = bStart + bucketDuration;
      const d = new Date(bStart);

      const inBucket = alerts.filter((a) => {
        const t = new Date(a.triggered_at).getTime();
        return t >= bStart && t < bEnd;
      });

      timeBuckets.push({
        bucketStart: d.toISOString(),
        timeFormatted: d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        count: inBucket.length,
        criticalCount: inBucket.filter((a) => a.severity === 'CRITICAL').length,
        warningCount: inBucket.filter((a) => a.severity === 'WARNING').length,
      });
    }

    // Sort timeline chronologically descending (most recent first)
    const timeline = [...alerts].sort(
      (a, b) => new Date(b.triggered_at).getTime() - new Date(a.triggered_at).getTime()
    );

    return {
      totalAlerts: alerts.length,
      activeAlerts,
      acknowledgedAlerts,
      resolvedAlerts,
      byType,
      bySeverity,
      byStatus,
      timeline: timeline.slice(0, 50),
      timeBuckets,
    };
  }

  /**
   * Process Zone Occupancy & Activity History
   */
  public static computeZoneAnalytics(
    zones: Array<{ id: string; name: string; level: string; depth_meters: number }>,
    assignments: DbZoneAssignment[],
    alerts: DbAlert[],
    _workers: DbWorker[],
    fromMs: number,
    toMs: number
  ): ZoneAnalyticsSummary[] {
    return zones.map((z) => {
      // Find assignments overlapping this time window
      const zoneAssignments = assignments.filter((a) => {
        if (a.zone_id !== z.id && a.zone_id !== z.id.replace(/^zone-/, '')) return false;
        const checkIn = new Date(a.checked_in_at).getTime();
        const checkOut = a.checked_out_at ? new Date(a.checked_out_at).getTime() : Infinity;
        return checkIn <= toMs && checkOut >= fromMs;
      });

      // Unique workers checked into this zone in window
      const uniqueWorkerIds = new Set(zoneAssignments.map((a) => a.worker_id));
      const activeWorkers = zoneAssignments.filter((a) => a.active).length;

      // Find alerts that occurred for workers assigned to this zone
      const zoneAlerts = alerts.filter((a) => a.worker_id && uniqueWorkerIds.has(a.worker_id));

      return {
        zoneId: z.id,
        zoneName: z.name,
        level: z.level,
        depthMeters: z.depth_meters,
        uniqueWorkerCount: uniqueWorkerIds.size,
        activeWorkerCount: activeWorkers,
        checkInCount: zoneAssignments.length,
        alertCount: zoneAlerts.length,
        recentAssignments: zoneAssignments.slice(0, 10),
      };
    });
  }

  /**
   * Compute Connectivity & Offline Analytics
   * Strictly avoids fabricating uptime percentages.
   */
  public static computeConnectivityAnalytics(
    helmets: DbHelmet[],
    alerts: DbAlert[],
    workers: DbWorker[],
    fromMs: number,
    toMs: number
  ): ConnectivityAnalyticsResult {
    let onlineCount = 0;
    let staleCount = 0;
    let offlineCount = 0;

    const now = Date.now();
    helmets.forEach((h) => {
      const elapsedSec = (now - new Date(h.last_seen).getTime()) / 1000;
      if (!h.online || elapsedSec > 8) {
        offlineCount++;
      } else if (elapsedSec > 4) {
        staleCount++;
      } else {
        onlineCount++;
      }
    });

    // Offline incidents in the window
    const offlineAlerts = alerts.filter(
      (a) => a.type === 'HELMET_OFFLINE' && new Date(a.triggered_at).getTime() >= fromMs && new Date(a.triggered_at).getTime() <= toMs
    );

    // Group by helmet
    const helmetOfflineMap = new Map<string, number>();
    offlineAlerts.forEach((a) => {
      helmetOfflineMap.set(a.helmet_id, (helmetOfflineMap.get(a.helmet_id) || 0) + 1);
    });

    const interruptedHelmets = Array.from(helmetOfflineMap.entries()).map(([helmetId, incidentCount]) => {
      const h = helmets.find((item) => item.id === helmetId);
      const w = h && h.worker_id ? workers.find((item) => item.id === h.worker_id) : null;
      const elapsedSec = h ? (now - new Date(h.last_seen).getTime()) / 1000 : Infinity;
      const state = !h || !h.online || elapsedSec > 8 ? 'OFFLINE' : elapsedSec > 4 ? 'STALE' : 'ONLINE';

      return {
        helmetId,
        workerName: w?.name || null,
        offlineIncidentCount: incidentCount,
        lastSeen: h?.last_seen || '',
        currentConnectivity: state,
      };
    });

    return {
      currentFleetStatus: {
        online: onlineCount,
        stale: staleCount,
        offline: offlineCount,
        total: helmets.length,
      },
      totalOfflineEventsInPeriod: offlineAlerts.length,
      interruptedHelmets,
      uptimePercentage: null, // Strictly null: Avoids unvalidated fabrication
      uptimeLimitationNotice:
        'Uptime percentage cannot be mathematically certified from prototype heartbeat packets without carrier-grade connection logs. Actual recorded offline events are listed above.',
    };
  }
}
