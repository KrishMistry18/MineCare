/**
 * MineCare - Production Observability & Metrics Collector
 *
 * Collects runtime API performance metrics, operational safety metrics,
 * and hardware security events in-process without requiring external infrastructure.
 */

import type { IDatabaseRepository } from '../db/repositories/interfaces';
import { StructuredLogger } from '../security/StructuredLogger';

export type DeviceSecurityEventType =
  | 'INVALID_DEVICE_TOKEN'
  | 'REVOKED_DEVICE_TOKEN'
  | 'DEVICE_HELMET_MISMATCH'
  | 'FAILED_LOGIN_ATTEMPT'
  | 'BRUTE_FORCE_SUSPECTED'
  | 'ADMIN_SECURITY_ACTION';

export interface DeviceSecurityEvent {
  timestamp: string;
  eventType: DeviceSecurityEventType;
  details: Record<string, unknown>;
  requestId: string;
  clientIp?: string;
}

export interface ApiMetricsSnapshot {
  totalRequests: number;
  latencies: {
    avgMs: number;
    minMs: number;
    maxMs: number;
    p95Ms: number;
  };
  statusCodes: {
    status2xx: number;
    status4xx: number;
    status5xx: number;
    status401: number;
    status403: number;
    status429: number;
  };
  databaseFailures: number;
  rateLimitEvents: {
    AUTH: number;
    TELEMETRY: number;
    ADMIN: number;
    GENERAL: number;
  };
}

export interface OperationalMetricsSnapshot {
  telemetryPacketsReceived: number;
  telemetryValidationFailures: number;
  activeHelmets: number;
  helmetsByConnectivity: {
    online: number;
    stale: number;
    offline: number;
  };
  activeAlerts: number;
  alertsCreated: number;
  alertsResolved: number;
  hazardEvents: {
    sosEvents: number;
    fallEvents: number;
    gasWarnings: number;
    temperatureWarnings: number;
  };
}

export interface SecurityMetricsSnapshot {
  invalidDeviceCredentialsCount: number;
  revokedDeviceAttemptsCount: number;
  helmetDeviceMismatchCount: number;
  repeatedAuthFailuresCount: number;
  adminSecurityActionsCount: number;
  recentSecurityEvents: DeviceSecurityEvent[];
}

export interface MetricsSnapshot {
  timestamp: string;
  uptimeSeconds: number;
  api: ApiMetricsSnapshot;
  operational: OperationalMetricsSnapshot;
  security: SecurityMetricsSnapshot;
  system: {
    memoryUsageBytes: NodeJS.MemoryUsage;
    nodeVersion: string;
  };
}

export class MetricsCollector {
  private static instance: MetricsCollector | null = null;
  private startTime: number = Date.now();

  // API Metrics
  private totalRequests: number = 0;
  private latencySamples: number[] = [];
  private status2xx: number = 0;
  private status4xx: number = 0;
  private status5xx: number = 0;
  private status401: number = 0;
  private status403: number = 0;
  private status429: number = 0;
  private databaseFailures: number = 0;
  private rateLimitEvents = {
    AUTH: 0,
    TELEMETRY: 0,
    ADMIN: 0,
    GENERAL: 0,
  };

  // Operational Metrics
  private telemetryPacketsReceived: number = 0;
  private telemetryValidationFailures: number = 0;
  private alertsCreated: number = 0;
  private alertsResolved: number = 0;
  private sosEvents: number = 0;
  private fallEvents: number = 0;
  private gasWarnings: number = 0;
  private temperatureWarnings: number = 0;

  // Security Metrics
  private invalidDeviceCredentialsCount: number = 0;
  private revokedDeviceAttemptsCount: number = 0;
  private helmetDeviceMismatchCount: number = 0;
  private repeatedAuthFailuresCount: number = 0;
  private adminSecurityActionsCount: number = 0;
  private recentSecurityEvents: DeviceSecurityEvent[] = [];

  private constructor() {}

  public static getInstance(): MetricsCollector {
    if (!MetricsCollector.instance) {
      MetricsCollector.instance = new MetricsCollector();
    }
    return MetricsCollector.instance;
  }

  public static resetInstance(): void {
    if (MetricsCollector.instance) {
      MetricsCollector.instance.reset();
      MetricsCollector.instance = null;
    }
  }

  public reset(): void {
    this.totalRequests = 0;
    this.latencySamples = [];
    this.status2xx = 0;
    this.status4xx = 0;
    this.status5xx = 0;
    this.status401 = 0;
    this.status403 = 0;
    this.status429 = 0;
    this.databaseFailures = 0;
    this.rateLimitEvents = { AUTH: 0, TELEMETRY: 0, ADMIN: 0, GENERAL: 0 };
    this.telemetryPacketsReceived = 0;
    this.telemetryValidationFailures = 0;
    this.alertsCreated = 0;
    this.alertsResolved = 0;
    this.sosEvents = 0;
    this.fallEvents = 0;
    this.gasWarnings = 0;
    this.temperatureWarnings = 0;
    this.invalidDeviceCredentialsCount = 0;
    this.revokedDeviceAttemptsCount = 0;
    this.helmetDeviceMismatchCount = 0;
    this.repeatedAuthFailuresCount = 0;
    this.adminSecurityActionsCount = 0;
    this.recentSecurityEvents = [];
    this.startTime = Date.now();
  }

  // --- API Request Tracking ---

  public recordRequest(_method: string, _route: string, statusCode: number, durationMs: number): void {
    this.totalRequests++;

    // Track latency sample (bounded to last 1000 samples)
    this.latencySamples.push(durationMs);
    if (this.latencySamples.length > 1000) {
      this.latencySamples.shift();
    }

    // Status code bucketing
    if (statusCode >= 200 && statusCode < 300) {
      this.status2xx++;
    } else if (statusCode >= 400 && statusCode < 500) {
      this.status4xx++;
      if (statusCode === 401) this.status401++;
      if (statusCode === 403) this.status403++;
      if (statusCode === 429) this.status429++;
    } else if (statusCode >= 500) {
      this.status5xx++;
    }
  }

  public recordDatabaseFailure(operation?: string, error?: unknown): void {
    this.databaseFailures++;
    StructuredLogger.warn({
      requestId: 'db-failure',
      message: `Database failure during ${operation || 'operation'}`,
      meta: { error: error instanceof Error ? error.message : String(error) },
    });
  }

  public recordRateLimitEvent(tier: 'AUTH' | 'TELEMETRY' | 'ADMIN' | 'GENERAL', identifier?: string): void {
    this.rateLimitEvents[tier]++;
    if (tier === 'AUTH') {
      this.recordDeviceSecurityEvent(
        'BRUTE_FORCE_SUSPECTED',
        { tier, identifier: identifier ? String(StructuredLogger.redact(identifier)) : 'unknown' },
        'rate-limit'
      );
    }
  }

  // --- Operational Safety Tracking ---

  public recordTelemetryPacket(_packetId: string, _helmetId: string): void {
    this.telemetryPacketsReceived++;
  }

  public recordTelemetryValidationFailure(_reason: string, details?: unknown): void {
    this.telemetryValidationFailures++;
    StructuredLogger.warn({
      requestId: 'telemetry-val-fail',
      message: 'Telemetry payload validation failed',
      meta: { details },
    });
  }

  public recordAlertCreated(_alertId: string, _helmetId: string, _type: string, _severity: string): void {
    this.alertsCreated++;
  }

  public recordAlertResolved(_alertId: string): void {
    this.alertsResolved++;
  }

  public recordHazardEvent(hazardType: 'SOS' | 'FALL' | 'GAS' | 'TEMPERATURE', _helmetId: string): void {
    switch (hazardType) {
      case 'SOS':
        this.sosEvents++;
        break;
      case 'FALL':
        this.fallEvents++;
        break;
      case 'GAS':
        this.gasWarnings++;
        break;
      case 'TEMPERATURE':
        this.temperatureWarnings++;
        break;
    }
  }

  // --- Device Security Observability ---

  public recordDeviceSecurityEvent(
    eventType: DeviceSecurityEventType,
    details: Record<string, unknown>,
    requestId: string,
    clientIp?: string
  ): void {
    const sanitizedDetails = StructuredLogger.redact(details) as Record<string, unknown>;

    switch (eventType) {
      case 'INVALID_DEVICE_TOKEN':
        this.invalidDeviceCredentialsCount++;
        break;
      case 'REVOKED_DEVICE_TOKEN':
        this.revokedDeviceAttemptsCount++;
        break;
      case 'DEVICE_HELMET_MISMATCH':
        this.helmetDeviceMismatchCount++;
        break;
      case 'FAILED_LOGIN_ATTEMPT':
      case 'BRUTE_FORCE_SUSPECTED':
        this.repeatedAuthFailuresCount++;
        break;
      case 'ADMIN_SECURITY_ACTION':
        this.adminSecurityActionsCount++;
        break;
    }

    const event: DeviceSecurityEvent = {
      timestamp: new Date().toISOString(),
      eventType,
      details: sanitizedDetails,
      requestId: requestId || 'sec-req',
      clientIp,
    };

    this.recentSecurityEvents.push(event);
    if (this.recentSecurityEvents.length > 200) {
      this.recentSecurityEvents.shift();
    }

    StructuredLogger.warn({
      requestId: event.requestId,
      message: `Security Event: ${eventType}`,
      meta: { eventType, details: sanitizedDetails, clientIp },
    });
  }

  // --- Snapshot Generation ---

  public async getSnapshot(db?: IDatabaseRepository): Promise<MetricsSnapshot> {
    // Compute latency percentiles
    let avgMs = 0;
    let minMs = 0;
    let maxMs = 0;
    let p95Ms = 0;

    if (this.latencySamples.length > 0) {
      const sum = this.latencySamples.reduce((a, b) => a + b, 0);
      avgMs = Math.round((sum / this.latencySamples.length) * 100) / 100;
      minMs = Math.min(...this.latencySamples);
      maxMs = Math.max(...this.latencySamples);

      const sorted = [...this.latencySamples].sort((a, b) => a - b);
      const p95Idx = Math.floor(sorted.length * 0.95);
      p95Ms = sorted[Math.min(p95Idx, sorted.length - 1)];
    }

    // Default helmet & alert operational counts
    let activeHelmets = 16;
    let onlineCount = 16;
    let staleCount = 0;
    let offlineCount = 0;
    let activeAlerts = Math.max(0, this.alertsCreated - this.alertsResolved);

    if (db) {
      try {
        const helmets = await db.getHelmets();
        activeHelmets = helmets.length;
        onlineCount = helmets.filter((h) => h.online).length;
        offlineCount = helmets.filter((h) => !h.online).length;

        const alerts = await db.getAlertsStore();
        activeAlerts = alerts.filter((a) => a.status !== 'RESOLVED').length;
      } catch {
        // Fall back to accumulated counts if db is unavailable
      }
    }

    return {
      timestamp: new Date().toISOString(),
      uptimeSeconds: Math.floor((Date.now() - this.startTime) / 1000),
      api: {
        totalRequests: this.totalRequests,
        latencies: {
          avgMs,
          minMs,
          maxMs,
          p95Ms,
        },
        statusCodes: {
          status2xx: this.status2xx,
          status4xx: this.status4xx,
          status5xx: this.status5xx,
          status401: this.status401,
          status403: this.status403,
          status429: this.status429,
        },
        databaseFailures: this.databaseFailures,
        rateLimitEvents: { ...this.rateLimitEvents },
      },
      operational: {
        telemetryPacketsReceived: this.telemetryPacketsReceived,
        telemetryValidationFailures: this.telemetryValidationFailures,
        activeHelmets,
        helmetsByConnectivity: {
          online: onlineCount,
          stale: staleCount,
          offline: offlineCount,
        },
        activeAlerts,
        alertsCreated: this.alertsCreated,
        alertsResolved: this.alertsResolved,
        hazardEvents: {
          sosEvents: this.sosEvents,
          fallEvents: this.fallEvents,
          gasWarnings: this.gasWarnings,
          temperatureWarnings: this.temperatureWarnings,
        },
      },
      security: {
        invalidDeviceCredentialsCount: this.invalidDeviceCredentialsCount,
        revokedDeviceAttemptsCount: this.revokedDeviceAttemptsCount,
        helmetDeviceMismatchCount: this.helmetDeviceMismatchCount,
        repeatedAuthFailuresCount: this.repeatedAuthFailuresCount,
        adminSecurityActionsCount: this.adminSecurityActionsCount,
        recentSecurityEvents: [...this.recentSecurityEvents],
      },
      system: {
        memoryUsageBytes: process.memoryUsage(),
        nodeVersion: process.version,
      },
    };
  }
}
