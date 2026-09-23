/**
 * MineCare - Backend API Dispatcher & Router
 *
 * Exposes the complete versioned REST API (/api/v1/*):
 * - Telemetry Ingestion (Validation -> Storage -> SafetyEngine -> AlertEngine)
 * - Helmets & Telemetry History
 * - Workers & Zone Check-In / Check-Out
 * - Mine Zones & Occupancy
 * - Alerts Management & Lifecycle
 * - System Health Diagnostics
 */

import type { IncomingMessage, ServerResponse } from 'http';
import { DatabaseRepository } from './db/DatabaseRepository';
import { TelemetryValidator } from './validation/TelemetryValidator';
import { SafetyEngine } from './safety/SafetyEngine';
import { AlertEngine } from './alerts/AlertEngine';
import { OfflineEngine } from './offline/OfflineEngine';
import type { DbTelemetry } from './types';

export class BackendApp {
  private static instance: BackendApp | null = null;
  private db: DatabaseRepository;

  private constructor() {
    this.db = DatabaseRepository.getInstance();

    // Check offline heartbeats every 3 seconds
    if (typeof setInterval !== 'undefined') {
      setInterval(() => {
        const helmets = this.db.getHelmets();
        const alerts = this.db.getAlertsStore();
        OfflineEngine.checkFleetHeartbeats(helmets, alerts);
      }, 3000);
    }
  }

  public static getInstance(): BackendApp {
    if (!BackendApp.instance) {
      BackendApp.instance = new BackendApp();
    }
    return BackendApp.instance;
  }

  public getDb(): DatabaseRepository {
    return this.db;
  }

  /**
   * Universal HTTP Dispatcher handling standard Node/Vite/Express requests
   */
  public async handleRequest(req: IncomingMessage, res: ServerResponse): Promise<boolean> {
    const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
    const pathname = url.pathname;
    const method = req.method?.toUpperCase() || 'GET';

    // CORS Headers for safety
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

    if (method === 'OPTIONS') {
      res.statusCode = 204;
      res.end();
      return true;
    }

    if (!pathname.startsWith('/api/v1/')) {
      return false; // Not handled by API router
    }

    try {
      // 1. POST /api/v1/telemetry
      if (pathname === '/api/v1/telemetry' && method === 'POST') {
        const body = await this.readJsonBody(req);
        const validation = TelemetryValidator.validate(body);

        if (!validation.isValid || !validation.packet) {
          this.sendJson(res, 400, { error: 'Validation Failed', details: validation.errors });
          return true;
        }

        const packet = validation.packet;

        // Run Authoritative Safety Evaluation
        const safety = SafetyEngine.evaluate({
          temperature: packet.temperature,
          gasValue: packet.gasValue,
          totalAcceleration: packet.totalAcceleration,
          sosPressed: packet.sosPressed,
        });

        // Persist Telemetry Record
        const telemetryRecord: DbTelemetry = {
          id: packet.packetId,
          helmet_id: packet.helmetId,
          timestamp: packet.timestamp,
          sequence_number: packet.sequenceNumber,
          temperature: packet.temperature,
          humidity: packet.humidity,
          gas_value: packet.gasValue,
          acceleration_x: packet.accelX,
          acceleration_y: packet.accelY,
          acceleration_z: packet.accelZ,
          total_acceleration: packet.totalAcceleration,
          gyro_x: packet.gyroX,
          gyro_y: packet.gyroY,
          gyro_z: packet.gyroZ,
          fall_detected: packet.fallDetected,
          sos_pressed: packet.sosPressed,
          safety_status: safety.status,
          created_at: new Date().toISOString(),
        };

        this.db.saveTelemetry(telemetryRecord);

        // Run Authoritative Alert Lifecycle
        const helmet = this.db.getHelmet(packet.helmetId);
        const alertResult = AlertEngine.processAlerts(
          this.db.getAlertsStore(),
          packet.helmetId,
          helmet?.worker_id || null,
          packet,
          safety
        );

        this.sendJson(res, 201, {
          success: true,
          packetId: packet.packetId,
          safety: {
            status: safety.status,
            primaryTrigger: safety.primaryTrigger,
            triggerDetails: safety.triggerDetails,
            outputs: safety.outputs,
          },
          alertCreated: Boolean(alertResult.createdAlert),
          alertsResolvedCount: alertResult.resolvedAlerts.length,
        });
        return true;
      }

      // 2. HELMETS ENDPOINTS
      // GET /api/v1/helmets
      if (pathname === '/api/v1/helmets' && method === 'GET') {
        const helmets = this.db.getHelmets();
        this.sendJson(res, 200, helmets);
        return true;
      }

      // GET /api/v1/helmets/:id/latest
      const helmetLatestMatch = pathname.match(/^\/api\/v1\/helmets\/([^/]+)\/latest$/);
      if (helmetLatestMatch && method === 'GET') {
        const helmetId = helmetLatestMatch[1];
        const latest = this.db.getLatestTelemetry(helmetId);
        if (!latest) {
          this.sendJson(res, 404, { error: `No telemetry recorded for helmet ${helmetId}` });
        } else {
          this.sendJson(res, 200, latest);
        }
        return true;
      }

      // GET /api/v1/helmets/:id/history
      const helmetHistoryMatch = pathname.match(/^\/api\/v1\/helmets\/([^/]+)\/history$/);
      if (helmetHistoryMatch && method === 'GET') {
        const helmetId = helmetHistoryMatch[1];
        const limit = Number(url.searchParams.get('limit') || 50);
        const history = this.db.getTelemetryHistory(helmetId, limit);
        this.sendJson(res, 200, history);
        return true;
      }

      // GET /api/v1/helmets/:id
      const helmetMatch = pathname.match(/^\/api\/v1\/helmets\/([^/]+)$/);
      if (helmetMatch && method === 'GET') {
        const helmetId = helmetMatch[1];
        const helmet = this.db.getHelmets().find((h) => h.id === helmetId || h.helmet_code === helmetId);
        if (!helmet) {
          this.sendJson(res, 404, { error: `Helmet ${helmetId} not found` });
        } else {
          this.sendJson(res, 200, helmet);
        }
        return true;
      }

      // 3. WORKERS ENDPOINTS
      // GET /api/v1/workers
      if (pathname === '/api/v1/workers' && method === 'GET') {
        const workers = this.db.getWorkers();
        this.sendJson(res, 200, workers);
        return true;
      }

      // GET /api/v1/workers/:id
      const workerMatch = pathname.match(/^\/api\/v1\/workers\/([^/]+)$/);
      if (workerMatch && method === 'GET') {
        const workerId = workerMatch[1];
        const worker = this.db.getWorker(workerId);
        if (!worker) {
          this.sendJson(res, 404, { error: `Worker ${workerId} not found` });
        } else {
          this.sendJson(res, 200, worker);
        }
        return true;
      }

      // POST /api/v1/workers/:id/check-in
      const workerCheckInMatch = pathname.match(/^\/api\/v1\/workers\/([^/]+)\/check-in$/);
      if (workerCheckInMatch && method === 'POST') {
        const workerId = workerCheckInMatch[1];
        const body = await this.readJsonBody(req);
        const worker = this.db.getWorker(workerId);

        if (!worker) {
          this.sendJson(res, 404, { error: `Worker ${workerId} not found` });
          return true;
        }

        const helmet = this.db.getHelmets().find((h) => h.worker_id === worker.id);
        const targetZoneId = String(body.zoneId || body.zoneName || 'portal-surface');
        const zone = this.db.getZone(targetZoneId);

        if (!zone) {
          this.sendJson(res, 400, { error: `Zone ${targetZoneId} not found` });
          return true;
        }

        const assignment = this.db.createZoneAssignment(
          worker.id,
          helmet?.id || 'MC-001',
          zone.id,
          'CHECK_IN'
        );

        this.sendJson(res, 200, {
          success: true,
          message: `${worker.name} checked in to ${zone.name}`,
          assignment,
        });
        return true;
      }

      // POST /api/v1/workers/:id/check-out
      const workerCheckOutMatch = pathname.match(/^\/api\/v1\/workers\/([^/]+)\/check-out$/);
      if (workerCheckOutMatch && method === 'POST') {
        const workerId = workerCheckOutMatch[1];
        const worker = this.db.getWorker(workerId);

        if (!worker) {
          this.sendJson(res, 404, { error: `Worker ${workerId} not found` });
          return true;
        }

        const checkedOut = this.db.checkOutWorker(worker.id);
        this.sendJson(res, 200, {
          success: checkedOut,
          message: `${worker.name} checked out from active mine zone`,
        });
        return true;
      }

      // POST /api/v1/workers/:id/zone
      const workerZoneMatch = pathname.match(/^\/api\/v1\/workers\/([^/]+)\/zone$/);
      if (workerZoneMatch && method === 'POST') {
        const workerId = workerZoneMatch[1];
        const body = await this.readJsonBody(req);
        const worker = this.db.getWorker(workerId);

        if (!worker) {
          this.sendJson(res, 404, { error: `Worker ${workerId} not found` });
          return true;
        }

        const helmet = this.db.getHelmets().find((h) => h.worker_id === worker.id);
        const targetZoneId = String(body.zoneId || body.zoneName || '');
        const zone = this.db.getZone(targetZoneId);

        if (!zone) {
          this.sendJson(res, 400, { error: `Zone ${targetZoneId} not found` });
          return true;
        }

        const assignment = this.db.createZoneAssignment(
          worker.id,
          helmet?.id || 'MC-001',
          zone.id,
          'SUPERVISOR_REASSIGN'
        );

        if (body.updateDefault) {
          worker.assigned_zone_id = zone.id;
        }

        this.sendJson(res, 200, {
          success: true,
          message: `Supervisor reassigned ${worker.name} to ${zone.name}`,
          assignment,
        });
        return true;
      }

      // 4. ZONES ENDPOINTS
      // GET /api/v1/zones
      if (pathname === '/api/v1/zones' && method === 'GET') {
        const zones = this.db.getZones();
        const helmets = this.db.getHelmets();
        const workers = this.db.getWorkers();

        const zoneSummaries = zones.map((z) => {
          const checkedInWorkers = workers.filter((w) => w.current_work_zone_name === z.name);
          let safeCount = 0;
          let warningCount = 0;
          let dangerCount = 0;
          let offlineCount = 0;

          checkedInWorkers.forEach((w) => {
            const h = helmets.find((hlm) => hlm.worker_id === w.id);
            if (!h || !h.online) offlineCount++;
            else if (h.status === 'DANGER') dangerCount++;
            else if (h.status === 'WARNING') warningCount++;
            else safeCount++;
          });

          return {
            ...z,
            workerCount: checkedInWorkers.length,
            helmetCount: checkedInWorkers.length,
            safeCount,
            warningCount,
            dangerCount,
            offlineCount,
          };
        });

        this.sendJson(res, 200, zoneSummaries);
        return true;
      }

      // GET /api/v1/zones/:id/workers
      const zoneWorkersMatch = pathname.match(/^\/api\/v1\/zones\/([^/]+)\/workers$/);
      if (zoneWorkersMatch && method === 'GET') {
        const zoneId = zoneWorkersMatch[1];
        const zone = this.db.getZone(zoneId);
        if (!zone) {
          this.sendJson(res, 404, { error: `Zone ${zoneId} not found` });
          return true;
        }

        const workers = this.db.getWorkers().filter((w) => w.current_work_zone_name === zone.name);
        this.sendJson(res, 200, workers);
        return true;
      }

      // GET /api/v1/zones/:id
      const zoneMatch = pathname.match(/^\/api\/v1\/zones\/([^/]+)$/);
      if (zoneMatch && method === 'GET') {
        const zoneId = zoneMatch[1];
        const zone = this.db.getZone(zoneId);
        if (!zone) {
          this.sendJson(res, 404, { error: `Zone ${zoneId} not found` });
        } else {
          this.sendJson(res, 200, zone);
        }
        return true;
      }

      // 5. ALERTS ENDPOINTS
      // GET /api/v1/alerts
      if (pathname === '/api/v1/alerts' && method === 'GET') {
        const status = url.searchParams.get('status') || undefined;
        const severity = url.searchParams.get('severity') || undefined;
        const helmetId = url.searchParams.get('helmetId') || undefined;
        const alerts = this.db.getAlerts({ status, severity, helmetId });
        this.sendJson(res, 200, alerts);
        return true;
      }

      // GET /api/v1/alerts/active
      if (pathname === '/api/v1/alerts/active' && method === 'GET') {
        const activeAlerts = this.db.getActiveAlerts();
        this.sendJson(res, 200, activeAlerts);
        return true;
      }

      // GET /api/v1/alerts/history
      if (pathname === '/api/v1/alerts/history' && method === 'GET') {
        const historyAlerts = this.db.getAlertHistory();
        this.sendJson(res, 200, historyAlerts);
        return true;
      }

      // POST /api/v1/alerts/:id/acknowledge
      const alertAckMatch = pathname.match(/^\/api\/v1\/alerts\/([^/]+)\/acknowledge$/);
      if (alertAckMatch && method === 'POST') {
        const alertId = alertAckMatch[1];
        const body = await this.readJsonBody(req);
        const supervisorName = typeof body.supervisorName === 'string' ? body.supervisorName : 'Supervisor On-Duty';
        const alert = AlertEngine.acknowledge(
          this.db.getAlertsStore(),
          alertId,
          supervisorName
        );
        if (!alert) {
          this.sendJson(res, 404, { error: `Alert ${alertId} not found` });
        } else {
          this.sendJson(res, 200, alert);
        }
        return true;
      }

      // POST /api/v1/alerts/:id/resolve
      const alertResolveMatch = pathname.match(/^\/api\/v1\/alerts\/([^/]+)\/resolve$/);
      if (alertResolveMatch && method === 'POST') {
        const alertId = alertResolveMatch[1];
        const body = await this.readJsonBody(req);
        const notes = typeof body.notes === 'string' ? body.notes : 'Resolved by supervisor';
        const alert = AlertEngine.resolve(
          this.db.getAlertsStore(),
          alertId,
          notes
        );
        if (!alert) {
          this.sendJson(res, 404, { error: `Alert ${alertId} not found` });
        } else {
          this.sendJson(res, 200, alert);
        }
        return true;
      }

      // 6. SYSTEM HEALTH
      // GET /api/v1/system/health
      if (pathname === '/api/v1/system/health' && method === 'GET') {
        const health = this.db.getSystemHealth();
        this.sendJson(res, 200, health);
        return true;
      }

      // If route started with /api/v1/ but wasn't matched:
      this.sendJson(res, 404, { error: `API endpoint not found: ${method} ${pathname}` });
      return true;
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      this.sendJson(res, 500, { error: 'Internal Server Error', message });
      return true;
    }
  }

  private sendJson(res: ServerResponse, statusCode: number, data: unknown): void {
    res.statusCode = statusCode;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify(data));
  }

  private readJsonBody(req: IncomingMessage): Promise<Record<string, unknown>> {
    return new Promise((resolve) => {
      let body = '';
      req.on('data', (chunk: Buffer | string) => {
        body += chunk.toString();
      });
      req.on('end', () => {
        try {
          if (!body) resolve({});
          else resolve(JSON.parse(body));
        } catch {
          resolve({});
        }
      });
      req.on('error', () => {
        resolve({});
      });
    });
  }
}
