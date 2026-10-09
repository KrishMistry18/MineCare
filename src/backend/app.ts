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
import { Readable } from 'stream';
import type { IDatabaseRepository } from './db/repositories/interfaces';
import { PostgresDatabaseRepository } from './db/repositories/PostgresDatabaseRepository';
import { DatabaseRepository } from './db/DatabaseRepository';
import { connectionManager } from './db/connection';
import { TelemetryValidator } from './validation/TelemetryValidator';
import { SafetyEngine } from './safety/SafetyEngine';
import { AlertEngine } from './alerts/AlertEngine';
import { OfflineEngine } from './offline/OfflineEngine';
import { AuthManager } from './auth/AuthManager';
import { RealtimePublisher } from './realtime/RealtimePublisher';
import { SimulationEngine } from './simulation/SimulationEngine';
import { AnalyticsEngine, type AnalyticsOverviewResult } from './analytics/AnalyticsEngine';
import type { DbTelemetry, UserRole, DbUserProfile } from './types';
import { getBackendConfig } from './config/env';
import { StructuredLogger } from './security/StructuredLogger';
import { RequestIdManager } from './security/RequestId';
import { SecurityHeadersManager } from './security/SecurityHeaders';
import { CorsManager } from './security/CorsManager';
import { RequestLimiter } from './security/RequestLimiter';
import { ApiError } from './security/ApiError';
import { InputValidator } from './security/InputValidator';
import { RateLimiter } from './security/RateLimiter';
import { DeviceAuthManager, DeviceTokenGenerator } from './security/DeviceAuth';
import { MetricsCollector } from './observability/MetricsCollector';

export class BackendApp {
  private static instance: BackendApp | null = null;
  private db: IDatabaseRepository;
  private authManager: AuthManager;
  private heartbeatTimer: NodeJS.Timeout | null = null;
  private readinessCache: { ready: boolean; timestamp: number } | null = null;
  private lastKnownDbStatus: 'CONNECTED' | 'DISCONNECTED' | 'UNKNOWN' = 'CONNECTED';

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
    if (typeof setInterval !== 'undefined' && !config.isTest) {
      let isCheckingHeartbeats = false;
      this.heartbeatTimer = setInterval(async () => {
        if (isCheckingHeartbeats) return;
        isCheckingHeartbeats = true;
        try {
          const helmets = await this.db.getRawHelmets();
          const alerts = await this.db.getActiveAlerts();
          const { statusChanges, newAlerts, resolvedAlerts } = OfflineEngine.checkFleetHeartbeats(helmets, alerts);

          for (const sc of statusChanges) {
            await this.db.updateHelmet(sc.helmetId, { online: sc.state === 'ONLINE' });
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
        } finally {
          isCheckingHeartbeats = false;
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
    if (BackendApp.instance) {
      BackendApp.instance.readinessCache = null;
      BackendApp.instance.lastKnownDbStatus = 'CONNECTED';
    }
    AuthManager.resetInstance();
    RateLimiter.resetInstance();
    DeviceAuthManager.resetRegistry();
    MetricsCollector.resetInstance();
    StructuredLogger.clearLogs();
    BackendApp.instance = null;
  }

  public setDb(db: IDatabaseRepository): void {
    this.db = db;
    this.authManager.setDb(db);
    this.readinessCache = null;
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

    (res as any)._startTime = Date.now();
    (res as any)._method = method;
    (res as any)._pathname = pathname;
    (res as any)._requestId = requestId;

    // 4. URI Length Protection
    if (RequestLimiter.isUriTooLong(req.url || '')) {
      this.sendJson(res, 414, ApiError.uriTooLong(requestId));
      return true;
    }

    // 5. Health, Liveness, and Readiness Probes (/healthz, /livez, /readyz)
    if (pathname === '/livez' || pathname === '/api/v1/livez') {
      if (method !== 'GET' && method !== 'HEAD') {
        this.sendJson(
          res,
          405,
          ApiError.methodNotAllowed(requestId, `Method ${method} not allowed on liveness endpoint`)
        );
        return true;
      }
      this.sendJson(res, 200, {
        status: 'ALIVE',
        live: true,
        uptime: process.uptime(),
        timestamp: new Date().toISOString(),
      });
      return true;
    }

    if (pathname === '/readyz' || pathname === '/api/v1/readyz') {
      if (method !== 'GET' && method !== 'HEAD') {
        this.sendJson(
          res,
          405,
          ApiError.methodNotAllowed(requestId, `Method ${method} not allowed on readiness endpoint`)
        );
        return true;
      }

      const config = getBackendConfig();

      // In production mode, reject development test doubles (pg-mem, in-memory mock repo)
      if (config.isProduction) {
        if (connectionManager.isPgMem() || !(this.db instanceof PostgresDatabaseRepository)) {
          this.lastKnownDbStatus = 'DISCONNECTED';
          this.sendJson(
            res,
            503,
            ApiError.serviceUnavailable(
              requestId,
              'Service Unavailable: Production mode requires authoritative PostgreSQL connection'
            )
          );
          return true;
        }
      }

      // Check short-lived readiness cache (2000ms TTL)
      const now = Date.now();
      let isReady = false;
      if (this.readinessCache && (now - this.readinessCache.timestamp < 2000)) {
        isReady = this.readinessCache.ready;
      } else {
        try {
          // Bounded-time database ping (timeout after 3000ms)
          const timeoutPromise = new Promise<boolean>((_, reject) =>
            setTimeout(() => reject(new Error('Database connectivity check timed out')), 3000).unref()
          );

          const pingPromise = (async () => {
            if (typeof (this.db as any).ping === 'function') {
              return await (this.db as any).ping();
            }
            const health = await this.db.getSystemHealth();
            return Boolean(health && health.services?.database?.status === 'CONNECTED');
          })();

          isReady = await Promise.race([pingPromise, timeoutPromise]);
        } catch {
          isReady = false;
        }
        this.readinessCache = { ready: isReady, timestamp: now };
      }

      this.lastKnownDbStatus = isReady ? 'CONNECTED' : 'DISCONNECTED';

      if (isReady) {
        this.sendJson(res, 200, {
          status: 'READY',
          ready: true,
          database: 'CONNECTED',
          timestamp: new Date().toISOString(),
        });
      } else {
        this.sendJson(
          res,
          503,
          ApiError.serviceUnavailable(requestId, 'Required PostgreSQL dependency unavailable')
        );
      }
      return true;
    }

    if (pathname === '/healthz' || pathname === '/api/v1/healthz') {
      if (method !== 'GET' && method !== 'HEAD') {
        this.sendJson(
          res,
          405,
          ApiError.methodNotAllowed(requestId, `Method ${method} not allowed on health endpoint`)
        );
        return true;
      }

      // Basic liveness probe answers: "Is the process alive?"
      // Does not require or block on a database query for basic liveness.
      const uptimeSec = Math.floor(process.uptime());
      const dbStatus = this.lastKnownDbStatus;

      this.sendJson(res, 200, {
        status: 'OPERATIONAL',
        live: true,
        uptimeSeconds: uptimeSec,
        services: {
          process: { status: 'ALIVE' },
          database: { status: dbStatus },
        },
        timestamp: new Date().toISOString(),
      });
      return true;
    }

    if (!pathname.startsWith('/api/v1/')) {
      return false; // Not handled by API router
    }

    const clientIp = this.resolveClientAddress(req);


    try {
      // 6. General API Rate Limiting (300 requests/minute on general endpoints)
      const isExemptFromGeneral =
        pathname === '/api/v1/system/health' ||
        pathname === '/api/v1/auth/login' ||
        pathname === '/api/v1/telemetry' ||
        pathname.startsWith('/api/v1/admin/');

      if (!isExemptFromGeneral) {
        const generalRateCheck = await RateLimiter.getInstance().checkLimit('GENERAL', clientIp);
        RateLimiter.getInstance().applyHeaders(res, generalRateCheck);

        if (!generalRateCheck.allowed) {
          MetricsCollector.getInstance().recordRateLimitEvent('GENERAL', clientIp);
          this.sendJson(
            res,
            429,
            ApiError.rateLimited(
              requestId,
              generalRateCheck.retryAfterSeconds || 1,
              'Too Many Requests: API rate limit exceeded'
            )
          );
          return true;
        }
      }

      // =========================================================================
      // 1. AUTHENTICATION ENDPOINTS (Public)
      // =========================================================================

      // POST /api/v1/auth/login
      if (pathname === '/api/v1/auth/login') {
        if (method !== 'POST') {
          this.sendJson(
            res,
            405,
            ApiError.methodNotAllowed(requestId, `Method ${method} not allowed on /api/v1/auth/login`)
          );
          return true;
        }
        const body = await this.readJsonBody(req, pathname);
        if (body._tooLarge) {
          this.sendJson(res, 413, ApiError.payloadTooLarge(requestId));
          return true;
        }
        if (body._unsupportedMediaType) {
          this.sendJson(res, 415, ApiError.unsupportedMediaType(requestId));
          return true;
        }
        if (body._malformed) {
          this.sendJson(res, 401, ApiError.unauthorized(requestId, 'Invalid or malformed request payload'));
          return true;
        }
        const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
        const password = typeof body.password === 'string' ? body.password : '';

        // Rate limiting: AUTH tier (5 attempts / 15 minutes to protect against brute-force)
        const authIdentifier = `${clientIp}_${email || 'anonymous'}`;
        const rateCheck = await RateLimiter.getInstance().checkLimit('AUTH', authIdentifier);
        RateLimiter.getInstance().applyHeaders(res, rateCheck);

        if (!rateCheck.allowed) {
          MetricsCollector.getInstance().recordRateLimitEvent('AUTH', authIdentifier);
          this.sendJson(
            res,
            429,
            ApiError.rateLimited(
              requestId,
              rateCheck.retryAfterSeconds || 60,
              'Too Many Requests: Login rate limit exceeded. Please try again later.'
            )
          );
          return true;
        }

        const authResult = await this.authManager.login(email, password);

        if ('error' in authResult) {
          MetricsCollector.getInstance().recordDeviceSecurityEvent(
            'FAILED_LOGIN_ATTEMPT',
            { email },
            requestId,
            clientIp
          );
          this.sendJson(res, authResult.code, ApiError.unauthorized(requestId, authResult.error));
        } else {
          // Reset rate limit on successful authentication
          await RateLimiter.getInstance().reset('AUTH', authIdentifier);
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
        const body = await this.readJsonBody(req, pathname);
        if (body._tooLarge) {
          this.sendJson(res, 413, ApiError.payloadTooLarge(requestId));
          return true;
        }
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
          this.sendJson(res, 401, ApiError.unauthorized(requestId, 'Unauthorized or session expired'));
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
      if (pathname === '/api/v1/telemetry') {
        if (method !== 'POST') {
          this.sendJson(
            res,
            405,
            ApiError.methodNotAllowed(requestId, `Method ${method} not allowed on /api/v1/telemetry`)
          );
          return true;
        }
        const body = await this.readJsonBody(req, pathname);
        if (body._tooLarge) {
          this.sendJson(res, 413, ApiError.payloadTooLarge(requestId));
          return true;
        }
        if (body._unsupportedMediaType) {
          this.sendJson(res, 415, ApiError.unsupportedMediaType(requestId));
          return true;
        }

        const validation = TelemetryValidator.validate(body);

        if (!validation.isValid || !validation.packet) {
          MetricsCollector.getInstance().recordTelemetryValidationFailure('Validation Failed', validation.errors);
          this.sendJson(res, 400, ApiError.badRequest(requestId, 'Validation Failed', validation.errors));
          return true;
        }

        const packet = validation.packet;

        // Device Authentication Boundary (Hardware identity separate from human JWT)
        const authHeader = req.headers.authorization;
        const currentUser = authHeader ? await this.authManager.authenticateRequest(req) : null;
        const isProduction = getBackendConfig().isProduction;

        const deviceAuth = await DeviceAuthManager.authenticateTelemetryRequest(
          req,
          currentUser,
          isProduction,
          packet.helmetId,
          this.db
        );
        if (!deviceAuth.isAuthenticated) {
          const status = deviceAuth.statusCode || 401;
          const errPayload =
            status === 403
              ? ApiError.forbidden(requestId, deviceAuth.error || 'Access denied: Device not bound to helmet')
              : ApiError.unauthorized(requestId, deviceAuth.error || 'Unauthorized: Valid device credentials required');

          const rawToken = req.headers['x-device-token'];
          const devToken = typeof rawToken === 'string' ? rawToken : '';
          const tokenPrefix = devToken ? DeviceTokenGenerator.getPrefix(devToken) : '';
          const isRevoked = devToken && (
            DeviceAuthManager.isTokenRevoked(devToken) ||
            Boolean(deviceAuth.error?.toLowerCase().includes('revoked'))
          );
          const isMismatch = Boolean(deviceAuth.error?.includes('bound to helmet'));

          if (isRevoked) {
            MetricsCollector.getInstance().recordDeviceSecurityEvent(
              'REVOKED_DEVICE_TOKEN',
              { token: devToken, tokenPrefix, targetHelmetId: packet.helmetId },
              requestId,
              clientIp
            );
          } else if (isMismatch) {
            MetricsCollector.getInstance().recordDeviceSecurityEvent(
              'DEVICE_HELMET_MISMATCH',
              { token: devToken, tokenPrefix, targetHelmetId: packet.helmetId },
              requestId,
              clientIp
            );
          } else {
            MetricsCollector.getInstance().recordDeviceSecurityEvent(
              'INVALID_DEVICE_TOKEN',
              { token: devToken, tokenPrefix, targetHelmetId: packet.helmetId, authType: deviceAuth.authType },
              requestId,
              clientIp
            );
          }

          this.sendJson(res, status, errPayload);
          return true;
        }

        // Rate limiting: TELEMETRY tier (120 packets / minute)
        const teleIdentifier = packet.helmetId || clientIp;
        const teleRateCheck = await RateLimiter.getInstance().checkLimit('TELEMETRY', teleIdentifier);
        RateLimiter.getInstance().applyHeaders(res, teleRateCheck);

        if (!teleRateCheck.allowed) {
          MetricsCollector.getInstance().recordRateLimitEvent('TELEMETRY', teleIdentifier);
          this.sendJson(
            res,
            429,
            ApiError.rateLimited(
              requestId,
              teleRateCheck.retryAfterSeconds || 1,
              'Too Many Requests: Telemetry ingestion rate limit exceeded'
            )
          );
          return true;
        }

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
        await this.db.updateHelmet(packet.helmetId, {
          status: safety.status,
          online: true,
          last_seen: packet.timestamp,
        });

        // Authoritative Alert Lifecycle
        const helmet = await this.db.getHelmet(packet.helmetId);
        const existingAlerts = await this.db.getActiveAlerts();
        const alertResult = AlertEngine.processAlerts(
          existingAlerts,
          packet.helmetId,
          helmet?.worker_id || null,
          packet,
          safety
        );

        if (alertResult.createdAlert) {
          await this.db.saveAlert(alertResult.createdAlert);
          MetricsCollector.getInstance().recordAlertCreated(
            alertResult.createdAlert.id,
            packet.helmetId,
            alertResult.createdAlert.type,
            alertResult.createdAlert.severity
          );
        }
        for (const resolved of alertResult.resolvedAlerts) {
          await this.db.resolveAlert(resolved.id, resolved.supervisor_notes || 'Auto-resolved');
          MetricsCollector.getInstance().recordAlertResolved(resolved.id);
        }

        // Operational Hazard Tracking
        MetricsCollector.getInstance().recordTelemetryPacket(packet.packetId, packet.helmetId);
        if (packet.sosPressed) {
          MetricsCollector.getInstance().recordHazardEvent('SOS', packet.helmetId);
        }
        if (packet.fallDetected || packet.totalAcceleration > 15) {
          MetricsCollector.getInstance().recordHazardEvent('FALL', packet.helmetId);
        }
        if (packet.gasValue > 800) {
          MetricsCollector.getInstance().recordHazardEvent('GAS', packet.helmetId);
        }
        if (packet.temperature > 40) {
          MetricsCollector.getInstance().recordHazardEvent('TEMPERATURE', packet.helmetId);
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
      if (pathname === '/api/v1/system/health') {
        if (method !== 'GET' && method !== 'HEAD') {
          this.sendJson(
            res,
            405,
            ApiError.methodNotAllowed(requestId, `Method ${method} not allowed on /api/v1/system/health`)
          );
          return true;
        }
        const health = await this.db.getSystemHealth();
        this.sendJson(res, 200, health);
        return true;
      }

      // =========================================================================
      // 3.1 SIMULATION SCENARIO INGESTION (Supervisor / Admin Simulation)
      // =========================================================================
      if (pathname === '/api/v1/simulation/scenario') {
        if (method !== 'POST') {
          this.sendJson(
            res,
            405,
            ApiError.methodNotAllowed(requestId, `Method ${method} not allowed on /api/v1/simulation/scenario`)
          );
          return true;
        }
        const body = await this.readJsonBody(req, pathname);
        if (body._tooLarge) {
          this.sendJson(res, 413, ApiError.payloadTooLarge(requestId));
          return true;
        }
        if (body._unsupportedMediaType) {
          this.sendJson(res, 415, ApiError.unsupportedMediaType(requestId));
          return true;
        }

        // 1. Authorization: Only authenticated SUPERVISOR or ADMIN can trigger simulation
        const currentUser = await this.authManager.authenticateRequest(req);
        if (!currentUser) {
          this.sendJson(res, 401, ApiError.unauthorized(requestId, 'Authentication required to trigger simulation scenario'));
          return true;
        }

        if (currentUser.role !== 'ADMIN' && currentUser.role !== 'SUPERVISOR') {
          this.sendJson(
            res,
            403,
            ApiError.forbidden(requestId, 'Forbidden: Only supervisors and administrators may trigger simulation scenarios')
          );
          return true;
        }

        // Rate limiting: ADMIN tier (60 requests / minute) on privileged simulation route
        const simIdentifier = `SIM_${currentUser.id || currentUser.email || clientIp}`;
        const simRateCheck = await RateLimiter.getInstance().checkLimit('ADMIN', simIdentifier);
        RateLimiter.getInstance().applyHeaders(res, simRateCheck);

        if (!simRateCheck.allowed) {
          MetricsCollector.getInstance().recordRateLimitEvent('ADMIN', simIdentifier);
          this.sendJson(
            res,
            429,
            ApiError.rateLimited(
              requestId,
              simRateCheck.retryAfterSeconds || 1,
              'Too Many Requests: Simulation scenario rate limit exceeded'
            )
          );
          return true;
        }

        // 2. Validate Target Helmet ID in Commissioned Fleet
        const helmetId = typeof body.helmetId === 'string' ? body.helmetId.trim() : 'MC-001';
        const helmet = await this.db.getHelmet(helmetId);
        if (!helmet) {
          this.sendJson(res, 404, ApiError.notFound(requestId, `Target helmet ${helmetId} not found in commissioned fleet`));
          return true;
        }

        const rawScenario = typeof body.scenario === 'string' ? body.scenario.trim() : 'HIGH_GAS';
        const scenario = SimulationEngine.normalizeScenario(rawScenario);

        // 3. Handle OFFLINE scenario directly if requested
        if (scenario === 'HELMET_OFFLINE') {
          await this.db.updateHelmet(helmetId, { online: false });
          const updatedHelmet = await this.db.getHelmetWithDetails(helmetId);
          if (updatedHelmet) {
            RealtimePublisher.getInstance().publish('helmets', 'UPDATE', updatedHelmet);
          }
          this.sendJson(res, 200, {
            success: true,
            simulation: true,
            scenario: 'HELMET_OFFLINE',
            helmetId,
            online: false,
          });
          return true;
        }

        // 4. Generate Telemetry Packet Server-Side
        const packet = SimulationEngine.buildScenarioPacket(helmetId, scenario);

        // 5. Ingest through production telemetry ingestion boundary (/api/v1/telemetry)
        // using the bound simulated device credential X-Device-Token: mc_dev_${helmetId}
        const packetBuffer = Buffer.from(JSON.stringify(packet));
        const stream = Readable.from(packetBuffer);
        const simReq = Object.assign(stream, {
          method: 'POST',
          url: '/api/v1/telemetry',
          headers: {
            host: req.headers.host || 'localhost:3001',
            'content-type': 'application/json',
            'content-length': String(packetBuffer.length),
            'x-device-token': `mc_dev_${helmetId}`,
            'x-request-id': requestId,
          },
          socket: req.socket || { remoteAddress: clientIp },
        }) as unknown as IncomingMessage;

        const resChunks: Buffer[] = [];
        let simStatusCode = 200;
        const simHeaders: Record<string, string> = {};

        const simRes = {
          statusCode: 200,
          setHeader: (name: string, value: string) => {
            simHeaders[name.toLowerCase()] = value;
          },
          getHeader: (name: string) => simHeaders[name.toLowerCase()],
          getHeaders: () => simHeaders,
          write: (chunk: any) => {
            if (chunk) resChunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
            return true;
          },
          end: (chunk?: any) => {
            if (chunk) resChunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
          },
        } as unknown as ServerResponse;

        await this.handleRequest(simReq, simRes);
        simStatusCode = simRes.statusCode || 200;

        let parsedResponse: any = null;
        try {
          const bodyStr = Buffer.concat(resChunks).toString('utf-8');
          parsedResponse = JSON.parse(bodyStr);
        } catch {
          parsedResponse = { status: simStatusCode };
        }

        const updatedHelmet = await this.db.getHelmetWithDetails(helmetId);
        const latestTelemetry = await this.db.getLatestTelemetry(helmetId);
        const activeAlerts = await this.db.getActiveAlerts();
        const helmetActiveAlerts = activeAlerts.filter((a) => a.helmet_id === helmetId);

        const returnedAlerts = parsedResponse.alert
          ? [parsedResponse.alert, ...helmetActiveAlerts.filter((a) => a.id !== parsedResponse.alert.id)]
          : helmetActiveAlerts;

        this.sendJson(res, simStatusCode === 201 ? 201 : simStatusCode, {
          success: simStatusCode === 201,
          simulation: true,
          scenario,
          helmetId,
          telemetry: latestTelemetry,
          helmet: updatedHelmet,
          alerts: returnedAlerts,
          ...parsedResponse,
        });
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
          this.sendJson(res, 401, ApiError.unauthorized(requestId, 'Unauthorized: Authentication required for realtime stream'));
          return true;
        }
        if (!currentUser.active) {
          this.sendJson(res, 403, ApiError.forbidden(requestId, 'Forbidden: Inactive user account cannot subscribe to realtime stream'));
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
          this.sendJson(res, 401, ApiError.unauthorized(requestId, 'Unauthorized: Authentication required'));
          return true;
        }
        if (currentUser.role !== 'ADMIN') {
          this.sendJson(res, 403, ApiError.forbidden(requestId, 'Forbidden: Admin access required'));
          return true;
        }

        // Rate limiting: ADMIN tier (60 requests / minute)
        const adminIdentifier = currentUser.id || clientIp;
        const adminRateCheck = await RateLimiter.getInstance().checkLimit('ADMIN', adminIdentifier);
        RateLimiter.getInstance().applyHeaders(res, adminRateCheck);

        if (!adminRateCheck.allowed) {
          MetricsCollector.getInstance().recordRateLimitEvent('ADMIN', adminIdentifier);
          this.sendJson(
            res,
            429,
            ApiError.rateLimited(
              requestId,
              adminRateCheck.retryAfterSeconds || 1,
              'Too Many Requests: Admin rate limit exceeded'
            )
          );
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
          const body = await this.readJsonBody(req, pathname);
          if (body._tooLarge) {
            this.sendJson(res, 413, ApiError.payloadTooLarge(requestId));
            return true;
          }
          if (body._malformed) {
            this.sendJson(res, 400, ApiError.badRequest(requestId, 'Invalid or malformed request payload'));
            return true;
          }
          const name = String(body.name || '');
          const email = String(body.email || '').trim().toLowerCase();
          const role = String(body.role || '').toUpperCase() as UserRole;
          const worker_id = typeof body.worker_id === 'string' ? body.worker_id : undefined;

          if (!name || !email || !role) {
            this.sendJson(res, 400, ApiError.badRequest(requestId, 'Name, email, and role are required'));
            return true;
          }
          if (!['ADMIN', 'SUPERVISOR', 'WORKER'].includes(role)) {
            this.sendJson(res, 400, ApiError.badRequest(requestId, 'Invalid role. Must be ADMIN, SUPERVISOR, or WORKER'));
            return true;
          }

          const existing = await this.db.getProfileByEmail(email);
          if (existing) {
            this.sendJson(res, 409, ApiError.conflict(requestId, `User with email ${email} already exists`));
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

          MetricsCollector.getInstance().recordDeviceSecurityEvent(
            'ADMIN_SECURITY_ACTION',
            { action: 'USER_CREATE', targetUserId: newProfile.id, role: newProfile.role },
            requestId,
            clientIp
          );

          this.sendJson(res, 201, { success: true, profile: newProfile });
          return true;
        }

        // PUT /api/v1/admin/users/:id/role
        const userRoleMatch = pathname.match(/^\/api\/v1\/admin\/users\/([^/]+)\/role$/);
        if (userRoleMatch && method === 'PUT') {
          const targetUserId = userRoleMatch[1];
          const userVal = InputValidator.validateEntityId(targetUserId, 'userId');
          if (!userVal.isValid) {
            this.sendJson(res, 400, ApiError.badRequest(requestId, userVal.errors.join('; ')));
            return true;
          }
          const cleanTargetUserId = userVal.sanitized!;

          const body = await this.readJsonBody(req, pathname);
          if (body._tooLarge) {
            this.sendJson(res, 413, ApiError.payloadTooLarge(requestId));
            return true;
          }
          if (body._malformed) {
            this.sendJson(res, 400, ApiError.badRequest(requestId, 'Invalid or malformed request payload'));
            return true;
          }
          const newRole = String(body.role || '').toUpperCase() as UserRole;

          if (!['ADMIN', 'SUPERVISOR', 'WORKER'].includes(newRole)) {
            this.sendJson(res, 400, ApiError.badRequest(requestId, 'Invalid role. Must be ADMIN, SUPERVISOR, or WORKER'));
            return true;
          }

          const existing = await this.db.getProfile(cleanTargetUserId);
          if (!existing) {
            this.sendJson(res, 404, ApiError.notFound(requestId, `User profile ${cleanTargetUserId} not found`));
            return true;
          }

          const oldRole = existing.role;
          const updated = await this.db.updateProfile(cleanTargetUserId, {
            role: newRole,
            worker_id: newRole === 'WORKER' ? (existing.worker_id ?? null) : null,
          });

          await this.db.logAuditAction({
            user_id: currentUser.id,
            user_email: currentUser.email,
            role: currentUser.role,
            action: 'ROLE_CHANGE',
            target_type: 'USER',
            target_id: cleanTargetUserId,
            details: { oldRole, newRole },
          });

          MetricsCollector.getInstance().recordDeviceSecurityEvent(
            'ADMIN_SECURITY_ACTION',
            { action: 'ROLE_CHANGE', targetUserId: cleanTargetUserId, oldRole, newRole },
            requestId,
            clientIp
          );

          this.sendJson(res, 200, { success: true, profile: updated });
          return true;
        }

        // GET /api/v1/admin/audit-logs
        if (pathname === '/api/v1/admin/audit-logs' && method === 'GET') {
          const pagination = InputValidator.validatePagination(
            url.searchParams.get('limit'),
            url.searchParams.get('offset'),
            100,
            1000
          );
          if (!pagination.isValid) {
            this.sendJson(res, 400, ApiError.badRequest(requestId, pagination.errors.join('; ')));
            return true;
          }
          const logs = await this.db.getAuditLogs(pagination.sanitized!.limit);
          this.sendJson(res, 200, logs);
          return true;
        }

        // GET /api/v1/admin/metrics (Production Observability Snapshot)
        if (pathname === '/api/v1/admin/metrics' && method === 'GET') {
          const snapshot = await MetricsCollector.getInstance().getSnapshot(this.db);
          this.sendJson(res, 200, snapshot);
          return true;
        }

        // POST /api/v1/admin/helmets/:id/device-token (Provision or Rotate Hardware Token)
        const helmetTokenMatch = pathname.match(/^\/api\/v1\/admin\/helmets\/([^/]+)\/device-token$/);
        if (helmetTokenMatch && method === 'POST') {
          const helmetId = helmetTokenMatch[1];
          const helmetVal = InputValidator.validateEntityId(helmetId, 'helmetId');
          if (!helmetVal.isValid) {
            this.sendJson(res, 400, ApiError.badRequest(requestId, helmetVal.errors.join('; ')));
            return true;
          }
          const cleanHelmetId = helmetVal.sanitized!;

          const helmet = await this.db.getHelmet(cleanHelmetId);
          if (!helmet) {
            this.sendJson(res, 404, ApiError.notFound(requestId, `Helmet ${cleanHelmetId} not found`));
            return true;
          }

          const body = await this.readJsonBody(req, pathname);
          if (body._tooLarge) {
            this.sendJson(res, 413, ApiError.payloadTooLarge(requestId));
            return true;
          }
          if (body._malformed) {
            this.sendJson(res, 400, ApiError.badRequest(requestId, 'Invalid or malformed request payload'));
            return true;
          }

          const deviceName =
            typeof body.name === 'string' && body.name.trim()
              ? body.name.trim().slice(0, 100)
              : 'ESP8266 Sensor Node';

          // Generate 256-bit CSPRNG raw token and SHA-256 hash
          const { rawToken, tokenHash, tokenPrefix } = DeviceTokenGenerator.generate(cleanHelmetId);

          try {
            // Atomic transaction in repository: revokes previous active token, inserts new hashed token
            const record = await this.db.provisionDeviceToken({
              helmetId: cleanHelmetId,
              tokenHash,
              tokenPrefix,
              createdBy: currentUser.email || currentUser.id,
              name: deviceName,
            });

            // Audit log without raw credentials
            await this.db.logAuditAction({
              user_id: currentUser.id,
              user_email: currentUser.email,
              role: currentUser.role,
              action: 'DEVICE_TOKEN_PROVISIONED',
              target_type: 'HELMET',
              target_id: cleanHelmetId,
              details: {
                token_prefix: tokenPrefix,
                helmet_id: cleanHelmetId,
                name: record.name,
                action_type: 'PROVISION_AND_ROTATE',
              },
            });

            MetricsCollector.getInstance().recordDeviceSecurityEvent(
              'ADMIN_SECURITY_ACTION',
              { action: 'DEVICE_TOKEN_PROVISIONED', helmetId: cleanHelmetId, tokenPrefix },
              requestId,
              clientIp
            );

            // Raw token is returned EXACTLY ONCE upon successful creation
            this.sendJson(res, 201, {
              success: true,
              message: 'Device token provisioned successfully. Record this token immediately; it cannot be retrieved again.',
              token: rawToken,
              helmetId: cleanHelmetId,
              tokenPrefix,
              createdAt: record.created_at,
              name: record.name,
            });
            return true;
          } catch (err: unknown) {
            const errMsg = err instanceof Error ? err.message : String(err);
            StructuredLogger.error({
              message: 'Failed to provision device token',
              meta: { helmetId: cleanHelmetId, error: errMsg },
              requestId,
            });
            this.sendJson(res, 500, ApiError.internal(requestId, 'Database failure while provisioning device token'));
            return true;
          }
        }

        // POST /api/v1/admin/helmets/:id/device-token/revoke (Revoke Active Hardware Token)
        const revokeTokenMatch = pathname.match(/^\/api\/v1\/admin\/helmets\/([^/]+)\/device-token\/revoke$/);
        if (revokeTokenMatch && method === 'POST') {
          const helmetId = revokeTokenMatch[1];
          const helmetVal = InputValidator.validateEntityId(helmetId, 'helmetId');
          if (!helmetVal.isValid) {
            this.sendJson(res, 400, ApiError.badRequest(requestId, helmetVal.errors.join('; ')));
            return true;
          }
          const cleanHelmetId = helmetVal.sanitized!;

          const helmet = await this.db.getHelmet(cleanHelmetId);
          if (!helmet) {
            this.sendJson(res, 404, ApiError.notFound(requestId, `Helmet ${cleanHelmetId} not found`));
            return true;
          }

          const body = await this.readJsonBody(req, pathname);
          if (body._tooLarge) {
            this.sendJson(res, 413, ApiError.payloadTooLarge(requestId));
            return true;
          }
          if (body._malformed) {
            this.sendJson(res, 400, ApiError.badRequest(requestId, 'Invalid or malformed request payload'));
            return true;
          }

          const reason =
            typeof body.reason === 'string' && body.reason.trim()
              ? body.reason.trim().slice(0, 200)
              : 'ADMIN_MANUAL_REVOCATION';

          try {
            const revokedCount = await this.db.revokeDeviceToken(
              cleanHelmetId,
              currentUser.email || currentUser.id,
              reason
            );

            await this.db.logAuditAction({
              user_id: currentUser.id,
              user_email: currentUser.email,
              role: currentUser.role,
              action: 'DEVICE_TOKEN_REVOKED',
              target_type: 'HELMET',
              target_id: cleanHelmetId,
              details: {
                helmet_id: cleanHelmetId,
                revoked_count: revokedCount,
                reason,
              },
            });

            MetricsCollector.getInstance().recordDeviceSecurityEvent(
              'ADMIN_SECURITY_ACTION',
              { action: 'DEVICE_TOKEN_REVOKED', helmetId: cleanHelmetId, revokedCount },
              requestId,
              clientIp
            );

            this.sendJson(res, 200, {
              success: true,
              message: `Revoked ${revokedCount} active device token(s) for helmet ${cleanHelmetId}`,
              helmetId: cleanHelmetId,
              revokedCount,
            });
            return true;
          } catch (err: unknown) {
            const errMsg = err instanceof Error ? err.message : String(err);
            StructuredLogger.error({
              message: 'Failed to revoke device token',
              meta: { helmetId: cleanHelmetId, error: errMsg },
              requestId,
            });
            this.sendJson(res, 500, ApiError.internal(requestId, 'Database failure while revoking device token'));
            return true;
          }
        }

        // GET /api/v1/admin/helmets/:id/device-token (Inspect Active Device Token Metadata)
        if (helmetTokenMatch && method === 'GET') {
          const helmetId = helmetTokenMatch[1];
          const helmetVal = InputValidator.validateEntityId(helmetId, 'helmetId');
          if (!helmetVal.isValid) {
            this.sendJson(res, 400, ApiError.badRequest(requestId, helmetVal.errors.join('; ')));
            return true;
          }
          const cleanHelmetId = helmetVal.sanitized!;

          const helmet = await this.db.getHelmet(cleanHelmetId);
          if (!helmet) {
            this.sendJson(res, 404, ApiError.notFound(requestId, `Helmet ${cleanHelmetId} not found`));
            return true;
          }

          const activeToken = await this.db.getActiveDeviceToken(cleanHelmetId);

          this.sendJson(res, 200, {
            success: true,
            helmetId: cleanHelmetId,
            hasActiveToken: Boolean(activeToken),
            token: activeToken
              ? {
                  id: activeToken.id,
                  tokenPrefix: activeToken.token_prefix,
                  name: activeToken.name,
                  createdAt: activeToken.created_at,
                  createdBy: activeToken.created_by,
                  lastUsedAt: activeToken.last_used_at,
                }
              : null,
          });
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
        const helmetVal = InputValidator.validateEntityId(helmetId, 'helmetId');
        if (!helmetVal.isValid) {
          this.sendJson(res, 400, ApiError.badRequest(requestId, helmetVal.errors.join('; ')));
          return true;
        }
        const cleanHelmetId = helmetVal.sanitized!;

        const allHelmets = await this.db.getHelmets();
        const helmet = allHelmets.find((h) => h.id === cleanHelmetId || h.helmet_code === cleanHelmetId);

        if (!helmet) {
          this.sendJson(res, 404, { error: `No telemetry recorded for helmet ${cleanHelmetId}` });
          return true;
        }

        if (currentUser.role === 'WORKER' && helmet.worker_id !== currentUser.worker_id) {
          this.sendJson(res, 403, { error: 'Forbidden: Workers cannot inspect other helmets telemetry' });
          return true;
        }

        const latest = await this.db.getLatestTelemetry(helmet.id);
        if (!latest) {
          this.sendJson(res, 404, { error: `No telemetry recorded for helmet ${cleanHelmetId}` });
        } else {
          this.sendJson(res, 200, latest);
        }
        return true;
      }

      // GET /api/v1/helmets/:id/history
      const helmetHistoryMatch = pathname.match(/^\/api\/v1\/helmets\/([^/]+)\/history$/);
      if (helmetHistoryMatch && method === 'GET') {
        const helmetId = helmetHistoryMatch[1];
        const helmetVal = InputValidator.validateEntityId(helmetId, 'helmetId');
        if (!helmetVal.isValid) {
          this.sendJson(res, 400, ApiError.badRequest(requestId, helmetVal.errors.join('; ')));
          return true;
        }
        const cleanHelmetId = helmetVal.sanitized!;

        const pagination = InputValidator.validatePagination(
          url.searchParams.get('limit'),
          url.searchParams.get('offset'),
          50,
          1000
        );
        if (!pagination.isValid) {
          this.sendJson(res, 400, ApiError.badRequest(requestId, pagination.errors.join('; ')));
          return true;
        }

        const allHelmets = await this.db.getHelmets();
        const helmet = allHelmets.find((h) => h.id === cleanHelmetId || h.helmet_code === cleanHelmetId);

        if (!helmet) {
          this.sendJson(res, 404, { error: `Helmet ${cleanHelmetId} not found` });
          return true;
        }

        if (currentUser.role === 'WORKER' && helmet.worker_id !== currentUser.worker_id) {
          this.sendJson(res, 403, { error: 'Forbidden: Workers cannot inspect other helmets telemetry' });
          return true;
        }

        const history = await this.db.getTelemetryHistory(helmet.id, pagination.sanitized!.limit);
        this.sendJson(res, 200, history);
        return true;
      }

      // GET /api/v1/helmets/:id
      const helmetMatch = pathname.match(/^\/api\/v1\/helmets\/([^/]+)$/);
      if (helmetMatch && method === 'GET') {
        const helmetId = helmetMatch[1];
        const helmetVal = InputValidator.validateEntityId(helmetId, 'helmetId');
        if (!helmetVal.isValid) {
          this.sendJson(res, 400, ApiError.badRequest(requestId, helmetVal.errors.join('; ')));
          return true;
        }
        const cleanHelmetId = helmetVal.sanitized!;

        const allHelmets = await this.db.getHelmets();
        const helmet = allHelmets.find((h) => h.id === cleanHelmetId || h.helmet_code === cleanHelmetId);

        if (!helmet) {
          this.sendJson(res, 404, { error: `Helmet ${cleanHelmetId} not found` });
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
        const workerVal = InputValidator.validateEntityId(workerId, 'workerId');
        if (!workerVal.isValid) {
          this.sendJson(res, 400, ApiError.badRequest(requestId, workerVal.errors.join('; ')));
          return true;
        }
        const cleanWorkerId = workerVal.sanitized!;

        if (currentUser.role === 'WORKER' && cleanWorkerId !== currentUser.worker_id) {
          this.sendJson(res, 403, { error: 'Forbidden: Workers cannot view other workers profiles' });
          return true;
        }

        const worker = await this.db.getWorker(cleanWorkerId);
        if (!worker) {
          this.sendJson(res, 404, { error: `Worker ${cleanWorkerId} not found` });
        } else {
          this.sendJson(res, 200, worker);
        }
        return true;
      }

      // POST /api/v1/workers/:id/check-in
      const workerCheckInMatch = pathname.match(/^\/api\/v1\/workers\/([^/]+)\/check-in$/);
      if (workerCheckInMatch && method === 'POST') {
        const workerId = workerCheckInMatch[1];
        const workerVal = InputValidator.validateEntityId(workerId, 'workerId');
        if (!workerVal.isValid) {
          this.sendJson(res, 400, ApiError.badRequest(requestId, workerVal.errors.join('; ')));
          return true;
        }
        const cleanWorkerId = workerVal.sanitized!;

        // Worker can only check in themselves
        if (currentUser.role === 'WORKER' && cleanWorkerId !== currentUser.worker_id) {
          this.sendJson(res, 403, { error: 'Forbidden: Workers cannot check in other workers' });
          return true;
        }

        const body = await this.readJsonBody(req, pathname);
        if (body._tooLarge) {
          this.sendJson(res, 413, ApiError.payloadTooLarge(requestId));
          return true;
        }
        if (body._malformed) {
          this.sendJson(res, 400, ApiError.badRequest(requestId, 'Invalid or malformed request payload'));
          return true;
        }
        const targetZone = body.zoneId || body.zoneName || 'portal-surface';
        const zoneVal = InputValidator.validateEntityId(targetZone, 'zoneId');
        if (!zoneVal.isValid) {
          this.sendJson(res, 400, ApiError.badRequest(requestId, zoneVal.errors.join('; ')));
          return true;
        }
        const cleanZoneId = zoneVal.sanitized!;

        const worker = await this.db.getWorker(cleanWorkerId);

        if (!worker) {
          this.sendJson(res, 404, { error: `Worker ${cleanWorkerId} not found` });
          return true;
        }

        const allHelmets = await this.db.getHelmets();
        const helmet = allHelmets.find((h) => h.worker_id === worker.id);
        const zone = await this.db.getZone(cleanZoneId);

        if (!zone) {
          this.sendJson(res, 400, { error: `Zone ${cleanZoneId} not found` });
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
        const workerVal = InputValidator.validateEntityId(workerId, 'workerId');
        if (!workerVal.isValid) {
          this.sendJson(res, 400, ApiError.badRequest(requestId, workerVal.errors.join('; ')));
          return true;
        }
        const cleanWorkerId = workerVal.sanitized!;

        // Worker can only check out themselves
        if (currentUser.role === 'WORKER' && cleanWorkerId !== currentUser.worker_id) {
          this.sendJson(res, 403, { error: 'Forbidden: Workers cannot check out other workers' });
          return true;
        }

        const worker = await this.db.getWorker(cleanWorkerId);
        if (!worker) {
          this.sendJson(res, 404, { error: `Worker ${cleanWorkerId} not found` });
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
        const workerId = workerZoneMatch[1];
        const workerVal = InputValidator.validateEntityId(workerId, 'workerId');
        if (!workerVal.isValid) {
          this.sendJson(res, 400, ApiError.badRequest(requestId, workerVal.errors.join('; ')));
          return true;
        }
        const cleanWorkerId = workerVal.sanitized!;

        // Workers CANNOT reassign workers
        if (currentUser.role === 'WORKER') {
          this.sendJson(res, 403, { error: 'Forbidden: Workers are not authorized to perform zone reassignment' });
          return true;
        }

        const body = await this.readJsonBody(req, pathname);
        if (body._tooLarge) {
          this.sendJson(res, 413, ApiError.payloadTooLarge(requestId));
          return true;
        }
        if (body._malformed) {
          this.sendJson(res, 400, ApiError.badRequest(requestId, 'Invalid or malformed request payload'));
          return true;
        }
        const targetZone = body.zoneId || body.zoneName;
        const zoneVal = InputValidator.validateEntityId(targetZone, 'zoneId');
        if (!zoneVal.isValid) {
          this.sendJson(res, 400, ApiError.badRequest(requestId, zoneVal.errors.join('; ')));
          return true;
        }
        const cleanZoneId = zoneVal.sanitized!;

        const worker = await this.db.getWorker(cleanWorkerId);

        if (!worker) {
          this.sendJson(res, 404, { error: `Worker ${cleanWorkerId} not found` });
          return true;
        }

        const allHelmets = await this.db.getHelmets();
        const helmet = allHelmets.find((h) => h.worker_id === worker.id);
        const zone = await this.db.getZone(cleanZoneId);

        if (!zone) {
          this.sendJson(res, 400, { error: `Zone ${cleanZoneId} not found` });
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
        const zoneVal = InputValidator.validateEntityId(zoneId, 'zoneId');
        if (!zoneVal.isValid) {
          this.sendJson(res, 400, ApiError.badRequest(requestId, zoneVal.errors.join('; ')));
          return true;
        }
        const cleanZoneId = zoneVal.sanitized!;

        const zone = await this.db.getZone(cleanZoneId);
        if (!zone) {
          this.sendJson(res, 404, { error: `Zone ${cleanZoneId} not found` });
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
        const zoneVal = InputValidator.validateEntityId(zoneId, 'zoneId');
        if (!zoneVal.isValid) {
          this.sendJson(res, 400, ApiError.badRequest(requestId, zoneVal.errors.join('; ')));
          return true;
        }
        const cleanZoneId = zoneVal.sanitized!;

        const zone = await this.db.getZone(cleanZoneId);
        if (!zone) {
          this.sendJson(res, 404, { error: `Zone ${cleanZoneId} not found` });
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
        const statusVal = InputValidator.validateAlertStatus(url.searchParams.get('status'));
        if (!statusVal.isValid) {
          this.sendJson(res, 400, ApiError.badRequest(requestId, statusVal.errors.join('; ')));
          return true;
        }

        const severityVal = InputValidator.validateAlertSeverity(url.searchParams.get('severity'));
        if (!severityVal.isValid) {
          this.sendJson(res, 400, ApiError.badRequest(requestId, severityVal.errors.join('; ')));
          return true;
        }

        const helmetVal = InputValidator.validateOptionalEntityId(url.searchParams.get('helmetId'), 'helmetId');
        if (!helmetVal.isValid) {
          this.sendJson(res, 400, ApiError.badRequest(requestId, helmetVal.errors.join('; ')));
          return true;
        }

        const workerVal = InputValidator.validateOptionalEntityId(url.searchParams.get('workerId'), 'workerId');
        if (!workerVal.isValid) {
          this.sendJson(res, 400, ApiError.badRequest(requestId, workerVal.errors.join('; ')));
          return true;
        }

        const pagination = InputValidator.validatePagination(
          url.searchParams.get('limit'),
          url.searchParams.get('offset'),
          50,
          1000
        );
        if (!pagination.isValid) {
          this.sendJson(res, 400, ApiError.badRequest(requestId, pagination.errors.join('; ')));
          return true;
        }

        const sortVal = InputValidator.validateSort(
          url.searchParams.get('sort'),
          url.searchParams.get('direction'),
          ['created_at', 'triggered_at', 'severity', 'status', 'timestamp'],
          'triggered_at'
        );
        if (!sortVal.isValid) {
          this.sendJson(res, 400, ApiError.badRequest(requestId, sortVal.errors.join('; ')));
          return true;
        }

        const status = statusVal.sanitized;
        const severity = severityVal.sanitized;
        const helmetId = helmetVal.sanitized;
        const workerId = workerVal.sanitized;

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
        const pagination = InputValidator.validatePagination(
          url.searchParams.get('limit'),
          url.searchParams.get('offset'),
          50,
          1000
        );
        if (!pagination.isValid) {
          this.sendJson(res, 400, ApiError.badRequest(requestId, pagination.errors.join('; ')));
          return true;
        }

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
        const alertId = alertAckMatch[1];
        const alertVal = InputValidator.validateEntityId(alertId, 'alertId');
        if (!alertVal.isValid) {
          this.sendJson(res, 400, ApiError.badRequest(requestId, alertVal.errors.join('; ')));
          return true;
        }
        const cleanAlertId = alertVal.sanitized!;

        if (currentUser.role === 'WORKER') {
          this.sendJson(res, 403, { error: 'Forbidden: Workers cannot acknowledge alerts' });
          return true;
        }

        const body = await this.readJsonBody(req, pathname);
        if (body._tooLarge) {
          this.sendJson(res, 413, ApiError.payloadTooLarge(requestId));
          return true;
        }
        if (body._malformed) {
          this.sendJson(res, 400, ApiError.badRequest(requestId, 'Invalid or malformed request payload'));
          return true;
        }
        const supervisorName =
          typeof body.supervisorName === 'string' && body.supervisorName.trim()
            ? InputValidator.sanitizeString(body.supervisorName.trim())
            : currentUser.name || 'Supervisor On-Duty';

        const alert = await this.db.acknowledgeAlert(cleanAlertId, supervisorName);

        if (!alert) {
          this.sendJson(res, 404, ApiError.notFound(requestId, `Alert ${cleanAlertId} not found`));
        } else {
          // Realtime Broadcast
          RealtimePublisher.getInstance().publish('alerts', 'UPDATE', alert);

          await this.db.logAuditAction({
            user_id: currentUser.id,
            user_email: currentUser.email,
            role: currentUser.role,
            action: 'ALERT_ACKNOWLEDGE',
            target_type: 'ALERT',
            target_id: cleanAlertId,
            details: { acknowledged_by: supervisorName },
          });
          this.sendJson(res, 200, alert);
        }
        return true;
      }

      // POST /api/v1/alerts/:id/resolve
      const alertResolveMatch = pathname.match(/^\/api\/v1\/alerts\/([^/]+)\/resolve$/);
      if (alertResolveMatch && method === 'POST') {
        const alertId = alertResolveMatch[1];
        const alertVal = InputValidator.validateEntityId(alertId, 'alertId');
        if (!alertVal.isValid) {
          this.sendJson(res, 400, ApiError.badRequest(requestId, alertVal.errors.join('; ')));
          return true;
        }
        const cleanAlertId = alertVal.sanitized!;

        if (currentUser.role === 'WORKER') {
          this.sendJson(res, 403, ApiError.forbidden(requestId, 'Forbidden: Workers cannot resolve supervisor alerts'));
          return true;
        }

        const body = await this.readJsonBody(req, pathname);
        if (body._tooLarge) {
          this.sendJson(res, 413, ApiError.payloadTooLarge(requestId));
          return true;
        }
        if (body._malformed) {
          this.sendJson(res, 400, ApiError.badRequest(requestId, 'Invalid or malformed request payload'));
          return true;
        }
        const payloadVal = InputValidator.validateAlertResolvePayload(body);
        if (!payloadVal.isValid) {
          this.sendJson(res, 400, ApiError.badRequest(requestId, payloadVal.errors.join('; ')));
          return true;
        }
        const notes =
          payloadVal.sanitized?.notes ||
          (currentUser.name ? `Resolved by ${currentUser.name}` : 'Resolved');

        const alert = await this.db.resolveAlert(cleanAlertId, notes);

        if (!alert) {
          this.sendJson(res, 404, ApiError.notFound(requestId, `Alert ${cleanAlertId} not found`));
        } else {
          // Realtime Broadcast
          RealtimePublisher.getInstance().publish('alerts', 'UPDATE', alert);

          await this.db.logAuditAction({
            user_id: currentUser.id,
            user_email: currentUser.email,
            role: currentUser.role,
            action: 'ALERT_RESOLVE',
            target_type: 'ALERT',
            target_id: cleanAlertId,
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
          this.sendJson(res, 400, ApiError.badRequest(requestId, range.error || 'Invalid time range parameters'));
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
          const helmetVal = InputValidator.validateEntityId(targetHelmetId, 'helmetId');
          if (!helmetVal.isValid) {
            this.sendJson(res, 400, ApiError.badRequest(requestId, helmetVal.errors.join('; ')));
            return true;
          }
          const cleanTargetHelmetId = helmetVal.sanitized!;

          if (currentUser.role === 'WORKER' && userAssignedHelmetId && cleanTargetHelmetId !== userAssignedHelmetId) {
            this.sendJson(res, 403, { error: 'Forbidden: Workers may only inspect their assigned helmet analytics' });
            return true;
          }

          const helmet = await this.db.getHelmetWithDetails(cleanTargetHelmetId);
          if (!helmet) {
            this.sendJson(res, 404, { error: `Helmet ${cleanTargetHelmetId} not found` });
            return true;
          }

          const packets = await this.db.getTelemetryByRange({ from: range.from, to: range.to, helmetId: cleanTargetHelmetId });
          const telemetryAnalytics = AnalyticsEngine.computeTelemetryAnalytics(packets, range.fromMs, range.toMs);
          const alerts = await this.db.getAlertsByRange({ from: range.from, to: range.to, helmetId: cleanTargetHelmetId });
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
          const workerVal = InputValidator.validateEntityId(targetWorkerId, 'workerId');
          if (!workerVal.isValid) {
            this.sendJson(res, 400, ApiError.badRequest(requestId, workerVal.errors.join('; ')));
            return true;
          }
          const cleanTargetWorkerId = workerVal.sanitized!;

          if (currentUser.role === 'WORKER' && cleanTargetWorkerId !== currentUser.worker_id) {
            this.sendJson(res, 403, { error: 'Forbidden: Workers may only inspect their own worker analytics' });
            return true;
          }

          const worker = await this.db.getWorker(cleanTargetWorkerId);
          if (!worker) {
            this.sendJson(res, 404, { error: `Worker ${cleanTargetWorkerId} not found` });
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

        // Validate optional filter parameters for general analytics
        if (helmetIdParam) {
          const hVal = InputValidator.validateEntityId(helmetIdParam, 'helmetId');
          if (!hVal.isValid) {
            this.sendJson(res, 400, ApiError.badRequest(requestId, hVal.errors.join('; ')));
            return true;
          }
        }
        if (workerIdParam) {
          const wVal = InputValidator.validateEntityId(workerIdParam, 'workerId');
          if (!wVal.isValid) {
            this.sendJson(res, 400, ApiError.badRequest(requestId, wVal.errors.join('; ')));
            return true;
          }
        }
        if (zoneIdParam) {
          const zVal = InputValidator.validateEntityId(zoneIdParam, 'zoneId');
          if (!zVal.isValid) {
            this.sendJson(res, 400, ApiError.badRequest(requestId, zVal.errors.join('; ')));
            return true;
          }
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
      this.sendJson(res, 404, ApiError.notFound(requestId, `API endpoint not found: ${method} ${pathname}`));
      return true;
    } catch (err: unknown) {
      const isProduction = getBackendConfig().isProduction;
      StructuredLogger.error({
        requestId: RequestIdManager.resolveRequestId(req, res),
        method,
        route: pathname,
        status: 500,
        message: err instanceof Error ? err.message : String(err),
      });

      this.sendJson(res, 500, ApiError.internal(requestId, err, isProduction));
      return true;
    }
  }

  private sendJson(res: ServerResponse, statusCode: number, data: unknown): void {
    res.statusCode = statusCode;
    res.setHeader('Content-Type', 'application/json');

    const startTime = (res as any)._startTime as number | undefined;
    const method = (res as any)._method as string | undefined;
    const pathname = (res as any)._pathname as string | undefined;
    const durationMs = startTime ? Date.now() - startTime : 0;
    const reqId = (res.getHeader('X-Request-ID') as string) || (res as any)._requestId || 'req-unknown';

    MetricsCollector.getInstance().recordRequest(method || 'GET', pathname || '/', statusCode, durationMs);

    const level = statusCode >= 500 ? 'ERROR' : statusCode >= 400 ? 'WARN' : 'INFO';
    if (level === 'ERROR') {
      StructuredLogger.error({
        requestId: reqId,
        method,
        route: pathname,
        status: statusCode,
        durationMs,
      });
    } else if (level === 'WARN') {
      StructuredLogger.warn({
        requestId: reqId,
        method,
        route: pathname,
        status: statusCode,
        durationMs,
      });
    } else {
      StructuredLogger.info({
        requestId: reqId,
        method,
        route: pathname,
        status: statusCode,
        durationMs,
      });
    }

    // Standardize all error responses (4xx & 5xx) through ApiError envelope
    if (statusCode >= 400 && data && typeof data === 'object') {
      const obj = data as Record<string, unknown>;
      // Already formatted as ApiError envelope
      if (obj.code && obj.error && typeof obj.error === 'object') {
        res.end(JSON.stringify(data));
        return;
      }

      let message = 'An unexpected error occurred';
      if (typeof obj.error === 'string') {
        message = obj.error;
      } else if (typeof obj.message === 'string') {
        message = obj.message;
      }

      let code = 'ERROR';
      if (statusCode === 400) code = 'VALIDATION_ERROR';
      else if (statusCode === 401) code = 'UNAUTHORIZED';
      else if (statusCode === 403) code = 'FORBIDDEN';
      else if (statusCode === 404) code = 'NOT_FOUND';
      else if (statusCode === 405) code = 'METHOD_NOT_ALLOWED';
      else if (statusCode === 409) code = 'CONFLICT';
      else if (statusCode === 413) code = 'PAYLOAD_TOO_LARGE';
      else if (statusCode === 414) code = 'URI_TOO_LONG';
      else if (statusCode === 415) code = 'UNSUPPORTED_MEDIA_TYPE';
      else if (statusCode === 422) code = 'UNPROCESSABLE_ENTITY';
      else if (statusCode === 429) code = 'RATE_LIMITED';
      else if (statusCode === 500) code = 'INTERNAL_SERVER_ERROR';
      else if (statusCode === 503) code = 'SERVICE_UNAVAILABLE';

      const normalized = ApiError.create(code, message, reqId, obj.details);
      res.end(JSON.stringify(normalized));
      return;
    }

    res.end(JSON.stringify(data));
  }

  private resolveClientAddress(req: IncomingMessage): string {
    const rawIp = req.socket?.remoteAddress || '127.0.0.1';
    let resolved = rawIp;

    const xff = req.headers['x-forwarded-for'];
    if (xff) {
      const first = (Array.isArray(xff) ? xff[0] : String(xff)).split(',')[0].trim();
      if (/^[0-9a-fA-F:.]+$/.test(first) && first.length <= 45) {
        resolved = first;
      }
    } else {
      const realIp = req.headers['x-real-ip'];
      if (realIp && typeof realIp === 'string') {
        const candidate = realIp.trim();
        if (/^[0-9a-fA-F:.]+$/.test(candidate) && candidate.length <= 45) {
          resolved = candidate;
        }
      }
    }

    if (resolved.startsWith('::ffff:')) {
      resolved = resolved.substring(7);
    }
    if (resolved === '::1') {
      resolved = '127.0.0.1';
    }

    return resolved;
  }

  private async readJsonBody(
    req: IncomingMessage,
    pathname: string = ''
  ): Promise<Record<string, unknown> & { _malformed?: boolean; _tooLarge?: boolean; _unsupportedMediaType?: boolean }> {
    const contentType = req.headers['content-type'];
    if (contentType && typeof contentType === 'string') {
      const lower = contentType.toLowerCase().trim();
      if (
        !lower.includes('application/json') &&
        !lower.includes('*/*') &&
        !lower.includes('+json') &&
        !lower.includes('text/json')
      ) {
        return { _unsupportedMediaType: true };
      }
    }
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
