/**
 * MineCare - Backend API Dispatcher & Router
 *
 * Exposes the complete versioned REST API (/api/v1/*):
 * - Auth & Session Management (/api/v1/auth/*)
 * - Admin Console & User/Role/Audit Management (/api/v1/admin/*)
 * - Telemetry Ingestion (Validation -> Storage -> SafetyEngine -> AlertEngine)
 * - Helmets & Telemetry History (with Worker isolation)
 * - Workers & Zone Check-In / Check-Out (with Worker self-only rules)
 * - Mine Zones & Occupancy
 * - Alerts Management & Lifecycle (Supervisor/Admin ack & resolve)
 * - System Health Diagnostics
 */

import type { IncomingMessage, ServerResponse } from 'http';
import { DatabaseRepository } from './db/DatabaseRepository';
import { TelemetryValidator } from './validation/TelemetryValidator';
import { SafetyEngine } from './safety/SafetyEngine';
import { AlertEngine } from './alerts/AlertEngine';
import { OfflineEngine } from './offline/OfflineEngine';
import { AuthManager } from './auth/AuthManager';
import type { DbTelemetry, UserRole, DbUserProfile } from './types';

export class BackendApp {
  private static instance: BackendApp | null = null;
  private db: DatabaseRepository;
  private authManager: AuthManager;

  private constructor() {
    this.db = DatabaseRepository.getInstance();
    this.authManager = AuthManager.getInstance();

    // Check offline heartbeats every 3 seconds
    if (typeof setInterval !== 'undefined') {
      const timer = setInterval(() => {
        const helmets = this.db.getHelmets();
        const alerts = this.db.getAlertsStore();
        OfflineEngine.checkFleetHeartbeats(helmets, alerts);
      }, 3000);
      if (typeof timer.unref === 'function') {
        timer.unref();
      }
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

  public getAuthManager(): AuthManager {
    return this.authManager;
  }

  /**
   * Universal HTTP Dispatcher handling standard Node/Vite/Express requests
   */
  public async handleRequest(req: IncomingMessage, res: ServerResponse): Promise<boolean> {
    const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
    const pathname = url.pathname;
    const method = req.method?.toUpperCase() || 'GET';

    // CORS Headers
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
      // =========================================================================
      // 1. AUTHENTICATION ENDPOINTS (Public)
      // =========================================================================

      // POST /api/v1/auth/login
      if (pathname === '/api/v1/auth/login' && method === 'POST') {
        const body = await this.readJsonBody(req);
        const email = String(body.email || '');
        const password = String(body.password || '');
        const authResult = await this.authManager.login(email, password);

        if ('error' in authResult) {
          this.sendJson(res, authResult.code, { error: authResult.error });
        } else {
          this.sendJson(res, 200, {
            success: true,
            token: authResult.session.token,
            user: authResult.session.user,
            expiresAt: authResult.session.expires_at,
          });
        }
        return true;
      }

      // POST /api/v1/auth/logout
      if (pathname === '/api/v1/auth/logout' && method === 'POST') {
        const authHeader = req.headers.authorization || '';
        const body = await this.readJsonBody(req);
        const token =
          (typeof body.token === 'string' ? body.token : '') ||
          authHeader.replace(/^Bearer\s+/i, '').trim();

        if (token) {
          this.authManager.logout(token);
        }
        this.sendJson(res, 200, { success: true, message: 'Logged out successfully' });
        return true;
      }

      // GET /api/v1/auth/session
      if (pathname === '/api/v1/auth/session' && method === 'GET') {
        const user = this.authManager.authenticateRequest(req);
        if (!user) {
          this.sendJson(res, 401, { error: 'Unauthorized or session expired' });
        } else {
          const authHeader = req.headers.authorization || '';
          const token = authHeader.replace(/^Bearer\s+/i, '').trim();
          this.sendJson(res, 200, {
            authenticated: true,
            user,
            token,
          });
        }
        return true;
      }

      // =========================================================================
      // 2. TELEMETRY INGESTION (Public / Sensor Ingestion)
      // =========================================================================
      if (pathname === '/api/v1/telemetry' && method === 'POST') {
        const body = await this.readJsonBody(req);
        const validation = TelemetryValidator.validate(body);

        if (!validation.isValid || !validation.packet) {
          this.sendJson(res, 400, { error: 'Validation Failed', details: validation.errors });
          return true;
        }

        const packet = validation.packet;

        // Authoritative Safety Evaluation
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

        // Authoritative Alert Lifecycle
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

      // =========================================================================
      // 3. SYSTEM HEALTH (Public Diagnostics)
      // =========================================================================
      if (pathname === '/api/v1/system/health' && method === 'GET') {
        const health = this.db.getSystemHealth();
        this.sendJson(res, 200, health);
        return true;
      }

      // =========================================================================
      // 4. AUTHENTICATION & AUTHORIZATION ENFORCEMENT
      // =========================================================================
      const currentUser = this.authManager.authenticateRequest(req);

      // =========================================================================
      // 5. ADMIN AREA ENDPOINTS (/api/v1/admin/*)
      // =========================================================================
      if (pathname.startsWith('/api/v1/admin/')) {
        if (!currentUser) {
          this.sendJson(res, 401, { error: 'Unauthorized: Authentication required' });
          return true;
        }
        if (currentUser.role !== 'ADMIN') {
          this.sendJson(res, 403, { error: 'Forbidden: Admin access required' });
          return true;
        }

        // GET /api/v1/admin/users
        if (pathname === '/api/v1/admin/users' && method === 'GET') {
          const profiles = this.db.getAllProfiles();
          this.sendJson(res, 200, profiles);
          return true;
        }

        // POST /api/v1/admin/users
        if (pathname === '/api/v1/admin/users' && method === 'POST') {
          const body = await this.readJsonBody(req);
          const name = String(body.name || '');
          const email = String(body.email || '').trim().toLowerCase();
          const role = String(body.role || '').toUpperCase() as UserRole;
          const worker_id = typeof body.worker_id === 'string' ? body.worker_id : undefined;

          if (!name || !email || !role) {
            this.sendJson(res, 400, { error: 'Name, email, and role are required' });
            return true;
          }
          if (!['ADMIN', 'SUPERVISOR', 'WORKER'].includes(role)) {
            this.sendJson(res, 400, { error: 'Invalid role. Must be ADMIN, SUPERVISOR, or WORKER' });
            return true;
          }

          const existing = this.db.getProfileByEmail(email);
          if (existing) {
            this.sendJson(res, 409, { error: `User with email ${email} already exists` });
            return true;
          }

          const newProfile: DbUserProfile = {
            id: `PRF-${Date.now().toString().slice(-4)}`,
            auth_user_id: `auth-${Date.now()}`,
            name,
            email,
            role,
            worker_id: role === 'WORKER' ? (worker_id ? String(worker_id) : null) : null,
            active: true,
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          };


          this.db.createProfile(newProfile);
          this.db.logAuditAction({
            user_id: currentUser.id,
            user_email: currentUser.email,
            role: currentUser.role,
            action: 'USER_CREATE',
            target_type: 'USER',
            target_id: newProfile.id,
            details: { email: newProfile.email, role: newProfile.role },
          });

          this.sendJson(res, 201, { success: true, profile: newProfile });
          return true;
        }

        // PUT /api/v1/admin/users/:id/role
        const userRoleMatch = pathname.match(/^\/api\/v1\/admin\/users\/([^/]+)\/role$/);
        if (userRoleMatch && method === 'PUT') {
          const targetUserId = userRoleMatch[1];
          const body = await this.readJsonBody(req);
          const newRole = String(body.role || '').toUpperCase() as UserRole;

          if (!['ADMIN', 'SUPERVISOR', 'WORKER'].includes(newRole)) {
            this.sendJson(res, 400, { error: 'Invalid role. Must be ADMIN, SUPERVISOR, or WORKER' });
            return true;
          }

          const existing = this.db.getProfile(targetUserId);
          if (!existing) {
            this.sendJson(res, 404, { error: `User profile ${targetUserId} not found` });
            return true;
          }

          const oldRole = existing.role;
          const updated = this.db.updateProfile(targetUserId, {
            role: newRole,
            worker_id: newRole === 'WORKER' ? (existing.worker_id ?? null) : null,
          });


          this.db.logAuditAction({
            user_id: currentUser.id,
            user_email: currentUser.email,
            role: currentUser.role,
            action: 'ROLE_CHANGE',
            target_type: 'USER',
            target_id: targetUserId,
            details: { oldRole, newRole },
          });

          this.sendJson(res, 200, { success: true, profile: updated });
          return true;
        }

        // GET /api/v1/admin/audit-logs
        if (pathname === '/api/v1/admin/audit-logs' && method === 'GET') {
          const limit = Number(url.searchParams.get('limit') || 100);
          const logs = this.db.getAuditLogs(limit);
          this.sendJson(res, 200, logs);
          return true;
        }

        this.sendJson(res, 404, { error: `Admin endpoint not found: ${method} ${pathname}` });
        return true;
      }

      // =========================================================================
      // 6. OPERATIONAL ENDPOINTS (Least-Privilege RBAC)
      // =========================================================================
      if (!currentUser) {
        this.sendJson(res, 401, {
          error: 'Unauthorized: Authentication required to access MineCare operational data',
        });
        return true;
      }

      // -------------------------------------------------------------------------
      // HELMETS ENDPOINTS
      // -------------------------------------------------------------------------

      // GET /api/v1/helmets
      if (pathname === '/api/v1/helmets' && method === 'GET') {
        const allHelmets = this.db.getHelmets();
        if (currentUser.role === 'WORKER') {
          const workerHelmet = allHelmets.filter((h) => h.worker_id === currentUser.worker_id);
          this.sendJson(res, 200, workerHelmet);
        } else {
          this.sendJson(res, 200, allHelmets);
        }
        return true;
      }

      // GET /api/v1/helmets/:id/latest
      const helmetLatestMatch = pathname.match(/^\/api\/v1\/helmets\/([^/]+)\/latest$/);
      if (helmetLatestMatch && method === 'GET') {
        const helmetId = helmetLatestMatch[1];
        const helmet = this.db.getHelmets().find((h) => h.id === helmetId || h.helmet_code === helmetId);

        if (!helmet) {
          this.sendJson(res, 404, { error: `No telemetry recorded for helmet ${helmetId}` });
          return true;
        }

        if (currentUser.role === 'WORKER' && helmet.worker_id !== currentUser.worker_id) {
          this.sendJson(res, 403, { error: 'Forbidden: Workers cannot inspect other helmets telemetry' });
          return true;
        }

        const latest = this.db.getLatestTelemetry(helmet.id);
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
        const helmet = this.db.getHelmets().find((h) => h.id === helmetId || h.helmet_code === helmetId);

        if (!helmet) {
          this.sendJson(res, 404, { error: `Helmet ${helmetId} not found` });
          return true;
        }

        if (currentUser.role === 'WORKER' && helmet.worker_id !== currentUser.worker_id) {
          this.sendJson(res, 403, { error: 'Forbidden: Workers cannot inspect other helmets telemetry' });
          return true;
        }

        const limit = Number(url.searchParams.get('limit') || 50);
        const history = this.db.getTelemetryHistory(helmet.id, limit);
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
          return true;
        }

        if (currentUser.role === 'WORKER' && helmet.worker_id !== currentUser.worker_id) {
          this.sendJson(res, 403, { error: 'Forbidden: Workers cannot inspect other helmets' });
          return true;
        }

        this.sendJson(res, 200, helmet);
        return true;
      }

      // -------------------------------------------------------------------------
      // WORKERS ENDPOINTS
      // -------------------------------------------------------------------------

      // GET /api/v1/workers
      if (pathname === '/api/v1/workers' && method === 'GET') {
        if (currentUser.role === 'WORKER') {
          const selfWorker = currentUser.worker_id ? this.db.getWorker(currentUser.worker_id) : undefined;
          this.sendJson(res, 200, selfWorker ? [selfWorker] : []);
        } else {
          const workers = this.db.getWorkers();
          this.sendJson(res, 200, workers);
        }
        return true;
      }

      // GET /api/v1/workers/:id
      const workerMatch = pathname.match(/^\/api\/v1\/workers\/([^/]+)$/);
      if (workerMatch && method === 'GET') {
        const workerId = workerMatch[1];

        if (currentUser.role === 'WORKER' && workerId !== currentUser.worker_id) {
          this.sendJson(res, 403, { error: 'Forbidden: Workers cannot view other workers profiles' });
          return true;
        }

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

        // Worker can only check in themselves
        if (currentUser.role === 'WORKER' && workerId !== currentUser.worker_id) {
          this.sendJson(res, 403, { error: 'Forbidden: Workers cannot check in other workers' });
          return true;
        }

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

        this.db.logAuditAction({
          user_id: currentUser.id,
          user_email: currentUser.email,
          role: currentUser.role,
          action: 'WORKER_CHECK_IN',
          target_type: 'WORKER',
          target_id: worker.id,
          details: { zone_id: zone.id, zone_name: zone.name },
        });

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

        // Worker can only check out themselves
        if (currentUser.role === 'WORKER' && workerId !== currentUser.worker_id) {
          this.sendJson(res, 403, { error: 'Forbidden: Workers cannot check out other workers' });
          return true;
        }

        const worker = this.db.getWorker(workerId);
        if (!worker) {
          this.sendJson(res, 404, { error: `Worker ${workerId} not found` });
          return true;
        }

        const checkedOut = this.db.checkOutWorker(worker.id);

        this.db.logAuditAction({
          user_id: currentUser.id,
          user_email: currentUser.email,
          role: currentUser.role,
          action: 'WORKER_CHECK_OUT',
          target_type: 'WORKER',
          target_id: worker.id,
          details: { worker_name: worker.name },
        });

        this.sendJson(res, 200, {
          success: checkedOut,
          message: `${worker.name} checked out from active mine zone`,
        });
        return true;
      }

      // POST /api/v1/workers/:id/zone (Zone Reassignment)
      const workerZoneMatch = pathname.match(/^\/api\/v1\/workers\/([^/]+)\/zone$/);
      if (workerZoneMatch && method === 'POST') {
        // Workers CANNOT reassign workers
        if (currentUser.role === 'WORKER') {
          this.sendJson(res, 403, { error: 'Forbidden: Workers are not authorized to perform zone reassignment' });
          return true;
        }

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

        this.db.logAuditAction({
          user_id: currentUser.id,
          user_email: currentUser.email,
          role: currentUser.role,
          action: 'ZONE_REASSIGN',
          target_type: 'WORKER',
          target_id: worker.id,
          details: {
            worker_name: worker.name,
            target_zone_id: zone.id,
            target_zone_name: zone.name,
            updateDefault: Boolean(body.updateDefault),
          },
        });

        this.sendJson(res, 200, {
          success: true,
          message: `Supervisor reassigned ${worker.name} to ${zone.name}`,
          assignment,
        });
        return true;
      }

      // -------------------------------------------------------------------------
      // ZONES ENDPOINTS
      // -------------------------------------------------------------------------

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

        let workers = this.db.getWorkers().filter((w) => w.current_work_zone_name === zone.name);
        if (currentUser.role === 'WORKER') {
          workers = workers.filter((w) => w.id === currentUser.worker_id);
        }

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

      // -------------------------------------------------------------------------
      // ALERTS ENDPOINTS
      // -------------------------------------------------------------------------

      // GET /api/v1/alerts
      if (pathname === '/api/v1/alerts' && method === 'GET') {
        const status = url.searchParams.get('status') || undefined;
        const severity = url.searchParams.get('severity') || undefined;
        const helmetId = url.searchParams.get('helmetId') || undefined;
        let alerts = this.db.getAlerts({ status, severity, helmetId });

        if (currentUser.role === 'WORKER') {
          alerts = alerts.filter((a) => a.worker_id === currentUser.worker_id);
        }

        this.sendJson(res, 200, alerts);
        return true;
      }

      // GET /api/v1/alerts/active
      if (pathname === '/api/v1/alerts/active' && method === 'GET') {
        let activeAlerts = this.db.getActiveAlerts();
        if (currentUser.role === 'WORKER') {
          activeAlerts = activeAlerts.filter((a) => a.worker_id === currentUser.worker_id);
        }
        this.sendJson(res, 200, activeAlerts);
        return true;
      }

      // GET /api/v1/alerts/history
      if (pathname === '/api/v1/alerts/history' && method === 'GET') {
        let historyAlerts = this.db.getAlertHistory();
        if (currentUser.role === 'WORKER') {
          historyAlerts = historyAlerts.filter((a) => a.worker_id === currentUser.worker_id);
        }
        this.sendJson(res, 200, historyAlerts);
        return true;
      }

      // POST /api/v1/alerts/:id/acknowledge
      const alertAckMatch = pathname.match(/^\/api\/v1\/alerts\/([^/]+)\/acknowledge$/);
      if (alertAckMatch && method === 'POST') {
        if (currentUser.role === 'WORKER') {
          this.sendJson(res, 403, { error: 'Forbidden: Workers cannot acknowledge alerts' });
          return true;
        }

        const alertId = alertAckMatch[1];
        const body = await this.readJsonBody(req);
        const supervisorName =
          typeof body.supervisorName === 'string'
            ? body.supervisorName
            : currentUser.name || 'Supervisor On-Duty';

        const alert = AlertEngine.acknowledge(
          this.db.getAlertsStore(),
          alertId,
          supervisorName
        );

        if (!alert) {
          this.sendJson(res, 404, { error: `Alert ${alertId} not found` });
        } else {
          this.db.logAuditAction({
            user_id: currentUser.id,
            user_email: currentUser.email,
            role: currentUser.role,
            action: 'ALERT_ACKNOWLEDGE',
            target_type: 'ALERT',
            target_id: alertId,
            details: { acknowledged_by: supervisorName },
          });
          this.sendJson(res, 200, alert);
        }
        return true;
      }

      // POST /api/v1/alerts/:id/resolve
      const alertResolveMatch = pathname.match(/^\/api\/v1\/alerts\/([^/]+)\/resolve$/);
      if (alertResolveMatch && method === 'POST') {
        if (currentUser.role === 'WORKER') {
          this.sendJson(res, 403, { error: 'Forbidden: Workers cannot resolve supervisor alerts' });
          return true;
        }

        const alertId = alertResolveMatch[1];
        const body = await this.readJsonBody(req);
        const notes = typeof body.notes === 'string' ? body.notes : `Resolved by ${currentUser.name}`;

        const alert = AlertEngine.resolve(
          this.db.getAlertsStore(),
          alertId,
          notes
        );

        if (!alert) {
          this.sendJson(res, 404, { error: `Alert ${alertId} not found` });
        } else {
          this.db.logAuditAction({
            user_id: currentUser.id,
            user_email: currentUser.email,
            role: currentUser.role,
            action: 'ALERT_RESOLVE',
            target_type: 'ALERT',
            target_id: alertId,
            details: { notes, resolved_by: currentUser.name },
          });
          this.sendJson(res, 200, alert);
        }
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
