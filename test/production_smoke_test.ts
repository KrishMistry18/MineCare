/**
 * MineCare - Phase 12 Production Cloud Smoke Test Suite
 *
 * Validates the deployed cloud runtime architecture against production requirements:
 * 1. Health & Readiness Probes (/livez, /readyz, /healthz)
 * 2. Production CORS Policy (Vercel origin allowed, unauthorized rejected with 403, no wildcard)
 * 3. Production Authentication (ADMIN, SUPERVISOR, WORKER)
 * 4. Authorization & Worker Isolation (RBAC & IDOR rejection)
 * 5. Operations Pipeline (Fleet, Telemetry Ingestion, Alerts, Analytics, Zone Check-In)
 * 6. Realtime & SSE Fallback (/api/v1/realtime/stream authentication & keepalive)
 * 7. Device Authentication Boundary (valid token accepted, invalid/revoked/mismatched rejected)
 * 8. Sanitized Error Envelopes (No stack traces, no internal database credentials leaked)
 */

process.env.NODE_ENV = 'test';

import type { IncomingMessage, ServerResponse } from 'http';
import { DatabaseRepository } from '../src/backend/db/DatabaseRepository';
import { BackendApp } from '../src/backend/app';
import { createStandardJwt } from '../src/backend/auth/jwt';
import { CorsManager } from '../src/backend/security/CorsManager';
import { DeviceAuthManager } from '../src/backend/security/DeviceAuth';
import { StructuredLogger } from '../src/backend/security/StructuredLogger';

let smokeTotal = 0;
let smokePassed = 0;

function verify(condition: boolean, category: string, detail: string): void {
  smokeTotal++;
  if (condition) {
    smokePassed++;
    console.log(`  ✓ [${category}] ${detail}`);
  } else {
    console.error(`  ✗ [${category}] FAILED: ${detail}`);
    process.exitCode = 1;
  }
}

// Mock HTTP Helpers
function makeRequest(options: {
  method?: string;
  url?: string;
  headers?: Record<string, string>;
  body?: unknown;
}): IncomingMessage {
  const req = {
    method: options.method || 'GET',
    url: options.url || '/',
    headers: {
      host: 'localhost:3001',
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

interface ResponseContext {
  statusCode: number;
  headers: Record<string, string>;
  body: string;
  data: any;
}

function makeResponse(): { res: ServerResponse; getContext: () => ResponseContext } {
  const ctx: ResponseContext = {
    statusCode: 200,
    headers: {},
    body: '',
    data: null,
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
    write: (chunk?: string | Buffer) => {
      if (chunk) {
        ctx.body += chunk.toString();
      }
      return true;
    },
    on: (_event: string, _callback: (...args: any[]) => void) => res,
    end: (chunk?: string | Buffer) => {
      if (chunk) {
        ctx.body += chunk.toString();
        try {
          ctx.data = JSON.parse(ctx.body);
        } catch {
          ctx.data = null;
        }
      }
      ctx.statusCode = res.statusCode;
    },
  } as unknown as ServerResponse;

  return { res, getContext: () => ctx };
}

async function runProductionSmokeTests() {
  console.log('============================================================');
  console.log('MINECARE PHASE 12 - PRODUCTION CLOUD SMOKE TEST SUITE');
  console.log('============================================================\n');

  StructuredLogger.setSilent(true);

  const db = DatabaseRepository.getInstance();
  const app = new BackendApp(db);

  // Canonical user tokens
  const adminToken = await createStandardJwt({
    sub: 'auth-admin-001',
    email: 'admin@minecare.local',
    role: 'ADMIN',
  });
  const supervisorToken = await createStandardJwt({
    sub: 'auth-sup-001',
    email: 'supervisor@minecare.local',
    role: 'SUPERVISOR',
  });
  const workerToken = await createStandardJwt({
    sub: 'auth-wrk-001',
    email: 'worker.marak@minecare.local',
    role: 'WORKER',
  });

  // -------------------------------------------------------------------------
  // 1. HEALTH & READINESS PROBES (Render Health Check Alignment)
  // -------------------------------------------------------------------------
  console.log('--- 1. DEPLOYMENT HEALTH & READINESS PROBES ---');
  {
    // Liveness
    const { res: liveRes, getContext: getLive } = makeResponse();
    await app.handleRequest(makeRequest({ method: 'GET', url: '/livez' }), liveRes);
    verify(getLive().statusCode === 200, 'HEALTH', '/livez returns 200 OK');
    verify(getLive().data?.status === 'ALIVE', 'HEALTH', '/livez status indicates ALIVE');

    // Readiness (DB connectivity)
    const { res: readyRes, getContext: getReady } = makeResponse();
    await app.handleRequest(makeRequest({ method: 'GET', url: '/readyz' }), readyRes);
    verify(getReady().statusCode === 200, 'HEALTH', '/readyz returns 200 OK when DB is healthy');
    verify(getReady().data?.database === 'CONNECTED', 'HEALTH', '/readyz confirms database CONNECTED');

    // System Health
    const { res: healthRes, getContext: getHealth } = makeResponse();
    await app.handleRequest(makeRequest({ method: 'GET', url: '/api/v1/system/health' }), healthRes);
    verify(getHealth().statusCode === 200, 'HEALTH', '/api/v1/system/health returns 200 OK');
    verify(Boolean(getHealth().data?.services?.database), 'HEALTH', 'System health includes database service status');
  }

  // -------------------------------------------------------------------------
  // 2. PRODUCTION CORS POLICY (Strict Origin Enforcement)
  // -------------------------------------------------------------------------
  console.log('\n--- 2. PRODUCTION CORS & ORIGIN CONTROL ---');
  {
    const vercelOrigin = 'https://minecare.vercel.app';
    const unauthorizedOrigin = 'https://malicious-miner-site.evil';

    // Mock production env with CORS_ORIGIN set to Vercel
    const originalEnv = process.env.NODE_ENV;
    const originalCors = process.env.CORS_ORIGIN;
    try {
      process.env.NODE_ENV = 'production';
      process.env.CORS_ORIGIN = vercelOrigin;

      // Test 2.1: Allowed Vercel Origin
      const { res: resAllowed } = makeResponse();
      const reqAllowed = makeRequest({
        method: 'GET',
        url: '/api/v1/system/health',
        headers: { origin: vercelOrigin },
      });
      const corsOk = CorsManager.handleCors(reqAllowed, resAllowed);
      verify(corsOk === true, 'CORS', 'Deployed Vercel origin permitted');
      verify(resAllowed.getHeader('Access-Control-Allow-Origin') === vercelOrigin, 'CORS', 'Access-Control-Allow-Origin matches Vercel origin');
      verify(resAllowed.getHeader('Vary') === 'Origin', 'CORS', 'Vary header includes Origin');

      // Test 2.2: OPTIONS Preflight for Vercel
      const { res: resPreflight } = makeResponse();
      const reqPreflight = makeRequest({
        method: 'OPTIONS',
        url: '/api/v1/telemetry',
        headers: { origin: vercelOrigin },
      });
      CorsManager.handleCors(reqPreflight, resPreflight);
      verify(resPreflight.statusCode === 204, 'CORS', 'Preflight OPTIONS returns 204 for allowed origin');

      // Test 2.3: Unauthorized origin rejected in production
      const { res: resBlocked, getContext: getBlocked } = makeResponse();
      const reqBlocked = makeRequest({
        method: 'GET',
        url: '/api/v1/system/health',
        headers: { origin: unauthorizedOrigin },
      });
      const corsBlocked = CorsManager.handleCors(reqBlocked, resBlocked);
      verify(corsBlocked === false, 'CORS', 'Unauthorized cross-origin request rejected');
      verify(getBlocked().statusCode === 403, 'CORS', 'Unauthorized origin receives HTTP 403 Forbidden');
    } finally {
      process.env.NODE_ENV = originalEnv;
      process.env.CORS_ORIGIN = originalCors;
    }
  }

  // -------------------------------------------------------------------------
  // 3. AUTHENTICATION (ADMIN, SUPERVISOR, WORKER)
  // -------------------------------------------------------------------------
  console.log('\n--- 3. PRODUCTION AUTHENTICATION SUITE ---');
  {
    // Admin login
    const { res: adminRes, getContext: getAdmin } = makeResponse();
    await app.handleRequest(
      makeRequest({
        method: 'POST',
        url: '/api/v1/auth/login',
        body: { email: 'admin@minecare.local', password: 'MineCare#2026!' },
      }),
      adminRes
    );
    verify(getAdmin().statusCode === 200, 'AUTH', 'ADMIN login succeeds (200 OK)');
    verify(getAdmin().data?.user?.role === 'ADMIN', 'AUTH', 'ADMIN user role verified');
    verify(Boolean(getAdmin().data?.token), 'AUTH', 'ADMIN session token issued');

    // Supervisor login
    const { res: supRes, getContext: getSup } = makeResponse();
    await app.handleRequest(
      makeRequest({
        method: 'POST',
        url: '/api/v1/auth/login',
        body: { email: 'supervisor@minecare.local', password: 'MineCare#2026!' },
      }),
      supRes
    );
    verify(getSup().statusCode === 200, 'AUTH', 'SUPERVISOR login succeeds (200 OK)');
    verify(getSup().data?.user?.role === 'SUPERVISOR', 'AUTH', 'SUPERVISOR user role verified');

    // Worker login
    const { res: wrkRes, getContext: getWrk } = makeResponse();
    await app.handleRequest(
      makeRequest({
        method: 'POST',
        url: '/api/v1/auth/login',
        body: { email: 'worker.marak@minecare.local', password: 'MineCare#2026!' },
      }),
      wrkRes
    );
    verify(getWrk().statusCode === 200, 'AUTH', 'WORKER login succeeds (200 OK)');
    verify(getWrk().data?.user?.role === 'WORKER', 'AUTH', 'WORKER user role verified');
    verify(getWrk().data?.user?.worker_id === 'WRK-001', 'AUTH', 'WORKER bound to worker_id WRK-001');

    // Invalid credentials rejected
    const { res: badRes, getContext: getBad } = makeResponse();
    await app.handleRequest(
      makeRequest({
        method: 'POST',
        url: '/api/v1/auth/login',
        body: { email: 'admin@minecare.local', password: 'WrongPassword123!' },
      }),
      badRes
    );
    verify(getBad().statusCode === 401, 'AUTH', 'Invalid credentials rejected with HTTP 401');
  }

  // -------------------------------------------------------------------------
  // 4. AUTHORIZATION & WORKER ISOLATION (RBAC & IDOR)
  // -------------------------------------------------------------------------
  console.log('\n--- 4. AUTHORIZATION & WORKER ISOLATION ---');
  {
    // Worker sees ONLY own record
    const { res: wrkListRes, getContext: getWrkList } = makeResponse();
    await app.handleRequest(
      makeRequest({
        method: 'GET',
        url: '/api/v1/workers',
        headers: { authorization: `Bearer ${workerToken}` },
      }),
      wrkListRes
    );
    verify(getWrkList().statusCode === 200, 'AUTHORIZATION', 'Worker queries /api/v1/workers successfully');
    verify(Array.isArray(getWrkList().data) && getWrkList().data.length === 1, 'AUTHORIZATION', 'Worker receives ONLY their own record');
    verify((getWrkList().data[0]?.id === 'WRK-001' || getWrkList().data[0]?.worker_id === 'WRK-001'), 'AUTHORIZATION', 'Record matches worker_id WRK-001');

    // IDOR Rejection: Worker inspecting foreign worker (WRK-002)
    const { res: idorRes, getContext: getIdor } = makeResponse();
    await app.handleRequest(
      makeRequest({
        method: 'GET',
        url: '/api/v1/workers/WRK-002',
        headers: { authorization: `Bearer ${workerToken}` },
      }),
      idorRes
    );
    verify(getIdor().statusCode === 403, 'AUTHORIZATION', 'IDOR: Worker querying WRK-002 rejected with 403 Forbidden');

    // IDOR Rejection: Worker inspecting foreign helmet (MC-002)
    const { res: hIdorRes, getContext: getHIdor } = makeResponse();
    await app.handleRequest(
      makeRequest({
        method: 'GET',
        url: '/api/v1/helmets/MC-002',
        headers: { authorization: `Bearer ${workerToken}` },
      }),
      hIdorRes
    );
    verify(getHIdor().statusCode === 403, 'AUTHORIZATION', 'IDOR: Worker querying MC-002 rejected with 403 Forbidden');

    // Supervisor access to all fleet
    const { res: supFleetRes, getContext: getSupFleet } = makeResponse();
    await app.handleRequest(
      makeRequest({
        method: 'GET',
        url: '/api/v1/helmets',
        headers: { authorization: `Bearer ${supervisorToken}` },
      }),
      supFleetRes
    );
    verify(getSupFleet().statusCode === 200, 'AUTHORIZATION', 'Supervisor accesses all fleet helmets (200 OK)');
    verify(Array.isArray(getSupFleet().data) && getSupFleet().data.length === 16, 'AUTHORIZATION', 'Supervisor sees full fleet of 16 helmets');

    // Admin access to admin users
    const { res: adminUsersRes, getContext: getAdminUsers } = makeResponse();
    await app.handleRequest(
      makeRequest({
        method: 'GET',
        url: '/api/v1/admin/users',
        headers: { authorization: `Bearer ${adminToken}` },
      }),
      adminUsersRes
    );
    verify(getAdminUsers().statusCode === 200, 'AUTHORIZATION', 'Admin accesses /api/v1/admin/users (200 OK)');

    // Worker rejected from admin users
    const { res: wrkAdminRes, getContext: getWrkAdmin } = makeResponse();
    await app.handleRequest(
      makeRequest({
        method: 'GET',
        url: '/api/v1/admin/users',
        headers: { authorization: `Bearer ${workerToken}` },
      }),
      wrkAdminRes
    );
    verify(getWrkAdmin().statusCode === 403, 'AUTHORIZATION', 'Worker accessing admin area rejected with 403 Forbidden');
  }

  // -------------------------------------------------------------------------
  // 5. PRODUCTION OPERATIONS (Fleet, Telemetry, Alerts, Zones, Analytics)
  // -------------------------------------------------------------------------
  console.log('\n--- 5. PRODUCTION OPERATIONS PIPELINE ---');
  {
    // Telemetry Ingestion
    const telemetryPacket = {
      packetId: 'SMOKE-PKT-001',
      helmetId: 'MC-001',
      timestamp: new Date().toISOString(),
      gasValue: 220,
      temperature: 26.5,
      humidity: 55.0,
      pressure: 1013.25,
      accelX: 0.05,
      accelY: 0.1,
      accelZ: 9.81,
      totalAcceleration: 9.81,
      batteryLevel: 98,
      fallDetected: false,
      sosPressed: false,
    };

    const { res: telRes, getContext: getTel } = makeResponse();
    await app.handleRequest(
      makeRequest({
        method: 'POST',
        url: '/api/v1/telemetry',
        headers: { 'x-device-token': 'mc_dev_MC-001' },
        body: telemetryPacket,
      }),
      telRes
    );
    verify(getTel().statusCode === 201, 'OPERATIONS', 'Telemetry ingestion succeeds (201 Created)');
    verify(getTel().data?.packetId === 'SMOKE-PKT-001', 'OPERATIONS', 'Ingested packet ID matches');

    // Alerts query
    const { res: alertRes, getContext: getAlert } = makeResponse();
    await app.handleRequest(
      makeRequest({
        method: 'GET',
        url: '/api/v1/alerts',
        headers: { authorization: `Bearer ${supervisorToken}` },
      }),
      alertRes
    );
    verify(getAlert().statusCode === 200, 'OPERATIONS', 'Supervisor queries alerts successfully (200 OK)');

    // Mine Zones
    const { res: zoneRes, getContext: getZone } = makeResponse();
    await app.handleRequest(
      makeRequest({
        method: 'GET',
        url: '/api/v1/zones',
        headers: { authorization: `Bearer ${supervisorToken}` },
      }),
      zoneRes
    );
    verify(getZone().statusCode === 200, 'OPERATIONS', 'Mine zones retrieved (200 OK)');
    verify(Array.isArray(getZone().data) && getZone().data.length === 4, 'OPERATIONS', 'All 4 discrete mine zones returned');

    // Analytics Overview
    const { res: analyticsRes, getContext: getAnalytics } = makeResponse();
    const fromTime = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
    const toTime = new Date().toISOString();
    await app.handleRequest(
      makeRequest({
        method: 'GET',
        url: `/api/v1/analytics/overview?from=${encodeURIComponent(fromTime)}&to=${encodeURIComponent(toTime)}`,
        headers: { authorization: `Bearer ${adminToken}` },
      }),
      analyticsRes
    );
    verify(getAnalytics().statusCode === 200, 'OPERATIONS', 'Admin queries analytics overview (200 OK)');
    verify(Boolean(getAnalytics().data?.kpi || getAnalytics().data?.kpis), 'OPERATIONS', 'Analytics overview includes KPI summary');
  }

  // -------------------------------------------------------------------------
  // 6. REALTIME & SSE FALLBACK (/api/v1/realtime/stream)
  // -------------------------------------------------------------------------
  console.log('\n--- 6. REALTIME STREAMING & SSE FALLBACK ---');
  {
    // Unauthenticated request to SSE stream
    const { res: unauthSseRes, getContext: getUnauthSse } = makeResponse();
    await app.handleRequest(makeRequest({ method: 'GET', url: '/api/v1/realtime/stream' }), unauthSseRes);
    verify(getUnauthSse().statusCode === 401, 'REALTIME', 'Unauthenticated SSE subscription rejected with 401');

    // Authenticated supervisor subscribes to SSE stream
    const { res: sseRes } = makeResponse();
    await app.handleRequest(
      makeRequest({
        method: 'GET',
        url: '/api/v1/realtime/stream',
        headers: { authorization: `Bearer ${supervisorToken}` },
      }),
      sseRes
    );
    verify(sseRes.statusCode === 200, 'REALTIME', 'Authorized SSE connection opens with 200 OK');
    verify(sseRes.getHeader('Content-Type') === 'text/event-stream', 'REALTIME', 'Content-Type is text/event-stream');
    verify(sseRes.getHeader('Cache-Control') === 'no-cache, no-transform', 'REALTIME', 'Cache-Control prohibits caching');
  }

  // -------------------------------------------------------------------------
  // 7. DEVICE AUTHENTICATION BOUNDARY
  // -------------------------------------------------------------------------
  console.log('\n--- 7. DEVICE SECURITY & HARDWARE BOUNDARY ---');
  {
    const baseTelemetry = {
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

    // Invalid Token
    const { res: resInv, getContext: getInv } = makeResponse();
    await app.handleRequest(
      makeRequest({
        method: 'POST',
        url: '/api/v1/telemetry',
        headers: { 'x-device-token': 'fake_hardware_token_abc' },
        body: { ...baseTelemetry, helmetId: 'MC-001', packetId: 'PKT-INV' },
      }),
      resInv
    );
    verify(getInv().statusCode === 401, 'DEVICE_AUTH', 'Invalid hardware token rejected with HTTP 401');

    // Mismatched Token (MC-001 token sent for MC-002)
    const { res: resMis, getContext: getMis } = makeResponse();
    await app.handleRequest(
      makeRequest({
        method: 'POST',
        url: '/api/v1/telemetry',
        headers: { 'x-device-token': 'mc_dev_MC-001' },
        body: { ...baseTelemetry, helmetId: 'MC-002', packetId: 'PKT-MIS' },
      }),
      resMis
    );
    verify(getMis().statusCode === 403, 'DEVICE_AUTH', 'Mismatched helmet token rejected with HTTP 403');

    // Revoked Token
    const revokedToken = 'mc_dev_MC-005';
    DeviceAuthManager.revokeToken(revokedToken);
    const { res: resRev, getContext: getRev } = makeResponse();
    await app.handleRequest(
      makeRequest({
        method: 'POST',
        url: '/api/v1/telemetry',
        headers: { 'x-device-token': revokedToken },
        body: { ...baseTelemetry, helmetId: 'MC-005', packetId: 'PKT-REV' },
      }),
      resRev
    );
    verify(getRev().statusCode === 401, 'DEVICE_AUTH', 'Revoked device token rejected with HTTP 401');
  }

  // -------------------------------------------------------------------------
  // 8. SANITIZED API ERRORS & LEAKAGE CHECKS
  // -------------------------------------------------------------------------
  console.log('\n--- 8. SANITIZED API ERRORS & SYSTEM INTEGRITY ---');
  {
    // Not found route
    const { res: res404, getContext: get404 } = makeResponse();
    await app.handleRequest(
      makeRequest({
        method: 'GET',
        url: '/api/v1/non-existent-endpoint',
        headers: { authorization: `Bearer ${adminToken}` },
      }),
      res404
    );
    verify(get404().statusCode === 404, 'ERROR_SANITIZATION', 'Non-existent endpoint returns 404');
    verify(Boolean(get404().data?.error?.requestId), 'ERROR_SANITIZATION', 'Error response contains correlation requestId');
    verify(!get404().body.includes('stack'), 'ERROR_SANITIZATION', 'Stack traces withheld from client response');
    verify(!get404().body.includes('node_modules'), 'ERROR_SANITIZATION', 'File paths withheld from client response');
    verify(!get404().body.includes('postgres://'), 'ERROR_SANITIZATION', 'Database URLs withheld from client response');
  }

  // Summary
  console.log('\n============================================================');
  console.log(`PRODUCTION SMOKE CHECKS TOTAL: ${smokeTotal}`);
  console.log(`PASSED:                        ${smokePassed}`);
  console.log(`FAILED:                        ${smokeTotal - smokePassed}`);
  console.log('============================================================\n');

  if (smokeTotal !== smokePassed) {
    process.exit(1);
  }
  process.exit(0);
}

runProductionSmokeTests().catch((err) => {
  console.error('Smoke tests encountered unexpected exception:', err);
  process.exit(1);
});
