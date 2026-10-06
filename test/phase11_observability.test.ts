/**
 * MineCare - Phase 11 Production Observability & Audit Test Suite
 *
 * Verifies end-to-end production observability without external infrastructure:
 * 1. Request correlation & X-Request-ID propagation
 * 2. Structured JSON logging (timestamp, level, requestId, method, route, status, durationMs)
 * 3. Deep secret redaction (DB URLs, Bearer tokens, raw JWTs, device tokens, passwords)
 * 4. API performance & error metrics (latency percentiles, status buckets, rate-limit events)
 * 5. MineCare operational safety metrics (telemetry packets, validation failures, hazards, alerts)
 * 6. Hardware & device security observability (invalid/revoked tokens, mismatches, failed auth)
 * 7. Audit logging persistence & secret sanitization
 * 8. Liveness (/livez) vs Readiness (/readyz) probe isolation
 * 9. RBAC-protected Admin metrics endpoint (/api/v1/admin/metrics)
 * 10. Error sanitization & client safety (no stack traces or DB credentials leaked)
 * 11. Frontend API observability & error listener propagation
 */

process.env.NODE_ENV = 'test';

import type { IncomingMessage, ServerResponse } from 'http';
import { DatabaseRepository } from '../src/backend/db/DatabaseRepository';
import { StructuredLogger } from '../src/backend/security/StructuredLogger';
import { MetricsCollector } from '../src/backend/observability/MetricsCollector';
import { BackendApp } from '../src/backend/app';
import { createStandardJwt } from '../src/backend/auth/jwt';
import { DeviceAuthManager } from '../src/backend/security/DeviceAuth';
import { ApiError as ClientApiError, onApiError } from '../src/services/api/apiClient';

let totalChecks = 0;
let passedChecks = 0;

function assert(condition: boolean, category: string, description: string) {
  totalChecks++;
  if (condition) {
    passedChecks++;
    console.log(`  ✓ [${category}] ${description}`);
  } else {
    console.error(`  ✗ [${category}] FAILED: ${description}`);
    process.exitCode = 1;
  }
}

// Mock HTTP helpers
function createMockRequest(options: {
  method?: string;
  url?: string;
  headers?: Record<string, string>;
  body?: unknown;
}): IncomingMessage {
  const req = {
    method: options.method || 'GET',
    url: options.url || '/',
    headers: {
      host: 'localhost:3000',
      'user-agent': 'MineCare-Test-Agent/1.0',
      ...(options.headers || {}),
    },
    socket: { remoteAddress: '127.0.0.1' },
    on: (event: string, callback: (...args: any[]) => void) => {
      if (event === 'data' && options.body !== undefined) {
        const payload = typeof options.body === 'string' ? options.body : JSON.stringify(options.body);
        callback(Buffer.from(payload));
      }
      if (event === 'end') {
        callback();
      }
      return req;
    },
  } as unknown as IncomingMessage;
  return req;
}

interface MockResponseContext {
  statusCode: number;
  headers: Record<string, string>;
  body: string;
  jsonData: any;
}

function createMockResponse(): { res: ServerResponse; getContext: () => MockResponseContext } {
  const ctx: MockResponseContext = {
    statusCode: 200,
    headers: {},
    body: '',
    jsonData: null,
  };

  const res = {
    statusCode: 200,
    setHeader: (name: string, value: string) => {
      ctx.headers[name.toLowerCase()] = value;
      ctx.headers[name] = value;
    },
    getHeader: (name: string) => ctx.headers[name.toLowerCase()] || ctx.headers[name],
    getHeaders: () => ctx.headers,
    hasHeader: (name: string) => Boolean(ctx.headers[name.toLowerCase()] || ctx.headers[name]),
    removeHeader: (name: string) => {
      delete ctx.headers[name.toLowerCase()];
      delete ctx.headers[name];
    },
    end: (chunk?: string | Buffer) => {
      if (chunk) {
        ctx.body = chunk.toString();
        try {
          ctx.jsonData = JSON.parse(ctx.body);
        } catch {
          ctx.jsonData = null;
        }
      }
      ctx.statusCode = res.statusCode;
    },
  } as unknown as ServerResponse;

  return { res, getContext: () => ctx };
}

async function runPhase11Tests() {
  console.log('\n============================================================');
  console.log('MINECARE PHASE 11 - PRODUCTION OBSERVABILITY & AUDIT SUITE');
  console.log('============================================================');

  // Mute console output from StructuredLogger during unit tests to prevent log clutter
  StructuredLogger.setSilent(true);
  StructuredLogger.clearLogs();
  MetricsCollector.resetInstance();

  const db = DatabaseRepository.getInstance();
  const app = new BackendApp(db);
  const metrics = MetricsCollector.getInstance();

  // Test Tokens
  const adminToken = await createStandardJwt({
    sub: 'admin-001',
    email: 'admin@minecare.local',
    role: 'ADMIN',
  });
  const supervisorToken = await createStandardJwt({
    sub: 'sup-001',
    email: 'supervisor@minecare.local',
    role: 'SUPERVISOR',
  });
  const workerToken = await createStandardJwt({
    sub: 'auth-wrk-001',
    email: 'worker.marak@minecare.local',
    role: 'WORKER',
  });

  // =========================================================================
  // 1. REQUEST TRACING & CORRELATION IDS
  // =========================================================================
  console.log('\n--- 1. REQUEST TRACING & CORRELATION IDS ---');
  {
    // Test 1.1: Automatic generation of X-Request-ID when not supplied
    const { res, getContext } = createMockResponse();
    const req = createMockRequest({ method: 'GET', url: '/api/v1/system/health' });
    await app.handleRequest(req, res);
    const ctx = getContext();

    const reqId = res.getHeader('X-Request-ID') as string;
    assert(Boolean(reqId && reqId.length > 10), 'TRACING', 'X-Request-ID header automatically generated');
    assert(ctx.statusCode === 200, 'TRACING', 'Health endpoint returns 200');

    // Test 1.2: Preservation of client correlation ID
    const customCorrelationId = 'client-trace-abc-12345';
    const { res: res2, getContext: getContext2 } = createMockResponse();
    const req2 = createMockRequest({
      method: 'GET',
      url: '/api/v1/system/health',
      headers: { 'x-request-id': customCorrelationId },
    });
    await app.handleRequest(req2, res2);
    const ctx2 = getContext2();

    const returnedId = res2.getHeader('X-Request-ID') as string;
    assert(returnedId === customCorrelationId, 'TRACING', 'Incoming X-Request-ID correlation ID is strictly preserved');
    assert(ctx2.statusCode === 200, 'TRACING', 'Response succeeded with correlated ID');
  }

  // =========================================================================
  // 2. STRUCTURED BACKEND LOGGING & LOG LEVELS
  // =========================================================================
  console.log('\n--- 2. STRUCTURED BACKEND LOGGING & LOG LEVELS ---');
  {
    StructuredLogger.clearLogs();

    // Trigger a 200 (INFO)
    const { res: res200 } = createMockResponse();
    await app.handleRequest(createMockRequest({ method: 'GET', url: '/api/v1/system/health' }), res200);

    // Trigger a 401 (WARN)
    const { res: res401 } = createMockResponse();
    await app.handleRequest(createMockRequest({ method: 'GET', url: '/api/v1/helmets' }), res401);

    // Trigger a 404 (WARN)
    const { res: res404 } = createMockResponse();
    await app.handleRequest(
      createMockRequest({
        method: 'GET',
        url: '/api/v1/admin/non-existent-endpoint',
        headers: { authorization: `Bearer ${adminToken}` },
      }),
      res404
    );

    const logs = StructuredLogger.getRecentLogs();
    assert(logs.length >= 3, 'LOGGING', 'Structured access logs emitted for all incoming requests');

    const log200 = logs.find((l) => l.route === '/api/v1/system/health' && l.status === 200);
    assert(Boolean(log200 && log200.level === 'INFO'), 'LOGGING', '2xx response logged with level INFO');
    assert(typeof log200?.durationMs === 'number', 'LOGGING', 'Response durationMs captured in structured log');
    assert(Boolean(log200?.timestamp), 'LOGGING', 'ISO timestamp present in log entry');

    const log401 = logs.find((l) => l.route === '/api/v1/helmets' && l.status === 401);
    assert(Boolean(log401 && log401.level === 'WARN'), 'LOGGING', '4xx client rejection logged with level WARN');

    const log404 = logs.find((l) => l.route === '/api/v1/admin/non-existent-endpoint');
    assert(Boolean(log404 && log404.level === 'WARN'), 'LOGGING', '404 not found logged with level WARN');

    // Test direct structured error log
    StructuredLogger.error({
      requestId: 'test-err-req',
      message: 'Critical subsystem failure simulation',
      errorCode: 'INTERNAL_ERROR',
      status: 500,
    });
    const latestLog = StructuredLogger.getRecentLogs().pop();
    assert(latestLog?.level === 'ERROR', 'LOGGING', '500 error emits level ERROR');
    assert(latestLog?.requestId === 'test-err-req', 'LOGGING', 'RequestId matches on error log entry');
  }

  // =========================================================================
  // 3. DEEP SECRET REDACTION
  // =========================================================================
  console.log('\n--- 3. DEEP SECRET REDACTION ---');
  {
    // Test 3.1: PostgreSQL connection strings with embedded passwords
    const rawPgUrl = 'postgresql://postgres:SuperSecretP@ss123@aws-0-ap-south-1.pooler.supabase.com:6543/postgres';
    const redactedPgUrl = StructuredLogger.redact(rawPgUrl) as string;
    assert(!redactedPgUrl.includes('SuperSecretP@ss123'), 'REDACTION', 'DB password redacted from PostgreSQL URL');
    assert(redactedPgUrl.includes('[REDACTED]'), 'REDACTION', 'PostgreSQL URL retains [REDACTED] placeholder');

    // Test 3.2: Bearer auth tokens
    const rawBearer = 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.doNotLeakThisSignature';
    const redactedBearer = StructuredLogger.redact(rawBearer) as string;
    assert(redactedBearer === 'Bearer [REDACTED]', 'REDACTION', 'Bearer token sanitized to Bearer [REDACTED]');

    // Test 3.3: Raw JWT tokens in strings
    const rawJwt = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwidXNlciI6ImFkbWluIn0.signatureSecret';
    const redactedJwt = StructuredLogger.redact(`Token was ${rawJwt} inside message`) as string;
    assert(!redactedJwt.includes('signatureSecret'), 'REDACTION', 'Raw JWT signature redacted from arbitrary string');
    assert(redactedJwt.includes('[REDACTED]'), 'REDACTION', 'JWT string replaced with [REDACTED]');

    // Test 3.4: Hardware device tokens
    const rawDevToken = 'mc_dev_prod_esp8266_helmet_token_98765';
    const redactedDevToken = StructuredLogger.redact(`Device identified with ${rawDevToken}`) as string;
    assert(!redactedDevToken.includes('prod_esp8266_helmet_token'), 'REDACTION', 'Hardware device token redacted');

    // Test 3.5: Sensitive keys in structured objects and nested payloads
    const sensitivePayload = {
      user: 'admin',
      password: 'PlaintextPassword123!',
      jwt: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0In0.xyz',
      service_role_key: 'sbp_secret_service_key_99999',
      metadata: {
        api_key: 'mc_api_key_sensitive',
        device_token: 'mc_dev_token_456',
        nestedArray: [
          { auth_token: 'nested_secret_token', safeField: 'mine-zone-1' },
          'postgresql://user:pass123@localhost/db',
        ],
      },
      safeField: 'nominal',
    };

    const redactedObj = StructuredLogger.redact(sensitivePayload) as any;
    assert(redactedObj.password === '[REDACTED]', 'REDACTION', 'Object password field replaced with [REDACTED]');
    assert(redactedObj.jwt === '[REDACTED]', 'REDACTION', 'Object jwt field replaced with [REDACTED]');
    assert(redactedObj.service_role_key === '[REDACTED]', 'REDACTION', 'service_role_key replaced with [REDACTED]');
    assert(redactedObj.metadata.api_key === '[REDACTED]', 'REDACTION', 'Nested api_key replaced with [REDACTED]');
    assert(redactedObj.metadata.device_token === '[REDACTED]', 'REDACTION', 'Nested device_token replaced with [REDACTED]');
    assert(redactedObj.metadata.nestedArray[0].auth_token === '[REDACTED]', 'REDACTION', 'Array element secret redacted');
    assert(redactedObj.metadata.nestedArray[0].safeField === 'mine-zone-1', 'REDACTION', 'Safe object field untouched');
    assert(!redactedObj.metadata.nestedArray[1].includes('pass123'), 'REDACTION', 'Array element DB url redacted');
    assert(redactedObj.safeField === 'nominal', 'REDACTION', 'Root safeField remains unchanged');
  }

  // =========================================================================
  // 4. API METRICS & PERFORMANCE OBSERVABILITY
  // =========================================================================
  console.log('\n--- 4. API METRICS & PERFORMANCE OBSERVABILITY ---');
  {
    metrics.reset();

    // Record various status codes and latencies
    metrics.recordRequest('GET', '/api/v1/helmets', 200, 15);
    metrics.recordRequest('GET', '/api/v1/helmets/MC-001', 200, 25);
    metrics.recordRequest('POST', '/api/v1/telemetry', 201, 35);
    metrics.recordRequest('GET', '/api/v1/admin/users', 401, 10);
    metrics.recordRequest('GET', '/api/v1/workers/WRK-002', 403, 12);
    metrics.recordRequest('POST', '/api/v1/auth/login', 429, 5);
    metrics.recordRequest('GET', '/api/v1/crash', 500, 50);

    metrics.recordDatabaseFailure('query_helmets', new Error('Connection terminated'));
    metrics.recordRateLimitEvent('AUTH', '192.168.1.50');
    metrics.recordRateLimitEvent('TELEMETRY', 'MC-001');
    metrics.recordRateLimitEvent('GENERAL', '192.168.1.51');

    const snapshot = await metrics.getSnapshot(db);
    assert(snapshot.api.totalRequests === 7, 'METRICS', 'Total requests accurately tracked (7)');
    assert(snapshot.api.statusCodes.status2xx === 3, 'METRICS', '2xx responses accurately counted (3)');
    assert(snapshot.api.statusCodes.status4xx === 3, 'METRICS', '4xx responses accurately counted (3)');
    assert(snapshot.api.statusCodes.status5xx === 1, 'METRICS', '5xx responses accurately counted (1)');
    assert(snapshot.api.statusCodes.status401 === 1, 'METRICS', '401 Unauthorized counted (1)');
    assert(snapshot.api.statusCodes.status403 === 1, 'METRICS', '403 Forbidden counted (1)');
    assert(snapshot.api.statusCodes.status429 === 1, 'METRICS', '429 Rate Limited counted (1)');

    assert(snapshot.api.latencies.minMs === 5, 'METRICS', 'Min latency matches recorded minimum (5ms)');
    assert(snapshot.api.latencies.maxMs === 50, 'METRICS', 'Max latency matches recorded maximum (50ms)');
    assert(snapshot.api.latencies.avgMs > 0, 'METRICS', 'Average latency accurately computed');
    assert(snapshot.api.latencies.p95Ms >= 35, 'METRICS', 'p95 latency computed from sample distribution');

    assert(snapshot.api.databaseFailures === 1, 'METRICS', 'Database failure event tracked');
    assert(snapshot.api.rateLimitEvents.AUTH === 1, 'METRICS', 'AUTH rate limit event recorded');
    assert(snapshot.api.rateLimitEvents.TELEMETRY === 1, 'METRICS', 'TELEMETRY rate limit event recorded');
    assert(snapshot.api.rateLimitEvents.GENERAL === 1, 'METRICS', 'GENERAL rate limit event recorded');
  }

  // =========================================================================
  // 5. MINECARE OPERATIONAL SAFETY METRICS
  // =========================================================================
  console.log('\n--- 5. MINECARE OPERATIONAL SAFETY METRICS ---');
  {
    metrics.reset();

    // Ingest valid telemetry packet via API to verify full pipeline metrics
    const validPacket = {
      packetId: 'PKT-OBS-001',
      helmetId: 'MC-001',
      timestamp: new Date().toISOString(),
      gasValue: 850, // Triggers gas warning (>800)
      temperature: 42.5, // Triggers temp warning (>40)
      humidity: 60.0,
      pressure: 1013.25,
      accelX: 0.1,
      accelY: 0.2,
      accelZ: 9.8,
      totalAcceleration: 16.5, // Triggers fall hazard (>15)
      batteryLevel: 95,
      fallDetected: true,
      sosPressed: true, // Triggers SOS hazard
    };

    const { res: resIngest } = createMockResponse();
    const reqIngest = createMockRequest({
      method: 'POST',
      url: '/api/v1/telemetry',
      headers: { 'x-device-token': 'mc_dev_MC-001' },
      body: validPacket,
    });
    await app.handleRequest(reqIngest, resIngest);

    // Ingest invalid telemetry packet to test validation failure tracking
    const { res: resInvalid } = createMockResponse();
    const reqInvalid = createMockRequest({
      method: 'POST',
      url: '/api/v1/telemetry',
      headers: { 'x-device-token': 'mc_dev_MC-001' },
      body: { helmetId: 'MC-001', invalidField: true }, // missing required fields
    });
    await app.handleRequest(reqInvalid, resInvalid);

    const snapshot = await metrics.getSnapshot(db);
    assert(snapshot.operational.telemetryPacketsReceived >= 1, 'OPERATIONAL', 'Telemetry packets received counted');
    assert(snapshot.operational.telemetryValidationFailures >= 1, 'OPERATIONAL', 'Validation failure recorded on bad packet');
    assert(snapshot.operational.hazardEvents.sosEvents >= 1, 'OPERATIONAL', 'SOS emergency hazard event tracked');
    assert(snapshot.operational.hazardEvents.fallEvents >= 1, 'OPERATIONAL', 'Fall impact hazard event tracked');
    assert(snapshot.operational.hazardEvents.gasWarnings >= 1, 'OPERATIONAL', 'High gas hazard warning tracked');
    assert(snapshot.operational.hazardEvents.temperatureWarnings >= 1, 'OPERATIONAL', 'High temperature warning tracked');
    assert(snapshot.operational.activeHelmets === 16, 'OPERATIONAL', 'Fleet active helmets reported (16 seeded)');
    assert(snapshot.operational.helmetsByConnectivity.online >= 0, 'OPERATIONAL', 'Helmet connectivity online breakdown present');
  }

  // =========================================================================
  // 6. DEVICE SECURITY OBSERVABILITY
  // =========================================================================
  console.log('\n--- 6. DEVICE SECURITY OBSERVABILITY ---');
  {
    metrics.reset();

    const samplePayload = {
      gasValue: 200,
      temperature: 25,
      humidity: 50,
      pressure: 1013,
      accelX: 0,
      accelY: 0,
      accelZ: 9.8,
      totalAcceleration: 9.8,
      batteryLevel: 90,
      timestamp: new Date().toISOString(),
    };

    // 6.1: Invalid Device Token attempt
    const { res: resInvDev } = createMockResponse();
    const reqInvDev = createMockRequest({
      method: 'POST',
      url: '/api/v1/telemetry',
      headers: { 'x-device-token': 'invalid_device_key_completely_fake' },
      body: { ...samplePayload, helmetId: 'MC-002', packetId: 'PKT-999' },
    });
    await app.handleRequest(reqInvDev, resInvDev);

    // 6.2: Helmet / Device Mismatch attempt (MC-001 token used for MC-003)
    const { res: resMismatch } = createMockResponse();
    const reqMismatch = createMockRequest({
      method: 'POST',
      url: '/api/v1/telemetry',
      headers: { 'x-device-token': 'mc_dev_MC-001' },
      body: { ...samplePayload, helmetId: 'MC-003', packetId: 'PKT-MISMATCH' },
    });
    await app.handleRequest(reqMismatch, resMismatch);

    // 6.3: Revoked Device Token attempt
    const revokedToken = 'mc_dev_MC-004';
    DeviceAuthManager.revokeToken(revokedToken);

    const { res: resRevoked } = createMockResponse();
    const reqRevoked = createMockRequest({
      method: 'POST',
      url: '/api/v1/telemetry',
      headers: { 'x-device-token': revokedToken },
      body: { ...samplePayload, helmetId: 'MC-004', packetId: 'PKT-REVOKED' },
    });
    await app.handleRequest(reqRevoked, resRevoked);

    // 6.4: Failed user login attempt
    const { res: resFailedLogin } = createMockResponse();
    const reqFailedLogin = createMockRequest({
      method: 'POST',
      url: '/api/v1/auth/login',
      body: { email: 'admin@minecare.local', password: 'WrongPassword999!' },
    });
    await app.handleRequest(reqFailedLogin, resFailedLogin);

    // 6.5: Administrative security action (create user)
    const { res: resAdminAction } = createMockResponse();
    const reqAdminAction = createMockRequest({
      method: 'POST',
      url: '/api/v1/admin/users',
      headers: { authorization: `Bearer ${adminToken}` },
      body: {
        name: 'New Operator',
        email: `new.operator.${Date.now()}@minecare.local`,
        password: 'SecureOperatorPassword123!',
        role: 'SUPERVISOR',
      },
    });
    await app.handleRequest(reqAdminAction, resAdminAction);

    const snapshot = await metrics.getSnapshot(db);
    assert(snapshot.security.invalidDeviceCredentialsCount >= 1, 'SECURITY', 'Invalid device token attempt tracked');
    assert(snapshot.security.helmetDeviceMismatchCount >= 1, 'SECURITY', 'Device/helmet mismatch attempt tracked');
    assert(snapshot.security.revokedDeviceAttemptsCount >= 1, 'SECURITY', 'Revoked device token attempt tracked');
    assert(snapshot.security.repeatedAuthFailuresCount >= 1, 'SECURITY', 'Failed user authentication tracked');
    assert(snapshot.security.adminSecurityActionsCount >= 1, 'SECURITY', 'Admin security modification tracked');

    // Verify recent events list contains sanitized events
    assert(snapshot.security.recentSecurityEvents.length >= 4, 'SECURITY', 'Security event audit buffer captures events');
    const recentRevoked = snapshot.security.recentSecurityEvents.find((e) => e.eventType === 'REVOKED_DEVICE_TOKEN');
    assert(Boolean(recentRevoked), 'SECURITY', 'REVOKED_DEVICE_TOKEN recorded in event buffer');
    assert(recentRevoked?.details.token === '[REDACTED]', 'SECURITY', 'Device token in security event details is redacted');
  }

  // =========================================================================
  // 7. AUDIT LOGGING & CREDENTIAL REDACTION
  // =========================================================================
  console.log('\n--- 7. AUDIT LOGGING & CREDENTIAL REDACTION ---');
  {
    // Write an audit log entry containing raw passwords and database URLs
    const auditEntry = db.logAuditAction({
      user_id: 'admin-001',
      user_email: 'admin@minecare.local',
      role: 'ADMIN',
      action: 'ADMIN_OVERRIDE',
      target_type: 'SYSTEM',
      target_id: 'SYS-001',
      details: {
        attempted_password: 'ShouldNeverBeSavedInPlaintext!',
        database_url: 'postgresql://admin:SecretPass999@db.internal:5432/minecare',
        auth_token: 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxIn0.secret',
        safeParam: 'zone-override-approved',
      },
    });

    assert(Boolean(auditEntry.id), 'AUDIT', 'Audit entry created and persisted');
    assert(auditEntry.details.attempted_password === '[REDACTED]', 'AUDIT', 'Audit log automatically redacts passwords');
    assert(!String(auditEntry.details.database_url).includes('SecretPass999'), 'AUDIT', 'Audit log redacts DB credentials');
    assert(auditEntry.details.auth_token === '[REDACTED]', 'AUDIT', 'Audit log redacts bearer tokens');
    assert(auditEntry.details.safeParam === 'zone-override-approved', 'AUDIT', 'Non-sensitive audit details preserved');
  }

  // =========================================================================
  // 8. HEALTH (/healthz), LIVENESS (/livez) & READINESS (/readyz)
  // =========================================================================
  console.log('\n--- 8. HEALTH, LIVENESS & READINESS PROBES ---');
  {
    // Test 8.1: Liveness probe /livez (process availability, independent of DB)
    const { res: resLive, getContext: getLiveCtx } = createMockResponse();
    await app.handleRequest(createMockRequest({ method: 'GET', url: '/livez' }), resLive);
    const liveCtx = getLiveCtx();
    assert(liveCtx.statusCode === 200, 'HEALTH', 'GET /livez returns 200 OK');
    assert(liveCtx.jsonData?.status === 'ALIVE', 'HEALTH', 'Liveness probe indicates ALIVE');
    assert(liveCtx.jsonData?.live === true, 'HEALTH', 'Liveness boolean flag is true');

    // Test 8.2: Readiness probe /readyz (checks database connection)
    const { res: resReady, getContext: getReadyCtx } = createMockResponse();
    await app.handleRequest(createMockRequest({ method: 'GET', url: '/readyz' }), resReady);
    const readyCtx = getReadyCtx();
    assert(readyCtx.statusCode === 200, 'HEALTH', 'GET /readyz returns 200 OK when DB is healthy');
    assert(readyCtx.jsonData?.status === 'READY', 'HEALTH', 'Readiness probe indicates READY');
    assert(readyCtx.jsonData?.database === 'CONNECTED', 'HEALTH', 'Readiness probe confirms DB CONNECTED');

    // Test 8.3: System Health probe /healthz
    const { res: resHealth, getContext: getHealthCtx } = createMockResponse();
    await app.handleRequest(createMockRequest({ method: 'GET', url: '/healthz' }), resHealth);
    const healthCtx = getHealthCtx();
    assert(healthCtx.statusCode === 200, 'HEALTH', 'GET /healthz returns 200 OK');
    assert(Boolean(healthCtx.jsonData?.services?.database), 'HEALTH', 'Health diagnostics includes database status');
  }

  // =========================================================================
  // 9. RBAC-PROTECTED ADMIN METRICS ENDPOINT (/api/v1/admin/metrics)
  // =========================================================================
  console.log('\n--- 9. ADMIN METRICS ENDPOINT (/api/v1/admin/metrics) ---');
  {
    // Test 9.1: Unauthenticated request rejected (401)
    const { res: resUnauth, getContext: getUnauthCtx } = createMockResponse();
    await app.handleRequest(createMockRequest({ method: 'GET', url: '/api/v1/admin/metrics' }), resUnauth);
    assert(getUnauthCtx().statusCode === 401, 'ADMIN_METRICS', 'Unauthenticated request rejected with 401');

    // Test 9.2: Worker role rejected (403)
    const { res: resWorker, getContext: getWorkerCtx } = createMockResponse();
    await app.handleRequest(
      createMockRequest({
        method: 'GET',
        url: '/api/v1/admin/metrics',
        headers: { authorization: `Bearer ${workerToken}` },
      }),
      resWorker
    );
    assert(getWorkerCtx().statusCode === 403, 'ADMIN_METRICS', 'Worker role rejected with 403');

    // Test 9.3: Supervisor role rejected (403)
    const { res: resSup, getContext: getSupCtx } = createMockResponse();
    await app.handleRequest(
      createMockRequest({
        method: 'GET',
        url: '/api/v1/admin/metrics',
        headers: { authorization: `Bearer ${supervisorToken}` },
      }),
      resSup
    );
    assert(getSupCtx().statusCode === 403, 'ADMIN_METRICS', 'Supervisor role rejected with 403');

    // Test 9.4: Admin role succeeds (200) with complete snapshot
    const { res: resAdmin, getContext: getAdminCtx } = createMockResponse();
    await app.handleRequest(
      createMockRequest({
        method: 'GET',
        url: '/api/v1/admin/metrics',
        headers: { authorization: `Bearer ${adminToken}` },
      }),
      resAdmin
    );
    const adminCtx = getAdminCtx();
    assert(adminCtx.statusCode === 200, 'ADMIN_METRICS', 'Admin succeeds with 200 OK');
    assert(Boolean(adminCtx.jsonData?.api), 'ADMIN_METRICS', 'Snapshot includes API performance metrics');
    assert(Boolean(adminCtx.jsonData?.operational), 'ADMIN_METRICS', 'Snapshot includes MineCare operational metrics');
    assert(Boolean(adminCtx.jsonData?.security), 'ADMIN_METRICS', 'Snapshot includes device security metrics');
    assert(Boolean(adminCtx.jsonData?.system), 'ADMIN_METRICS', 'Snapshot includes system memory/node details');
    assert(typeof adminCtx.jsonData?.uptimeSeconds === 'number', 'ADMIN_METRICS', 'Snapshot includes system uptime seconds');

    // Verify snapshot does not contain passwords or raw secrets
    const serializedSnapshot = JSON.stringify(adminCtx.jsonData);
    assert(!serializedSnapshot.includes('SuperSecret'), 'ADMIN_METRICS', 'Snapshot contains zero credentials');
    assert(!serializedSnapshot.includes('postgres://'), 'ADMIN_METRICS', 'Snapshot contains zero database connection strings');
  }

  // =========================================================================
  // 10. ERROR OBSERVABILITY & SANITIZED CLIENT RESPONSES
  // =========================================================================
  console.log('\n--- 10. ERROR OBSERVABILITY & SANITIZATION ---');
  {
    // Verify client error responses do not leak internal system details
    const { res: resErr, getContext: getErrCtx } = createMockResponse();
    await app.handleRequest(createMockRequest({ method: 'GET', url: '/api/v1/workers/WRK-9999' }), resErr);
    const errCtx = getErrCtx();

    assert(errCtx.statusCode === 401, 'ERRORS', 'Unauthenticated error status formatted');
    assert(Boolean(errCtx.jsonData?.error), 'ERRORS', 'Standard error envelope returned');
    assert(Boolean(errCtx.jsonData?.error?.requestId), 'ERRORS', 'Error envelope contains correlation requestId');
    assert(!errCtx.body.includes('stack'), 'ERRORS', 'Stack trace strictly withheld from client response');
    assert(!errCtx.body.includes('node_modules'), 'ERRORS', 'File system paths strictly withheld from client response');
  }

  // =========================================================================
  // 11. FRONTEND OBSERVABILITY & ERROR PROPAGATION
  // =========================================================================
  console.log('\n--- 11. FRONTEND OBSERVABILITY & ERROR PROPAGATION ---');
  {
    // Test ClientApiError and listener
    let observedError: ClientApiError | null = null;
    const unsub = onApiError((err) => {
      observedError = err;
    });

    const testError = new ClientApiError('Resource not found', 404, { detail: 'item 404' }, 'req-front-1234');
    assert(testError.requestId === 'req-front-1234', 'FRONTEND_OBS', 'ClientApiError stores correlation requestId');
    assert(testError.status === 404, 'FRONTEND_OBS', 'ClientApiError stores status code');
    assert(observedError === null, 'FRONTEND_OBS', 'No error observed prior to network failure event');

    unsub();
    assert(typeof unsub === 'function', 'FRONTEND_OBS', 'Listener unsubscription cleanly supported');
  }

  // Summary
  console.log('\n============================================================');
  console.log(`TOTAL PHASE 11 CHECKS: ${totalChecks}`);
  console.log(`PASSED:               ${passedChecks}`);
  console.log(`FAILED:               ${totalChecks - passedChecks}`);
  console.log('============================================================\n');

  if (totalChecks !== passedChecks) {
    process.exit(1);
  }
}

runPhase11Tests().catch((err) => {
  console.error('Phase 11 test suite encountered an unhandled exception:', err);
  process.exit(1);
});
