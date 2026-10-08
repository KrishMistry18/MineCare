import { BackendApp } from '../src/backend/app';
import { RealtimePublisher } from '../src/backend/realtime/RealtimePublisher';
import type { IncomingMessage, ServerResponse } from 'http';

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

async function runScenarioCheck() {
  console.log('============================================================');
  console.log('LOCAL MANUAL E2E VERIFICATION - SCENARIO PROPAGATION SUITE');
  console.log('============================================================\n');

  BackendApp.resetInstance();
  const app = BackendApp.getInstance();
  const db = app.getDb();

  // Login as ADMIN
  const { res: loginRes, ctx: loginCtx } = createMockRes();
  await app.handleRequest(
    createMockReq({
      method: 'POST',
      url: '/api/v1/auth/login',
      body: { email: 'admin@minecare.local', password: 'Admin#Password2026' },
    }),
    loginRes
  );

  const token = loginCtx.data?.token;
  if (!token) {
    throw new Error('Admin login failed');
  }
  console.log('✓ Admin login successful');

  const realtimeEvents: any[] = [];
  RealtimePublisher.getInstance().subscribe((evt) => {
    realtimeEvents.push(evt);
  });

  const scenarios = [
    { name: 'A. HIGH GAS', scenario: 'HIGH_GAS', expectedStatus: 'WARNING', expectedAlert: 'GAS_HAZARD' },
    { name: 'B. HIGH TEMPERATURE', scenario: 'HIGH_TEMPERATURE', expectedStatus: 'WARNING', expectedAlert: 'HEAT_STRESS' },
    { name: 'C. FALL', scenario: 'FALL_DETECTED', expectedStatus: 'DANGER', expectedAlert: 'WORKER_FALL' },
    { name: 'D. SOS', scenario: 'SOS_ACTIVATED', expectedStatus: 'DANGER', expectedAlert: 'SOS_EMERGENCY' },
    { name: 'E. MULTIPLE ALERTS', scenario: 'MULTIPLE_HAZARDS', expectedStatus: 'DANGER', expectedAlert: 'MULTIPLE' },
    { name: 'F. RECOVERY', scenario: 'RECOVERY', expectedStatus: 'SAFE', expectedAlert: 'RESOLVED' },
  ];

  const results: any[] = [];

  for (const item of scenarios) {
    console.log(`\n------------------------------------------------------------`);
    console.log(`Running Scenario: ${item.name}`);
    console.log(`------------------------------------------------------------`);

    // Capture BEFORE state
    const helmetBefore = await db.getHelmetWithDetails('MC-001');
    const teleBefore = await db.getTelemetryHistory('MC-001', 50);
    const alertsBefore = (await db.getActiveAlerts()).filter((a) => a.helmet_id === 'MC-001');
    const rtCountBefore = realtimeEvents.length;

    // Trigger simulation scenario
    const { res, ctx } = createMockRes();
    await app.handleRequest(
      createMockReq({
        method: 'POST',
        url: '/api/v1/simulation/scenario',
        headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
        body: { helmetId: 'MC-001', scenario: item.scenario },
      }),
      res
    );

    // Capture AFTER state
    const helmetAfter = await db.getHelmetWithDetails('MC-001');
    const teleAfter = await db.getTelemetryHistory('MC-001', 50);
    const alertsAfter = (await db.getActiveAlerts()).filter((a) => a.helmet_id === 'MC-001');
    const newRtEvents = realtimeEvents.slice(rtCountBefore);

    const latestPacket = ctx.data?.telemetry || (teleAfter.length > 0 ? teleAfter[teleAfter.length - 1] : null);

    const result = {
      scenario: item.name,
      httpStatus: ctx.statusCode,
      apiSuccess: ctx.statusCode === 201,
      safetyStatusReturned: ctx.data?.safety?.status,
      before: {
        status: helmetBefore?.status,
        online: helmetBefore?.online,
        telemetryCount: teleBefore.length,
        activeAlertsCount: alertsBefore.length,
      },
      after: {
        status: helmetAfter?.status,
        online: helmetAfter?.online,
        telemetryCount: teleAfter.length,
        activeAlertsCount: alertsAfter.length,
        gasValue: latestPacket?.gas_value,
        temperature: latestPacket?.temperature,
        totalAcceleration: latestPacket?.total_acceleration,
        sosPressed: latestPacket?.sos_pressed,
        fallDetected: latestPacket?.fall_detected,
      },
      telemetryCreated: teleAfter.length > teleBefore.length || teleAfter[0]?.packet_id !== teleBefore[0]?.packet_id,
      helmetStatusChanged: helmetAfter?.status === item.expectedStatus,
      alertCreatedOrResolved: item.scenario === 'RECOVERY' 
        ? alertsAfter.length === 0 
        : alertsAfter.some((a) => a.type === item.expectedAlert || item.expectedAlert === 'MULTIPLE'),
      realtimeEventsEmitted: newRtEvents.map((e) => ({ table: e.table, type: e.eventType })),
    };

    results.push(result);

    console.log(`HTTP Status:               ${result.httpStatus} (Expected 201)`);
    console.log(`Helmet Status Before/After: ${result.before.status} -> ${result.after.status} (Expected: ${item.expectedStatus})`);
    console.log(`Active Alerts Before/After: ${result.before.activeAlertsCount} -> ${result.after.activeAlertsCount}`);
    console.log(`Telemetry Values:          Gas=${result.after.gasValue} ADC, Temp=${result.after.temperature}°C, Accel=${result.after.totalAcceleration} m/s², SOS=${result.after.sosPressed}`);
    console.log(`Realtime Events:           ${JSON.stringify(result.realtimeEventsEmitted)}`);
    console.log(`✓ Scenario Verified:       ${result.helmetStatusChanged && result.apiSuccess}`);
  }

  console.log('\n============================================================');
  console.log('SUMMARY TABLE');
  console.log('============================================================');
  console.log(JSON.stringify(results, null, 2));

  BackendApp.resetInstance();
  const { connectionManager } = await import('../src/backend/db/connection');
  await connectionManager.closePool();
  process.exit(0);
}

runScenarioCheck().catch((err) => {
  console.error(err);
  process.exit(1);
});
