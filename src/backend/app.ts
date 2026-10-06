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
 * - Analytics & Historical Intelligence (/api/v1/analytics/*)
 */

import type { IncomingMessage, ServerResponse } from 'http';
import type { IDatabaseRepository } from './db/repositories/interfaces';
import { PostgresDatabaseRepository } from './db/repositories/PostgresDatabaseRepository';
import { DatabaseRepository } from './db/DatabaseRepository';
import { TelemetryValidator } from './validation/TelemetryValidator';
import { SafetyEngine } from './safety/SafetyEngine';
import { AlertEngine } from './alerts/AlertEngine';
import { OfflineEngine } from './offline/OfflineEngine';
import { AuthManager } from './auth/AuthManager';
import { RealtimePublisher } from './realtime/RealtimePublisher';
import { AnalyticsEngine, type AnalyticsOverviewResult } from './analytics/AnalyticsEngine';
import type { DbTelemetry, UserRole, DbUserProfile } from './types';
import { getBackendConfig } from './config/env';
import { StructuredLogger } from './security/StructuredLogger';
import { RequestIdManager } from './security/RequestId';
import { SecurityHeadersManager } from './security/SecurityHeaders';
import { CorsManager } from './security/CorsManager';
import { RequestLimiter } from './security/RequestLimiter';
import { ApiError } from './security/ApiError';

export class BackendApp {
  private static instance: BackendApp | null = null;
  private db: IDatabaseRepository;
  private authManager: AuthManager;
  private heartbeatTimer: NodeJS.Timeout | null = null;

  private constructor(customDb?: IDatabaseRepository) {
    const config = getBackendConfig();

    if (customDb) {
      this.db = customDb;
    } else if (config.isProduction || (config.databaseUrl && !config.isTest)) {
      this.db = PostgresDatabaseRepository.getInstance();
    } else {
      // In development / testing without external DB URL, use in-memory DatabaseRepository test double
      this.db = DatabaseRepository.getInstance() as unknown as IDatabaseRepository;
    }

    this.authManager = AuthManager.getInstance(this.db);

    // Check offline heartbeats every 3 seconds
    if (typeof setInterval !== 'undefined') {
      this.heartbeatTimer = setInterval(async () => {
        try {
          const helmets = await this.db.getRawHelmets();
          const alerts = await this.db.getAlertsStore();
          const { statusChanges, newAlerts, resolvedAlerts } = OfflineEngine.checkFleetHeartbeats(helmets, alerts);

          for (const sc of statusChanges) {
            const helmet = await this.db.getHelmetWithDetails(sc.helmetId);
            if (helmet) {
              RealtimePublisher.getInstance().publish('helmets', 'UPDATE', helmet);
            }
          }

          for (const alert of newAlerts) {
            await this.db.saveAlert(alert);
            RealtimePublisher.getInstance().publish('alerts', 'INSERT', alert);
          }

          for (const alert of resolvedAlerts) {
            await this.db.resolveAlert(alert.id, alert.supervisor_notes || 'Auto-resolved: Heartbeat re-established');
            RealtimePublisher.getInstance().publish('alerts', 'UPDATE', alert);
          }
        } catch {
          // ignore background heartbeat error
        }
      }, 3000);

      if (typeof this.heartbeatTimer.unref === 'function') {
        this.heartbeatTimer.unref();
      }
    }
  }

  public static getInstance(customDb?: IDatabaseRepository): BackendApp {
    if (!BackendApp.instance) {
      BackendApp.instance = new BackendApp(customDb);
    } else if (customDb) {
      BackendApp.instance.setDb(customDb);
    }
    return BackendApp.instance;
  }

  public static resetInstance(): void {
    if (BackendApp.instance?.heartbeatTimer) {
      clearInterval(BackendApp.instance.heartbeatTimer);
    }
    AuthManager.resetInstance();
    BackendApp.instance = null;
  }

  public setDb(db: IDatabaseRepository): void {
    this.db = db;
    this.authManager.setDb(db);
  }

  public getDb(): IDatabaseRepository {
    return this.db;
  }

  public getAuthManager(): AuthManager {
    return this.authManager;
  }

  /**
   * Universal HTTP Dispatcher handling standard Node/Vite/Express requests
   */
  public async handleRequest(req: IncomingMessage, res: ServerResponse): Promise<boolean> {
    // 1. Production Security Headers
    SecurityHeadersManager.apply(res);

    // 2. Correlation Request ID
    const requestId = RequestIdManager.resolveRequestId(req, res);

    // 3. Strict CORS Policy
    const corsAllowed = CorsManager.handleCors(req, res);
    if (!corsAllowed) {
      return true;
    }

    const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
    const pathname = url.pathname;
    const method = req.method?.toUpperCase() || 'GET';

    // 4. URI Length Protection
    if (RequestLimiter.isUriTooLong(req.url || '')) {
      this.sendJson(res, 414, ApiError.uriTooLong(requestId));
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
        if (body._malformed) {
          this.sendJson(res, 401, { error: 'Invalid or malformed request payload' });
          return true;
        }
        const email = typeof body.email === 'string' ? body.email.trim() : '';
        const password = typeof body.password === 'string' ? body.password : '';
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
          await this.authManager.logout(token);
        }
        this.sendJson(res, 200, { success: true, message: 'Logged out successfully' });
        return true;
      }

      // GET /api/v1/auth/session
      if (pathname === '/api/v1/auth/session' && method === 'GET') {
        const user = await this.authManager.authenticateRequest(req);
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

        await this.db.saveTelemetry(telemetryRecord);

        // Authoritative Alert Lifecycle
        const helmet = await this.db.getHelmet(packet.helmetId);
        const existingAlerts = await this.db.getAlertsStore();
        const alertResult = AlertEngine.processAlerts(
          existingAlerts,
          packet.helmetId,
          helmet?.worker_id || null,
          packet,
          safety
        );

        if (alertResult.createdAlert) {
          await this.db.saveAlert(alertResult.createdAlert);
        }
        for (const resolved of alertResult.resolvedAlerts) {
          await this.db.resolveAlert(resolved.id, resolved.supervisor_notes || 'Auto-resolved');
        }

        // Realtime Broadcast (Authoritative Database Changes)
        const publisher = RealtimePublisher.getInstance();
        publisher.publish('telemetry', 'INSERT', telemetryRecord);

        const updatedHelmet = await this.db.getHelmetWithDetails(packet.helmetId);
        if (updatedHelmet) {
          publisher.publish('helmets', 'UPDATE', updatedHelmet);
        }

        if (alertResult.createdAlert) {
          publisher.publish('alerts', 'INSERT', alertResult.createdAlert);
        }

        alertResult.resolvedAlerts.forEach((resolved) => {
          publisher.publish('alerts', 'UPDATE', resolved);
        });

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
        const health = await this.db.getSystemHealth();
        this.sendJson(res, 200, health);
        return true;
      }

      // =========================================================================
      // 4. AUTHENTICATION & AUTHORIZATION ENFORCEMENT
      // =========================================================================
      const currentUser = await this.authManager.authenticateRequest(req);

      // =========================================================================
      // REALTIME STREAM (/api/v1/realtime/stream - SSE with RBAC Isolation)
      // =========================================================================
      if (pathname === '/api/v1/realtime/stream' && method === 'GET') {
        if (!currentUser) {
          this.sendJson(res, 401, { error: 'Unauthorized: Authentication required for realtime stream' });
          return true;
        }

        res.statusCode = 200;
        res.setHeader('Content-Type', 'text/event-stream');
        res.setHeader('Cache-Control', 'no-cache, no-transform');
        res.setHeader('Connection', 'keep-alive');
        res.setHeader('X-Accel-Buffering', 'no');

        let assignedHelmetId: string | null = null;
        if (currentUser.role === 'WORKER' && currentUser.worker_id) {
          const helmets = await this.db.getHelmets();
          const h = helmets.find((hlm) => hlm.worker_id === currentUser.worker_id);
          assignedHelmetId = h ? h.id : null;
        }

        const clientId = `client-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
        RealtimePublisher.getInstance().addSseClient({
          id: clientId,
          res,
          role: currentUser.role,
          workerId: currentUser.worker_id ?? null,
          assignedHelmetId,
        });

        res.write(
          `event: status\ndata: ${JSON.stringify({ status: 'CONNECTED', role: currentUser.role, workerId: currentUser.worker_id, assignedHelmetId })}\n\n`
        );
        return true;
      }

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
          const profiles = await this.db.getAllProfiles();
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

          const existing = await this.db.getProfileByEmail(email);
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

          await this.db.createProfile(newProfile);
          await this.db.logAuditAction({
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

          const existing = await this.db.getProfile(targetUserId);
          if (!existing) {
            this.sendJson(res, 404, { error: `User profile ${targetUserId} not found` });
            return true;
          }

          const oldRole = existing.role;
          const updated = await this.db.updateProfile(targetUserId, {
            role: newRole,
            worker_id: newRole === 'WORKER' ? (existing.worker_id ?? null) : null,
          });

          await this.db.logAuditAction({
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
          const logs = await this.db.getAuditLogs(limit);
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
        const allHelmets = await this.db.getHelmets();
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
        const allHelmets = await this.db.getHelmets();
        const helmet = allHelmets.find((h) => h.id === helmetId || h.helmet_code === helmetId);

        if (!helmet) {
          this.sendJson(res, 404, { error: `No telemetry recorded for helmet ${helmetId}` });
          return true;
        }

        if (currentUser.role === 'WORKER' && helmet.worker_id !== currentUser.worker_id) {
          this.sendJson(res, 403, { error: 'Forbidden: Workers cannot inspect other helmets telemetry' });
          return true;
        }

        const latest = await this.db.getLatestTelemetry(helmet.id);
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
        const allHelmets = await this.db.getHelmets();
        const helmet = allHelmets.find((h) => h.id === helmetId || h.helmet_code === helmetId);

        if (!helmet) {
          this.sendJson(res, 404, { error: `Helmet ${helmetId} not found` });
          return true;
        }

        if (currentUser.role === 'WORKER' && helmet.worker_id !== currentUser.worker_id) {
          this.sendJson(res, 403, { error: 'Forbidden: Workers cannot inspect other helmets telemetry' });
          return true;
        }

        const limit = Number(url.searchParams.get('limit') || 50);
        const history = await this.db.getTelemetryHistory(helmet.id, limit);
        this.sendJson(res, 200, history);
        return true;
      }

      // GET /api/v1/helmets/:id
      const helmetMatch = pathname.match(/^\/api\/v1\/helmets\/([^/]+)$/);
      if (helmetMatch && method === 'GET') {
        const helmetId = helmetMatch[1];
        const allHelmets = await this.db.getHelmets();
        const helmet = allHelmets.find((h) => h.id === helmetId || h.helmet_code === helmetId);

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
          const selfWorker = currentUser.worker_id ? await this.db.getWorker(currentUser.worker_id) : undefined;
          this.sendJson(res, 200, selfWorker ? [selfWorker] : []);
        } else {
          const workers = await this.db.getWorkers();
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

        const worker = await this.db.getWorker(workerId);
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
        const worker = await this.db.getWorker(workerId);

        if (!worker) {
          this.sendJson(res, 404, { error: `Worker ${workerId} not found` });
          return true;
        }

        const allHelmets = await this.db.getHelmets();
        const helmet = allHelmets.find((h) => h.worker_id === worker.id);
        const targetZoneId = String(body.zoneId || body.zoneName || 'portal-surface');
        const zone = await this.db.getZone(targetZoneId);

        if (!zone) {
          this.sendJson(res, 400, { error: `Zone ${targetZoneId} not found` });
          return true;
        }

        const assignment = await this.db.createZoneAssignment(
          worker.id,
          helmet?.id || 'MC-001',
          zone.id,
          'CHECK_IN'
        );

        // Realtime Broadcast
        RealtimePublisher.getInstance().publish('zone_assignments', 'INSERT', assignment);
        if (helmet) {
          const updatedHelmet = await this.db.getHelmetWithDetails(helmet.id);
          if (updatedHelmet) RealtimePublisher.getInstance().publish('helmets', 'UPDATE', updatedHelmet);
        }

        await this.db.logAuditAction({
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

        const worker = await this.db.getWorker(workerId);
        if (!worker) {
          this.sendJson(res, 404, { error: `Worker ${workerId} not found` });
          return true;
        }

        const checkedOut = await this.db.checkOutWorker(worker.id);
        const allHelmets = await this.db.getHelmets();
        const helmet = allHelmets.find((h) => h.worker_id === worker.id);

        // Realtime Broadcast
        RealtimePublisher.getInstance().publish('zone_assignments', 'UPDATE', {
          worker_id: worker.id,
          helmet_id: helmet?.id || '',
          active: false,
          checked_out_at: new Date().toISOString(),
        });
        if (helmet) {
          const updatedHelmet = await this.db.getHelmetWithDetails(helmet.id);
          if (updatedHelmet) RealtimePublisher.getInstance().publish('helmets', 'UPDATE', updatedHelmet);
        }

        await this.db.logAuditAction({
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
        const worker = await this.db.getWorker(workerId);

        if (!worker) {
          this.sendJson(res, 404, { error: `Worker ${workerId} not found` });
          return true;
        }

        const allHelmets = await this.db.getHelmets();
        const helmet = allHelmets.find((h) => h.worker_id === worker.id);
        const targetZoneId = String(body.zoneId || body.zoneName || '');
        const zone = await this.db.getZone(targetZoneId);

        if (!zone) {
          this.sendJson(res, 400, { error: `Zone ${targetZoneId} not found` });
          return true;
        }

        const assignment = await this.db.createZoneAssignment(
          worker.id,
          helmet?.id || 'MC-001',
          zone.id,
          'SUPERVISOR_REASSIGN'
        );

        if (body.updateDefault) {
          await this.db.updateWorker(worker.id, { assigned_zone_id: zone.id });
        }

        // Realtime Broadcast
        RealtimePublisher.getInstance().publish('zone_assignments', 'INSERT', assignment);
        if (helmet) {
          const updatedHelmet = await this.db.getHelmetWithDetails(helmet.id);
          if (updatedHelmet) RealtimePublisher.getInstance().publish('helmets', 'UPDATE', updatedHelmet);
        }

        await this.db.logAuditAction({
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
        const zones = await this.db.getZones();
        const helmets = await this.db.getHelmets();
        const workers = await this.db.getWorkers();

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
        const zone = await this.db.getZone(zoneId);
        if (!zone) {
          this.sendJson(res, 404, { error: `Zone ${zoneId} not found` });
          return true;
        }

        const allWorkers = await this.db.getWorkers();
        let workers = allWorkers.filter((w) => w.current_work_zone_name === zone.name);
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
        const zone = await this.db.getZone(zoneId);
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
        const workerId = url.searchParams.get('workerId') || undefined;

        if (currentUser.role === 'WORKER') {
          if (workerId && workerId !== currentUser.worker_id) {
            this.sendJson(res, 403, { error: 'Forbidden: Workers cannot inspect other workers alerts' });
            return true;
          }
          if (helmetId) {
            const h = await this.db.getHelmet(helmetId);
            if (h && h.worker_id && h.worker_id !== currentUser.worker_id) {
              this.sendJson(res, 403, { error: 'Forbidden: Workers cannot inspect other helmets alerts' });
              return true;
            }
          }
        }

        let alerts = await this.db.getAlerts({ status, severity, helmetId });

        if (currentUser.role === 'WORKER') {
          alerts = alerts.filter((a) => a.worker_id === currentUser.worker_id);
        }

        this.sendJson(res, 200, alerts);
        return true;
      }

      // GET /api/v1/alerts/active
      if (pathname === '/api/v1/alerts/active' && method === 'GET') {
        let activeAlerts = await this.db.getActiveAlerts();
        if (currentUser.role === 'WORKER') {
          activeAlerts = activeAlerts.filter((a) => a.worker_id === currentUser.worker_id);
        }
        this.sendJson(res, 200, activeAlerts);
        return true;
      }

      // GET /api/v1/alerts/history
      if (pathname === '/api/v1/alerts/history' && method === 'GET') {
        let historyAlerts = await this.db.getAlertHistory();
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

        const alert = await this.db.acknowledgeAlert(alertId, supervisorName);

        if (!alert) {
          this.sendJson(res, 404, { error: `Alert ${alertId} not found` });
        } else {
          // Realtime Broadcast
          RealtimePublisher.getInstance().publish('alerts', 'UPDATE', alert);

          await this.db.logAuditAction({
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
        const notes =
          typeof body.notes === 'string'
            ? body.notes
            : typeof body.supervisorNotes === 'string'
            ? body.supervisorNotes
            : `Resolved by ${currentUser.name}`;

        const alert = await this.db.resolveAlert(alertId, notes);

        if (!alert) {
          this.sendJson(res, 404, { error: `Alert ${alertId} not found` });
        } else {
          // Realtime Broadcast
          RealtimePublisher.getInstance().publish('alerts', 'UPDATE', alert);

          await this.db.logAuditAction({
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

      // =========================================================================
      // 10. ANALYTICS & HISTORICAL INTELLIGENCE (/api/v1/analytics/*)
      // =========================================================================
      if (pathname.startsWith('/api/v1/analytics/')) {
        if (!currentUser) {
          this.sendJson(res, 401, { error: 'Unauthorized: Authentication required for analytics' });
          return true;
        }

        const fromParam = url.searchParams.get('from');
        const toParam = url.searchParams.get('to');
        const helmetIdParam = url.searchParams.get('helmetId');
        const workerIdParam = url.searchParams.get('workerId');
        const zoneIdParam = url.searchParams.get('zoneId');

        const range = AnalyticsEngine.validateTimeRange(fromParam, toParam);
        if (!range.valid || !range.from || !range.to || !range.fromMs || !range.toMs) {
          this.sendJson(res, 400, { error: range.error || 'Invalid time range parameters' });
          return true;
        }

        let userAssignedHelmetId: string | null = null;
        if (currentUser.role === 'WORKER' && currentUser.worker_id) {
          const helmets = await this.db.getHelmets();
          const h = helmets.find((hlm) => hlm.worker_id === currentUser.worker_id);
          userAssignedHelmetId = h ? h.id : null;
        }

        // --- GET /api/v1/analytics/helmets/:id ---
        const helmetAnalyticsMatch = pathname.match(/^\/api\/v1\/analytics\/helmets\/([^/]+)$/);
        if (helmetAnalyticsMatch && method === 'GET') {
          const targetHelmetId = helmetAnalyticsMatch[1];
          if (currentUser.role === 'WORKER' && userAssignedHelmetId && targetHelmetId !== userAssignedHelmetId) {
            this.sendJson(res, 403, { error: 'Forbidden: Workers may only inspect their assigned helmet analytics' });
            return true;
          }

          const helmet = await this.db.getHelmetWithDetails(targetHelmetId);
          if (!helmet) {
            this.sendJson(res, 404, { error: `Helmet ${targetHelmetId} not found` });
            return true;
          }

          const packets = await this.db.getTelemetryByRange({ from: range.from, to: range.to, helmetId: targetHelmetId });
          const telemetryAnalytics = AnalyticsEngine.computeTelemetryAnalytics(packets, range.fromMs, range.toMs);
          const alerts = await this.db.getAlertsByRange({ from: range.from, to: range.to, helmetId: targetHelmetId });
          const alertAnalytics = AnalyticsEngine.computeAlertAnalytics(alerts, range.fromMs, range.toMs);
          const assignments = await this.db.getZoneAssignmentsByRange({ from: range.from, to: range.to, workerId: helmet.worker_id || undefined });

          this.sendJson(res, 200, {
            helmet,
            timeRange: { from: range.from, to: range.to },
            telemetry: telemetryAnalytics,
            alerts: alertAnalytics,
            zoneHistory: assignments,
          });
          return true;
        }

        // --- GET /api/v1/analytics/workers/:id ---
        const workerAnalyticsMatch = pathname.match(/^\/api\/v1\/analytics\/workers\/([^/]+)$/);
        if (workerAnalyticsMatch && method === 'GET') {
          const targetWorkerId = workerAnalyticsMatch[1];
          if (currentUser.role === 'WORKER' && targetWorkerId !== currentUser.worker_id) {
            this.sendJson(res, 403, { error: 'Forbidden: Workers may only inspect their own worker analytics' });
            return true;
          }

          const worker = await this.db.getWorker(targetWorkerId);
          if (!worker) {
            this.sendJson(res, 404, { error: `Worker ${targetWorkerId} not found` });
            return true;
          }

          const allHelmets = await this.db.getHelmets();
          const assignedHelmet = allHelmets.find((h) => h.worker_id === worker.id);
          const packets = assignedHelmet
            ? await this.db.getTelemetryByRange({ from: range.from, to: range.to, helmetId: assignedHelmet.id })
            : [];
          const telemetryAnalytics = AnalyticsEngine.computeTelemetryAnalytics(packets, range.fromMs, range.toMs);
          const alerts = await this.db.getAlertsByRange({ from: range.from, to: range.to, workerId: worker.id });
          const alertAnalytics = AnalyticsEngine.computeAlertAnalytics(alerts, range.fromMs, range.toMs);
          const assignments = await this.db.getZoneAssignmentsByRange({ from: range.from, to: range.to, workerId: worker.id });

          this.sendJson(res, 200, {
            worker,
            assignedHelmet: assignedHelmet || null,
            timeRange: { from: range.from, to: range.to },
            telemetry: telemetryAnalytics,
            alerts: alertAnalytics,
            zoneHistory: assignments,
          });
          return true;
        }

        // Verify RBAC for general analytics queries
        const rbac = AnalyticsEngine.verifyRbacAccess(
          currentUser.role,
          currentUser.worker_id,
          userAssignedHelmetId,
          workerIdParam,
          helmetIdParam
        );
        if (!rbac.allowed) {
          this.sendJson(res, 403, { error: rbac.error });
          return true;
        }

        // Resolve helmets to include based on filters
        let targetHelmetIds: string[] | undefined = undefined;
        if (rbac.effectiveHelmetId) {
          targetHelmetIds = [rbac.effectiveHelmetId];
        } else if (rbac.effectiveWorkerId) {
          const allHelmets = await this.db.getHelmets();
          const h = allHelmets.find((item) => item.worker_id === rbac.effectiveWorkerId);
          targetHelmetIds = h ? [h.id] : [];
        } else if (zoneIdParam) {
          const zoneAssignments = await this.db.getZoneAssignmentsByRange({ from: range.from, to: range.to, zoneId: zoneIdParam });
          const wIds = new Set(zoneAssignments.map((a) => a.worker_id));
          const allHelmets = await this.db.getHelmets();
          targetHelmetIds = allHelmets
            .filter((h) => h.worker_id && wIds.has(h.worker_id))
            .map((h) => h.id);
        }

        // --- GET /api/v1/analytics/telemetry ---
        if (pathname === '/api/v1/analytics/telemetry' && method === 'GET') {
          const packets = await this.db.getTelemetryByRange({
            from: range.from,
            to: range.to,
            helmetIds: targetHelmetIds,
          });
          const telemetryAnalytics = AnalyticsEngine.computeTelemetryAnalytics(packets, range.fromMs, range.toMs);
          this.sendJson(res, 200, telemetryAnalytics);
          return true;
        }

        // --- GET /api/v1/analytics/alerts ---
        if (pathname === '/api/v1/analytics/alerts' && method === 'GET') {
          const alerts = await this.db.getAlertsByRange({
            from: range.from,
            to: range.to,
            helmetId: rbac.effectiveHelmetId,
            workerId: rbac.effectiveWorkerId,
            zoneId: zoneIdParam || undefined,
          });
          const alertAnalytics = AnalyticsEngine.computeAlertAnalytics(alerts, range.fromMs, range.toMs);
          this.sendJson(res, 200, alertAnalytics);
          return true;
        }

        // --- GET /api/v1/analytics/zones ---
        if (pathname === '/api/v1/analytics/zones' && method === 'GET') {
          const zones = await this.db.getZones();
          const assignments = await this.db.getZoneAssignmentsByRange({
            from: range.from,
            to: range.to,
            workerId: rbac.effectiveWorkerId,
          });
          const alerts = await this.db.getAlertsByRange({
            from: range.from,
            to: range.to,
            workerId: rbac.effectiveWorkerId,
          });
          const workers = await this.db.getWorkers();
          const zoneAnalytics = AnalyticsEngine.computeZoneAnalytics(
            zones,
            assignments,
            alerts,
            workers,
            range.fromMs,
            range.toMs
          );
          this.sendJson(res, 200, zoneAnalytics);
          return true;
        }

        // --- GET /api/v1/analytics/overview ---
        if (pathname === '/api/v1/analytics/overview' && method === 'GET') {
          const packets = await this.db.getTelemetryByRange({
            from: range.from,
            to: range.to,
            helmetIds: targetHelmetIds,
          });
          const telemetryAnalytics = AnalyticsEngine.computeTelemetryAnalytics(packets, range.fromMs, range.toMs);

          const alerts = await this.db.getAlertsByRange({
            from: range.from,
            to: range.to,
            helmetId: rbac.effectiveHelmetId,
            workerId: rbac.effectiveWorkerId,
            zoneId: zoneIdParam || undefined,
          });
          const alertAnalytics = AnalyticsEngine.computeAlertAnalytics(alerts, range.fromMs, range.toMs);

          const zones = await this.db.getZones();
          const assignments = await this.db.getZoneAssignmentsByRange({
            from: range.from,
            to: range.to,
            workerId: rbac.effectiveWorkerId,
          });
          const workers = await this.db.getWorkers();
          const zoneAnalytics = AnalyticsEngine.computeZoneAnalytics(
            zones,
            assignments,
            alerts,
            workers,
            range.fromMs,
            range.toMs
          );

          const helmets = await this.db.getRawHelmets();
          const connectivityAnalytics = AnalyticsEngine.computeConnectivityAnalytics(
            helmets,
            alerts,
            workers,
            range.fromMs,
            range.toMs
          );

          const overview: AnalyticsOverviewResult = {
            timeRange: {
              from: range.from,
              to: range.to,
              durationHours: Math.round((range.durationMs / (1000 * 3600)) * 10) / 10,
            },
            kpi: {
              totalPackets: telemetryAnalytics.packetCount,
              totalAlerts: alertAnalytics.totalAlerts,
              activeAlerts: alertAnalytics.activeAlerts,
              dangerEvents: telemetryAnalytics.safetyBreakdown?.dangerPackets || 0,
              warningEvents: telemetryAnalytics.safetyBreakdown?.warningPackets || 0,
              avgTemperature: telemetryAnalytics.metrics?.temperature.avg ?? null,
              avgHumidity: telemetryAnalytics.metrics?.humidity.avg ?? null,
              avgRawGas: telemetryAnalytics.metrics?.gas.avg ?? null,
              offlineHelmetCount: connectivityAnalytics.currentFleetStatus.offline,
            },
            telemetry: telemetryAnalytics,
            alerts: alertAnalytics,
            zones: zoneAnalytics,
            connectivity: connectivityAnalytics,
            activeFilters: {
              helmetId: rbac.effectiveHelmetId,
              workerId: rbac.effectiveWorkerId,
              zoneId: zoneIdParam || undefined,
            },
          };

          this.sendJson(res, 200, overview);
          return true;
        }
      }

      // If route started with /api/v1/ but wasn't matched:
      this.sendJson(res, 404, { error: `API endpoint not found: ${method} ${pathname}` });
      return true;
    } catch (err: unknown) {
      StructuredLogger.error({
        requestId: RequestIdManager.resolveRequestId(req, res),
        method,
        route: pathname,
        status: 500,
        message: err instanceof Error ? err.message : String(err),
      });

      this.sendJson(res, 500, { error: 'Internal Server Error' });
      return true;
    }
  }

  private sendJson(res: ServerResponse, statusCode: number, data: unknown): void {
    res.statusCode = statusCode;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify(data));
  }

  private async readJsonBody(
    req: IncomingMessage,
    pathname: string = ''
  ): Promise<Record<string, unknown> & { _malformed?: boolean; _tooLarge?: boolean }> {
    const limit = RequestLimiter.getLimitForPath(pathname);
    const result = await RequestLimiter.readLimitedJsonBody(req, limit);
    if (result.tooLarge) {
      return { _tooLarge: true };
    }
    if (result.parseError || !result.data || Array.isArray(result.data)) {
      return { _malformed: true };
    }
    return result.data;
  }
}
