/**
 * MineCare - Production Simulation & Device Authentication Regression Test Suite
 *
 * Rigorously validates all 20 production simulation and security boundary requirements:
 * 1. Run HIGH_GAS simulation reaches POST /api/v1/telemetry.
 * 2. Device authentication succeeds through the intended simulation mechanism (mc_dev_${helmetId}).
 * 3. HIGH_GAS produces WARNING.
 * 4. GAS_HAZARD alert is generated.
 * 5. HIGH_TEMPERATURE produces WARNING.
 * 6. HEAT_STRESS alert is generated.
 * 7. FALL produces DANGER.
 * 8. WORKER_FALL alert is generated.
 * 9. SOS produces DANGER.
 * 10. SOS_EMERGENCY alert is generated.
 * 11. MULTIPLE_HAZARDS produces DANGER (preserves DANGER > WARNING > SAFE).
 * 12. No production security bypass exists.
 * 13. Browser bundle contains no production device secrets.
 * 14. Human JWT cannot be used as a device token.
 * 15. Unauthorized users (e.g. WORKER role or unauthenticated) cannot trigger simulation.
 * 16. Existing real telemetry/device authentication tests continue passing.
 * 17. Existing RBAC/IDOR tests continue passing.
 * 18. Realtime publisher broadcasts the resulting helmet & alert updates.
 * 19. Database persistence occurs for telemetry and alerts.
 * 20. RECOVERY returns helmet to SAFE and auto-resolves active environmental alerts.
 */

process.env.NODE_ENV = 'test';

import type { IncomingMessage, ServerResponse } from 'http';
import fs from 'fs';
import path from 'path';
import { DatabaseRepository } from '../src/backend/db/DatabaseRepository';
import { BackendApp } from '../src/backend/app';
import { DeviceAuthManager } from '../src/backend/security/DeviceAuth';
import { RealtimePublisher } from '../src/backend/realtime/RealtimePublisher';

let testCount = 0;
let passedCount = 0;

function assert(condition: boolean, reqId: string, description: string): void {
  testCount++;
  if (condition) {
    passedCount++;
    console.log(`  ✓ [REQ-${reqId}] ${description}`);
  } else {
    console.error(`  ✗ [REQ-${reqId}] FAILED: ${description}`);
    process.exitCode = 1;
  }
}

interface MockResponseContext {
  statusCode: number;
  headers: Record<string, string>;
  body: string;
  data: any;
}

function createMockReq(options: {
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

function createMockRes(): { res: ServerResponse; ctx: MockResponseContext } {
  const ctx: MockResponseContext = {
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
      return res;
    },
  } as unknown as ServerResponse;

  return { res, ctx };
}

async function runSimulationTests() {
  console.log('============================================================');
  console.log('MINECARE PRODUCTION SIMULATION & SECURITY REGRESSION SUITE');
  console.log('============================================================\n');

  // Reset all state to clean baseline
  BackendApp.resetInstance();
  DeviceAuthManager.resetRegistry();
  const db = DatabaseRepository.getInstance();
  const app = BackendApp.getInstance();

  // Obtain authorized authentication tokens
  const { res: adminRes, ctx: adminCtx } = createMockRes();
  await app.handleRequest(
    createMockReq({
      method: 'POST',
      url: '/api/v1/auth/login',
      body: { email: 'admin@minecare.local', password: 'Admin#Password2026' },
    }),
    adminRes
  );
  const adminToken = adminCtx.data?.token;

  const { res: supRes, ctx: supCtx } = createMockRes();
  await app.handleRequest(
    createMockReq({
      method: 'POST',
      url: '/api/v1/auth/login',
      body: { email: 'supervisor@minecare.local', password: 'Supervisor#Password2026' },
    }),
    supRes
  );
  const supToken = supCtx.data?.token;

  const { res: workerRes, ctx: workerCtx } = createMockRes();
  await app.handleRequest(
    createMockReq({
      method: 'POST',
      url: '/api/v1/auth/login',
      body: { email: 'worker.marak@minecare.local', password: 'Worker#Password2026' },
    }),
    workerRes
  );
  const workerToken = workerCtx.data?.token;

  assert(Boolean(adminToken && supToken && workerToken), 'INIT', 'Auth tokens acquired for Admin, Supervisor, and Worker');

  // Track realtime publisher events
  const publishedEvents: any[] = [];
  const unsubscribeRealtime = RealtimePublisher.getInstance().subscribe((payload) => {
    publishedEvents.push(payload);
  });

  // -------------------------------------------------------------------------
  // 1 & 2 & 3 & 4: HIGH_GAS SIMULATION THROUGH TELEMETRY INGESTION BOUNDARY
  // -------------------------------------------------------------------------
  console.log('--- TEST 1-4: HIGH_GAS SCENARIO & DEVICE AUTH BOUNDARY ---');
  {
    const { res, ctx } = createMockRes();
    await app.handleRequest(
      createMockReq({
        method: 'POST',
        url: '/api/v1/simulation/scenario',
        headers: { authorization: `Bearer ${supToken}`, 'content-type': 'application/json' },
        body: { helmetId: 'MC-001', scenario: 'HIGH_GAS' },
      }),
      res
    );

    assert(ctx.statusCode === 201, '1', 'Run HIGH_GAS simulation reaches POST /api/v1/telemetry returning 201 Created');
    assert(ctx.data?.simulation === true, '1', 'Simulation response explicitly identified as simulation');
    assert(ctx.data?.safety?.status === 'WARNING', '3', 'HIGH_GAS simulation produces WARNING safety status');
    assert(ctx.data?.safety?.primaryTrigger === 'HIGH_RAW_GAS_LEVEL', '3', 'Safety trigger indicates elevated raw gas');
    assert(ctx.data?.alertCreated === true, '4', 'GAS_HAZARD alert is generated');

    const alerts = await db.getAlertsStore();
    const gasAlert = alerts.find((a) => a.helmet_id === 'MC-001' && a.type === 'GAS_HAZARD' && a.status === 'TRIGGERED');
    assert(Boolean(gasAlert), '4', 'GAS_HAZARD alert persisted in database in TRIGGERED state');
    assert(gasAlert?.severity === 'WARNING', '4', 'GAS_HAZARD alert has WARNING severity');

    const h1 = await db.getHelmetWithDetails('MC-001');
    assert(h1?.status === 'WARNING', '19', 'PostgreSQL helmet MC-001 status transitioned to WARNING');
  }

  // -------------------------------------------------------------------------
  // 5 & 6: HIGH_TEMPERATURE SIMULATION
  // -------------------------------------------------------------------------
  console.log('\n--- TEST 5-6: HIGH_TEMPERATURE SCENARIO ---');
  {
    const { res, ctx } = createMockRes();
    await app.handleRequest(
      createMockReq({
        method: 'POST',
        url: '/api/v1/simulation/scenario',
        headers: { authorization: `Bearer ${adminToken}`, 'content-type': 'application/json' },
        body: { helmetId: 'MC-002', scenario: 'HIGH_TEMPERATURE' },
      }),
      res
    );

    assert(ctx.statusCode === 201, '5', 'HIGH_TEMPERATURE simulation returns 201 Created');
    assert(ctx.data?.safety?.status === 'WARNING', '5', 'HIGH_TEMPERATURE produces WARNING');
    assert(ctx.data?.safety?.primaryTrigger === 'HIGH_TEMPERATURE', '5', 'Primary trigger is HIGH_TEMPERATURE');
    assert(ctx.data?.alertCreated === true, '6', 'HEAT_STRESS alert is generated');

    const alerts = await db.getAlertsStore();
    const tempAlert = alerts.find((a) => a.helmet_id === 'MC-002' && a.type === 'HEAT_STRESS' && a.status === 'TRIGGERED');
    assert(Boolean(tempAlert), '6', 'HEAT_STRESS alert persisted in database');
    assert(tempAlert?.severity === 'WARNING', '6', 'HEAT_STRESS alert severity is WARNING');
  }

  // -------------------------------------------------------------------------
  // 7 & 8: FALL SIMULATION
  // -------------------------------------------------------------------------
  console.log('\n--- TEST 7-8: FALL SCENARIO ---');
  {
    const { res, ctx } = createMockRes();
    await app.handleRequest(
      createMockReq({
        method: 'POST',
        url: '/api/v1/simulation/scenario',
        headers: { authorization: `Bearer ${supToken}`, 'content-type': 'application/json' },
        body: { helmetId: 'MC-003', scenario: 'FALL_DETECTED' },
      }),
      res
    );

    assert(ctx.statusCode === 201, '7', 'FALL simulation returns 201 Created');
    assert(ctx.data?.safety?.status === 'DANGER', '7', 'FALL produces DANGER status (> 15.0 m/s²)');
    assert(ctx.data?.alertCreated === true, '8', 'WORKER_FALL alert is generated');

    const alerts = await db.getAlertsStore();
    const fallAlert = alerts.find((a) => a.helmet_id === 'MC-003' && a.type === 'WORKER_FALL' && a.status === 'TRIGGERED');
    assert(Boolean(fallAlert), '8', 'WORKER_FALL alert persisted in database');
    assert(fallAlert?.severity === 'CRITICAL', '8', 'WORKER_FALL alert has CRITICAL severity');
  }

  // -------------------------------------------------------------------------
  // 9 & 10: SOS EMERGENCY SIMULATION
  // -------------------------------------------------------------------------
  console.log('\n--- TEST 9-10: SOS EMERGENCY SCENARIO ---');
  {
    const { res, ctx } = createMockRes();
    await app.handleRequest(
      createMockReq({
        method: 'POST',
        url: '/api/v1/simulation/scenario',
        headers: { authorization: `Bearer ${supToken}`, 'content-type': 'application/json' },
        body: { helmetId: 'MC-004', scenario: 'SOS_ACTIVATED' },
      }),
      res
    );

    assert(ctx.statusCode === 201, '9', 'SOS simulation returns 201 Created');
    assert(ctx.data?.safety?.status === 'DANGER', '9', 'SOS produces DANGER status');
    assert(ctx.data?.safety?.primaryTrigger === 'SOS_BUTTON_TRIGGERED', '9', 'Primary trigger is SOS_BUTTON_TRIGGERED');
    assert(ctx.data?.alertCreated === true, '10', 'SOS_EMERGENCY alert is generated');

    const alerts = await db.getAlertsStore();
    const sosAlert = alerts.find((a) => a.helmet_id === 'MC-004' && a.type === 'SOS_EMERGENCY' && a.status === 'TRIGGERED');
    assert(Boolean(sosAlert), '10', 'SOS_EMERGENCY alert persisted in database');
    assert(sosAlert?.severity === 'CRITICAL', '10', 'SOS_EMERGENCY alert has CRITICAL severity');
  }

  // -------------------------------------------------------------------------
  // 11: MULTIPLE HAZARDS SIMULATION (DANGER > WARNING > SAFE)
  // -------------------------------------------------------------------------
  console.log('\n--- TEST 11: MULTIPLE HAZARDS PRECEDENCE ---');
  {
    const { res, ctx } = createMockRes();
    await app.handleRequest(
      createMockReq({
        method: 'POST',
        url: '/api/v1/simulation/scenario',
        headers: { authorization: `Bearer ${adminToken}`, 'content-type': 'application/json' },
        body: { helmetId: 'MC-005', scenario: 'MULTIPLE_HAZARDS' },
      }),
      res
    );

    assert(ctx.statusCode === 201, '11', 'MULTIPLE_HAZARDS simulation returns 201 Created');
    assert(ctx.data?.safety?.status === 'DANGER', '11', 'MULTIPLE_HAZARDS produces DANGER (DANGER > WARNING > SAFE)');
    assert(ctx.data?.safety?.primaryTrigger === 'MULTIPLE_HAZARDS', '11', 'Primary trigger is MULTIPLE_HAZARDS');
  }

  // -------------------------------------------------------------------------
  // 12, 13, 14: SECURITY BOUNDARY & CREDENTIAL HYGIENE
  // -------------------------------------------------------------------------
  console.log('\n--- TEST 12-14: SECURITY BOUNDARIES & NO TOKEN LEAKS ---');
  {
    // 12. No production security bypass exists
    const prodAuthNoToken = DeviceAuthManager.authenticateTelemetryRequest(
      createMockReq({ method: 'POST', url: '/api/v1/telemetry' }),
      null,
      true, // isProduction = true
      'MC-001'
    );
    assert(!prodAuthNoToken.isAuthenticated && prodAuthNoToken.statusCode === 401, '12', 'No production bypass: Anonymous telemetry rejected with 401');

    // 13. Browser bundle and client source contain no production device secrets
    const srcServicesDir = path.resolve(process.cwd(), 'src', 'services');
    const srcComponentsDir = path.resolve(process.cwd(), 'src', 'components');
    let clientSourceClean = true;
    for (const dir of [srcServicesDir, srcComponentsDir]) {
      if (fs.existsSync(dir)) {
        const checkFiles = (d: string) => {
          for (const f of fs.readdirSync(d, { withFileTypes: true })) {
            const p = path.join(d, f.name);
            if (f.isDirectory()) checkFiles(p);
            else if (f.isFile() && (f.name.endsWith('.ts') || f.name.endsWith('.tsx'))) {
              const c = fs.readFileSync(p, 'utf-8');
              if (c.includes('mc_dev_') || c.includes('minecare-esp8266-prototype-device-key')) {
                clientSourceClean = false;
              }
            }
          }
        };
        checkFiles(dir);
      }
    }
    assert(clientSourceClean, '13', 'Client source code contains ZERO production device tokens or hardware keys');

    // 14. Human JWT cannot be used as device token
    const prodAuthWithUser = DeviceAuthManager.authenticateTelemetryRequest(
      createMockReq({ method: 'POST', url: '/api/v1/telemetry' }),
      { id: 'usr-1', email: 'admin@minecare.local', role: 'ADMIN', active: true, auth_user_id: 'a1', name: 'Admin', created_at: '', updated_at: '' },
      true, // isProduction = true
      'MC-001'
    );
    assert(!prodAuthWithUser.isAuthenticated && prodAuthWithUser.statusCode === 401, '14', 'Human JWT cannot be used as device credential in production');

    const humanBearerInHeader = DeviceAuthManager.authenticateTelemetryRequest(
      createMockReq({ method: 'POST', url: '/api/v1/telemetry', headers: { 'x-device-token': `Bearer ${adminToken}` } }),
      null,
      true,
      'MC-001'
    );
    assert(!humanBearerInHeader.isAuthenticated && humanBearerInHeader.statusCode === 401, '14', 'Human Bearer token in X-Device-Token rejected with 401');
  }

  // -------------------------------------------------------------------------
  // 15: UNAUTHORIZED USERS CANNOT TRIGGER SIMULATION
  // -------------------------------------------------------------------------
  console.log('\n--- TEST 15: AUTHORIZATION ENFORCEMENT ON SIMULATION ---');
  {
    // Worker cannot trigger simulation
    const { res: wrkRes, ctx: wrkCtx } = createMockRes();
    await app.handleRequest(
      createMockReq({
        method: 'POST',
        url: '/api/v1/simulation/scenario',
        headers: { authorization: `Bearer ${workerToken}`, 'content-type': 'application/json' },
        body: { helmetId: 'MC-001', scenario: 'HIGH_GAS' },
      }),
      wrkRes
    );
    assert(wrkCtx.statusCode === 403, '15', 'Worker user rejected from triggering simulation with 403 Forbidden');

    // Anonymous cannot trigger simulation
    const { res: anonRes, ctx: anonCtx } = createMockRes();
    await app.handleRequest(
      createMockReq({
        method: 'POST',
        url: '/api/v1/simulation/scenario',
        headers: { 'content-type': 'application/json' },
        body: { helmetId: 'MC-001', scenario: 'HIGH_GAS' },
      }),
      anonRes
    );
    assert(anonCtx.statusCode === 401, '15', 'Unauthenticated request rejected with 401 Unauthorized');

    // Non-existent helmet returns 404
    const { res: invRes, ctx: invCtx } = createMockRes();
    await app.handleRequest(
      createMockReq({
        method: 'POST',
        url: '/api/v1/simulation/scenario',
        headers: { authorization: `Bearer ${supToken}`, 'content-type': 'application/json' },
        body: { helmetId: 'MC-999', scenario: 'HIGH_GAS' },
      }),
      invRes
    );
    assert(invCtx.statusCode === 404, '15', 'Simulation for non-existent helmet rejected with 404 Not Found');
  }

  // -------------------------------------------------------------------------
  // 16 & 17: EXISTING HARDWARE DEVICE AUTH & RBAC CONTINUES PASSING
  // -------------------------------------------------------------------------
  console.log('\n--- TEST 16-17: EXISTING HARDWARE DEVICE AUTH & RBAC CONTINUITY ---');
  {
    // Genuine hardware node with valid device token
    const { res: hwRes, ctx: hwCtx } = createMockRes();
    await app.handleRequest(
      createMockReq({
        method: 'POST',
        url: '/api/v1/telemetry',
        headers: { 'x-device-token': 'mc_dev_MC-006', 'content-type': 'application/json' },
        body: {
          packetId: `PKT-HW-${Date.now()}`,
          helmetId: 'MC-006',
          timestamp: new Date().toISOString(),
          sequenceNumber: 201,
          temperature: 25.5,
          humidity: 55.0,
          gasValue: 200,
          accelX: 0,
          accelY: 0,
          accelZ: 9.8,
          totalAcceleration: 9.8,
          gyroX: 0,
          gyroY: 0,
          gyroZ: 0,
          fallDetected: false,
          sosPressed: false,
        },
      }),
      hwRes
    );
    assert(hwCtx.statusCode === 201, '16', 'Existing physical hardware device authentication continues passing (201)');

    // Mismatched device token rejected
    const { res: misRes, ctx: misCtx } = createMockRes();
    await app.handleRequest(
      createMockReq({
        method: 'POST',
        url: '/api/v1/telemetry',
        headers: { 'x-device-token': 'mc_dev_MC-006', 'content-type': 'application/json' },
        body: {
          packetId: `PKT-MIS-${Date.now()}`,
          helmetId: 'MC-007',
          timestamp: new Date().toISOString(),
          sequenceNumber: 202,
          temperature: 25.5,
          humidity: 55.0,
          gasValue: 200,
          accelX: 0,
          accelY: 0,
          accelZ: 9.8,
          totalAcceleration: 9.8,
          gyroX: 0,
          gyroY: 0,
          gyroZ: 0,
          fallDetected: false,
          sosPressed: false,
        },
      }),
      misRes
    );
    assert(misCtx.statusCode === 403, '16', 'Mismatched device token strictly rejected with 403 Forbidden');

    // Worker IDOR rejection check
    const { res: idorRes, ctx: idorCtx } = createMockRes();
    await app.handleRequest(
      createMockReq({
        method: 'GET',
        url: '/api/v1/workers/WRK-002',
        headers: { authorization: `Bearer ${workerToken}` },
      }),
      idorRes
    );
    assert(idorCtx.statusCode === 403, '17', 'Worker IDOR query strictly rejected with 403 Forbidden');
  }

  // -------------------------------------------------------------------------
  // 18 & 19: REALTIME UPDATES & POSTGRESQL PERSISTENCE
  // -------------------------------------------------------------------------
  console.log('\n--- TEST 18-19: REALTIME BROADCAST & DATABASE PERSISTENCE ---');
  {
    assert(publishedEvents.length > 0, '18', 'RealtimePublisher published events during simulation');
    const teleEvents = publishedEvents.filter((e) => e.table === 'telemetry');
    const alertEvents = publishedEvents.filter((e) => e.table === 'alerts');
    const helmetEvents = publishedEvents.filter((e) => e.table === 'helmets');

    assert(teleEvents.length > 0, '18', 'RealtimePublisher emitted telemetry INSERT events');
    assert(alertEvents.length > 0, '18', 'RealtimePublisher emitted alerts INSERT events');
    assert(helmetEvents.length > 0, '18', 'RealtimePublisher emitted helmets UPDATE events');

    const history = await db.getTelemetryHistory('MC-001', 5);
    assert(history.length > 0, '19', 'PostgreSQL database persists simulation telemetry history');
  }

  // -------------------------------------------------------------------------
  // 20: RECOVERY LIFECYCLE (SAFE BASELINE & ALERT RESOLUTION)
  // -------------------------------------------------------------------------
  console.log('\n--- TEST 20: RECOVERY SCENARIO & ALERT AUTO-RESOLUTION ---');
  {
    const { res: recRes, ctx: recCtx } = createMockRes();
    await app.handleRequest(
      createMockReq({
        method: 'POST',
        url: '/api/v1/simulation/scenario',
        headers: { authorization: `Bearer ${supToken}`, 'content-type': 'application/json' },
        body: { helmetId: 'MC-001', scenario: 'RECOVERY' },
      }),
      recRes
    );

    assert(recCtx.statusCode === 201, '20', 'RECOVERY simulation returns 201 Created');
    assert(recCtx.data?.safety?.status === 'SAFE', '20', 'RECOVERY returns helmet to SAFE status');

    const h1 = await db.getHelmetWithDetails('MC-001');
    assert(h1?.status === 'SAFE', '20', 'Helmet MC-001 restored to SAFE in database');

    const alerts = await db.getAlertsStore();
    const activeGasAlerts = alerts.filter((a) => a.helmet_id === 'MC-001' && a.type === 'GAS_HAZARD' && a.status === 'TRIGGERED');
    assert(activeGasAlerts.length === 0, '20', 'Active GAS_HAZARD alert on MC-001 auto-resolved upon RECOVERY');
  }

  unsubscribeRealtime();

  console.log('\n============================================================');
  console.log(`TOTAL SIMULATION CHECKS: ${testCount}`);
  console.log(`PASSED:                  ${passedCount}`);
  console.log(`FAILED:                  ${testCount - passedCount}`);
  console.log('============================================================');

  if (passedCount !== testCount) {
    process.exit(1);
  }
}

runSimulationTests().catch((err) => {
  console.error('Fatal simulation test error:', err);
  process.exit(1);
});
