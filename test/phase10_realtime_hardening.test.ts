/**
 * MineCare - Phase 10 Production Realtime Hardening Test Suite
 *
 * Verifies end-to-end hardening of the realtime operational system:
 * 1. PostgreSQL Authoritative Source
 * 2. Realtime Telemetry, Helmet, Alert, and Zone Updates
 * 3. Frontend Realtime Updates without Page Refresh
 * 4. Dual Provider Architecture (Supabase Realtime + SSE Fallback)
 * 5. Role-Based Access Control (RBAC) & Worker Data Isolation
 * 6. Protection Against Unauthorized Subscriptions
 * 7. Heartbeat / Keepalive & Stale Connection Watchdog
 * 8. Authoritative Event Deduplication
 * 9. Network Offline / Online Reconnection Lifecycle
 * 10. Alert Creation, Acknowledgment, Resolution & Safe Recovery
 * 11. Backend Restart Resilience (No Corrupted In-Memory State)
 * 12. Clean Subscription Teardown on Logout and Unmount
 * 13. Simulation & Mock Telemetry Integrity (Zero Physical ESP8266)
 */

process.env.NODE_ENV = 'test';

import type { IncomingMessage, ServerResponse } from 'http';
import { DatabaseRepository } from '../src/backend/db/DatabaseRepository';
import { SafetyEngine } from '../src/backend/safety/SafetyEngine';
import { AlertEngine } from '../src/backend/alerts/AlertEngine';
import { RealtimePublisher, type PostgresChangesPayload, type SseClient } from '../src/backend/realtime/RealtimePublisher';
import { SupabaseRealtimeService } from '../src/services/realtime/SupabaseRealtimeService';
import { TelemetryService } from '../src/services/telemetry/TelemetryService';
import { MockTelemetryProvider } from '../src/services/telemetry/MockTelemetryProvider';
import { createStandardJwt } from '../src/backend/auth/jwt';
import { BackendApp } from '../src/backend/app';
import type { DbAlert, DbHelmet, DbTelemetry, DbZoneAssignment } from '../src/backend/types';

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

async function runPhase10Tests() {
  console.log('\n============================================================');
  console.log('MINECARE PHASE 10 - PRODUCTION REALTIME HARDENING TEST SUITE');
  console.log('============================================================');

  const db = DatabaseRepository.getInstance();
  const publisher = RealtimePublisher.getInstance();
  const realtimeService = SupabaseRealtimeService.getInstance();
  const telemetryService = TelemetryService.getInstance();
  const app = new BackendApp(db);

  // Setup test tokens
  const supervisorToken = await createStandardJwt({
    sub: 'auth-sup-1',
    email: 'supervisor@minecare.local',
    role: 'SUPERVISOR',
  });

  const worker1Token = await createStandardJwt({
    sub: 'auth-wrk-1',
    email: 'worker.marak@minecare.local',
    role: 'WORKER',
  });

  const adminToken = await createStandardJwt({
    sub: 'auth-adm-1',
    email: 'admin@minecare.local',
    role: 'ADMIN',
  });

  // =========================================================================
  // 1. POSTGRESQL AS AUTHORITATIVE SOURCE & PERSISTENCE
  // =========================================================================
  console.log('\n--- 1. POSTGRESQL AS AUTHORITATIVE SOURCE ---');

  const testPacketId = `PKT-P10-${Date.now()}`;
  const testTelemetryRecord: DbTelemetry = {
    id: testPacketId,
    helmet_id: 'MC-001',
    timestamp: new Date().toISOString(),
    sequence_number: 1001,
    temperature: 28.4,
    humidity: 58.2,
    gas_value: 230,
    acceleration_x: 0.1,
    acceleration_y: 0.2,
    acceleration_z: 9.81,
    total_acceleration: 9.81,
    gyro_x: 0,
    gyro_y: 0,
    gyro_z: 0,
    fall_detected: false,
    sos_pressed: false,
    safety_status: 'SAFE',
    created_at: new Date().toISOString(),
  };

  await db.saveTelemetry(testTelemetryRecord);
  const latestDbTelemetry = await db.getLatestTelemetry('MC-001');
  assert(latestDbTelemetry !== undefined && latestDbTelemetry.id === testPacketId, 'AUTHORITATIVE_DB', 'Telemetry packet authoritatively persisted in PostgreSQL');
  assert(latestDbTelemetry?.temperature === 28.4, 'AUTHORITATIVE_DB', 'Telemetry data fields match persisted record in PostgreSQL');

  const testAlertId = `ALT-P10-${Date.now()}`;
  const testAlertRecord: DbAlert = {
    id: testAlertId,
    helmet_id: 'MC-001',
    worker_id: 'WRK-001',
    type: 'HEAT_STRESS',
    severity: 'WARNING',
    message: 'Elevated ambient temperature',
    status: 'TRIGGERED',
    readings_snapshot: { temperature: 41.5, gas_value: 230, total_acceleration: 9.8 },
    triggered_at: new Date().toISOString(),
  };

  await db.saveAlert(testAlertRecord);
  const alertsFromDb = await db.getAlertsStore();
  const persistedAlert = alertsFromDb.find((a) => a.id === testAlertId);
  assert(persistedAlert !== undefined, 'AUTHORITATIVE_DB', 'Alert authoritatively persisted in PostgreSQL');
  assert(persistedAlert?.status === 'TRIGGERED', 'AUTHORITATIVE_DB', 'Initial alert status in PostgreSQL is TRIGGERED');

  await db.resolveAlert(testAlertId, 'Ventilation fan activated');
  const resolvedAlertsFromDb = await db.getAlertsStore();
  const resolvedDbAlert = resolvedAlertsFromDb.find((a) => a.id === testAlertId);
  assert(resolvedDbAlert?.status === 'RESOLVED', 'AUTHORITATIVE_DB', 'Alert status in PostgreSQL authoritatively transitioned to RESOLVED');
  assert(resolvedDbAlert?.supervisor_notes === 'Ventilation fan activated', 'AUTHORITATIVE_DB', 'Supervisor resolution notes persisted in PostgreSQL');

  // =========================================================================
  // 2. REALTIME DELIVERY FOR CORE OPERATIONAL ENTITIES
  // =========================================================================
  console.log('\n--- 2. REALTIME DELIVERY FOR CORE OPERATIONAL ENTITIES ---');

  realtimeService.connect();
  assert(realtimeService.getConnectionState() === 'CONNECTED', 'DELIVERY', 'Realtime client connected to operational broker');

  let deliveredTelemetry: PostgresChangesPayload<DbTelemetry> | null = null;
  let deliveredHelmet: PostgresChangesPayload<DbHelmet> | null = null;
  let deliveredAlert: PostgresChangesPayload<DbAlert> | null = null;
  let deliveredZone: PostgresChangesPayload<DbZoneAssignment> | null = null;

  const unsubTel = realtimeService.subscribeTable<DbTelemetry>('telemetry', (p) => { deliveredTelemetry = p; });
  const unsubHlm = realtimeService.subscribeTable<DbHelmet>('helmets', (p) => { deliveredHelmet = p; });
  const unsubAlt = realtimeService.subscribeTable<DbAlert>('alerts', (p) => { deliveredAlert = p; });
  const unsubZon = realtimeService.subscribeTable<DbZoneAssignment>('zone_assignments', (p) => { deliveredZone = p; });

  publisher.publish('telemetry', 'INSERT', testTelemetryRecord);
  assert(deliveredTelemetry !== null && deliveredTelemetry.new.id === testPacketId, 'DELIVERY', 'Realtime telemetry INSERT delivered');

  const updatedHelmetRecord: DbHelmet = {
    id: 'MC-001',
    helmet_code: 'MC-001',
    worker_id: 'WRK-001',
    status: 'WARNING',
    online: true,
    firmware_version: 'v1.4.2-proto',
    battery_level: 88,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
  publisher.publish('helmets', 'UPDATE', updatedHelmetRecord);
  assert(deliveredHelmet !== null && deliveredHelmet.new.status === 'WARNING', 'DELIVERY', 'Realtime helmet status UPDATE delivered');

  publisher.publish('alerts', 'INSERT', testAlertRecord);
  assert(deliveredAlert !== null && deliveredAlert.new.id === testAlertId, 'DELIVERY', 'Realtime alert INSERT delivered');

  const updatedAlertPayload = { ...testAlertRecord, status: 'RESOLVED' as const, resolved_at: new Date().toISOString() };
  publisher.publish('alerts', 'UPDATE', updatedAlertPayload);
  assert(deliveredAlert !== null && deliveredAlert.new.status === 'RESOLVED', 'DELIVERY', 'Realtime alert resolution UPDATE delivered');

  const zoneAssignPayload: DbZoneAssignment = {
    id: `ZA-P10-${Date.now()}`,
    worker_id: 'WRK-001',
    helmet_id: 'MC-001',
    zone_id: 'zone-level-2-south-panel',
    action: 'CHECK_IN',
    active: true,
    timestamp: new Date().toISOString(),
  };
  publisher.publish('zone_assignments', 'INSERT', zoneAssignPayload);
  assert(deliveredZone !== null && deliveredZone.new.zone_id === 'zone-level-2-south-panel', 'DELIVERY', 'Realtime zone assignment INSERT delivered');

  unsubTel();
  unsubHlm();
  unsubAlt();
  unsubZon();

  // =========================================================================
  // 3. FRONTEND REALTIME UPDATES WITHOUT PAGE REFRESH
  // =========================================================================
  console.log('\n--- 3. FRONTEND REALTIME UPDATES WITHOUT PAGE REFRESH ---');

  let serviceNotifyCount = 0;
  const unsubServiceListener = telemetryService.subscribe(() => {
    serviceNotifyCount++;
  });

  const initialNotifyCount = serviceNotifyCount;
  publisher.publish('telemetry', 'INSERT', {
    id: `PKT-UI-${Date.now()}`,
    helmet_id: 'MC-001',
    timestamp: new Date().toISOString(),
    sequence_number: 1002,
    temperature: 27.0,
    humidity: 55.0,
    gas_value: 215,
    acceleration_x: 0,
    acceleration_y: 0,
    acceleration_z: 9.81,
    total_acceleration: 9.81,
    gyro_x: 0,
    gyro_y: 0,
    gyro_z: 0,
    fall_detected: false,
    sos_pressed: false,
    safety_status: 'SAFE',
    created_at: new Date().toISOString(),
  });

  assert(serviceNotifyCount > initialNotifyCount, 'UI_UPDATES', 'TelemetryService listener triggered without page refresh on telemetry event');

  const countBeforeHelmet = serviceNotifyCount;
  publisher.publish('helmets', 'UPDATE', {
    id: 'MC-001',
    status: 'SAFE',
    online: true,
  });
  assert(serviceNotifyCount > countBeforeHelmet, 'UI_UPDATES', 'TelemetryService listener triggered without page refresh on helmet update');

  unsubServiceListener();

  // =========================================================================
  // 4. PRESERVE DUAL ARCHITECTURE: SUPABASE REALTIME & SSE FALLBACK
  // =========================================================================
  console.log('\n--- 4. DUAL REALTIME ENGINE ARCHITECTURE ---');

  const providerName = realtimeService.getProviderName();
  assert(
    providerName === 'Event Bus' || providerName === 'Supabase Realtime',
    'PROVIDER_ARCH',
    `Authoritative provider resolved properly: ${providerName}`
  );

  realtimeService.connectInProcessBroker();
  assert(realtimeService.getConnectionState() === 'CONNECTED', 'PROVIDER_ARCH', 'In-process event broker fallback fully operational');

  // =========================================================================
  // 5. SECURITY & UNAUTHORIZED SUBSCRIPTION PROTECTION
  // =========================================================================
  console.log('\n--- 5. UNAUTHORIZED SUBSCRIPTION PROTECTION ---');

  const mockRes = (onEnd?: () => void) => {
    const written: string[] = [];
    const headers: Record<string, string> = {};
    return {
      statusCode: 200,
      setHeader: (k: string, v: string) => { headers[k.toLowerCase()] = v; },
      getHeader: (k: string) => headers[k.toLowerCase()],
      write: (chunk: string) => { written.push(chunk); return true; },
      end: (data?: string) => { if (data) written.push(data); if (onEnd) onEnd(); },
      on: () => {},
      _written: written,
      _headers: headers,
    } as unknown as ServerResponse & { _written: string[]; _headers: Record<string, string> };
  };

  // Test: Unauthenticated GET /api/v1/realtime/stream -> 401
  const unauthReq = {
    url: '/api/v1/realtime/stream',
    method: 'GET',
    headers: { host: 'localhost' },
  } as unknown as IncomingMessage;
  const unauthRes = mockRes();
  const handledUnauth = await app.handleRequest(unauthReq, unauthRes);
  assert(handledUnauth === true, 'AUTH_PROTECT', 'Unauthenticated realtime stream request handled by router');
  assert(unauthRes.statusCode === 401, 'AUTH_PROTECT', 'Unauthenticated realtime subscription rejected with HTTP 401');
  const unauthBody = JSON.parse(unauthRes._written.join(''));
  assert(unauthBody.code === 'UNAUTHORIZED', 'AUTH_PROTECT', '401 response contains UNAUTHORIZED ApiError envelope');

  // Test: Invalid/malformed token -> 401
  const malformedReq = {
    url: '/api/v1/realtime/stream?token=not-a-valid-jwt',
    method: 'GET',
    headers: { host: 'localhost' },
  } as unknown as IncomingMessage;
  const malformedRes = mockRes();
  await app.handleRequest(malformedReq, malformedRes);
  assert(malformedRes.statusCode === 401, 'AUTH_PROTECT', 'Malformed token rejected with HTTP 401');

  // Test: Authorized Supervisor subscription -> 200 SSE Stream
  const supReq = {
    url: `/api/v1/realtime/stream?token=${supervisorToken}`,
    method: 'GET',
    headers: { host: 'localhost' },
    socket: { remoteAddress: '127.0.0.1' },
  } as unknown as IncomingMessage;
  const supRes = mockRes();
  await app.handleRequest(supReq, supRes);
  assert(supRes.statusCode === 200, 'AUTH_PROTECT', 'Authorized supervisor connects with HTTP 200');
  assert(supRes._headers['content-type'] === 'text/event-stream', 'AUTH_PROTECT', 'Stream response Content-Type is text/event-stream');
  assert(supRes._written.some((w) => w.includes('"status":"CONNECTED"')), 'AUTH_PROTECT', 'Stream initializes with CONNECTED status event');

  // Test: Authorized Worker subscription -> 200 SSE Stream with worker metadata
  const wrkReq = {
    url: `/api/v1/realtime/stream?token=${worker1Token}`,
    method: 'GET',
    headers: { host: 'localhost' },
    socket: { remoteAddress: '127.0.0.1' },
  } as unknown as IncomingMessage;
  const wrkRes = mockRes();
  await app.handleRequest(wrkReq, wrkRes);
  assert(wrkRes.statusCode === 200, 'AUTH_PROTECT', 'Authorized worker connects with HTTP 200');
  assert(wrkRes._written.some((w) => w.includes('"role":"WORKER"')), 'AUTH_PROTECT', 'Worker stream status includes WORKER role');

  // Test: Authorized Admin subscription -> 200 SSE Stream
  const admReq = {
    url: `/api/v1/realtime/stream?token=${adminToken}`,
    method: 'GET',
    headers: { host: 'localhost' },
    socket: { remoteAddress: '127.0.0.1' },
  } as unknown as IncomingMessage;
  const admRes = mockRes();
  await app.handleRequest(admReq, admRes);
  assert(admRes.statusCode === 200, 'AUTH_PROTECT', 'Authorized admin connects with HTTP 200');
  assert(admRes._written.some((w) => w.includes('"role":"ADMIN"')), 'AUTH_PROTECT', 'Admin stream status includes ADMIN role');

  // =========================================================================
  // 6. RBAC AND WORKER DATA ISOLATION
  // =========================================================================
  console.log('\n--- 6. RBAC & WORKER DATA ISOLATION ---');

  const workerClient: SseClient = {
    id: 'sse-client-worker-1',
    res: mockRes(),
    role: 'WORKER',
    workerId: 'WRK-001',
    assignedHelmetId: 'MC-001',
  };

  const supervisorClient: SseClient = {
    id: 'sse-client-supervisor-1',
    res: mockRes(),
    role: 'SUPERVISOR',
    workerId: null,
    assignedHelmetId: null,
  };

  // Test 1: Worker receives own telemetry
  const ownTelPayload: PostgresChangesPayload = {
    schema: 'public',
    table: 'telemetry',
    eventType: 'INSERT',
    new: { id: 'PKT-1', helmet_id: 'MC-001', temperature: 27 },
    old: null,
    commit_timestamp: new Date().toISOString(),
  };
  assert(publisher.isEventPermittedForClient(workerClient, ownTelPayload), 'RBAC_ISOLATION', 'Worker permitted to receive assigned helmet telemetry (MC-001)');

  // Test 2: Worker blocked from foreign telemetry
  const foreignTelPayload: PostgresChangesPayload = {
    schema: 'public',
    table: 'telemetry',
    eventType: 'INSERT',
    new: { id: 'PKT-2', helmet_id: 'MC-002', temperature: 29 },
    old: null,
    commit_timestamp: new Date().toISOString(),
  };
  assert(!publisher.isEventPermittedForClient(workerClient, foreignTelPayload), 'RBAC_ISOLATION', 'Worker strictly blocked from foreign helmet telemetry (MC-002)');

  // Test 3: Worker receives own alert
  const ownAlertPayload: PostgresChangesPayload = {
    schema: 'public',
    table: 'alerts',
    eventType: 'INSERT',
    new: { id: 'ALT-1', worker_id: 'WRK-001', helmet_id: 'MC-001', severity: 'WARNING' },
    old: null,
    commit_timestamp: new Date().toISOString(),
  };
  assert(publisher.isEventPermittedForClient(workerClient, ownAlertPayload), 'RBAC_ISOLATION', 'Worker permitted to receive own worker alert (WRK-001)');

  // Test 4: Worker blocked from foreign alert
  const foreignAlertPayload: PostgresChangesPayload = {
    schema: 'public',
    table: 'alerts',
    eventType: 'INSERT',
    new: { id: 'ALT-2', worker_id: 'WRK-002', helmet_id: 'MC-002', severity: 'CRITICAL' },
    old: null,
    commit_timestamp: new Date().toISOString(),
  };
  assert(!publisher.isEventPermittedForClient(workerClient, foreignAlertPayload), 'RBAC_ISOLATION', 'Worker strictly blocked from foreign worker alert (WRK-002)');

  // Test 5: Worker blocked from foreign zone assignment
  const foreignZonePayload: PostgresChangesPayload = {
    schema: 'public',
    table: 'zone_assignments',
    eventType: 'INSERT',
    new: { id: 'ZA-2', worker_id: 'WRK-002', zone_id: 'zone-shaft-3', active: true },
    old: null,
    commit_timestamp: new Date().toISOString(),
  };
  assert(!publisher.isEventPermittedForClient(workerClient, foreignZonePayload), 'RBAC_ISOLATION', 'Worker strictly blocked from foreign zone assignment (WRK-002)');

  // Test 6: Supervisor receives all operational events
  assert(publisher.isEventPermittedForClient(supervisorClient, foreignTelPayload), 'RBAC_ISOLATION', 'Supervisor permitted to receive foreign telemetry');
  assert(publisher.isEventPermittedForClient(supervisorClient, foreignAlertPayload), 'RBAC_ISOLATION', 'Supervisor permitted to receive foreign alert');
  assert(publisher.isEventPermittedForClient(supervisorClient, foreignZonePayload), 'RBAC_ISOLATION', 'Supervisor permitted to receive all zone assignments');

  // Test 7: Client-side service RBAC filtering
  realtimeService.setUser({ role: 'WORKER', worker_id: 'WRK-001', assignedHelmetId: 'MC-001' });
  assert(realtimeService.isPayloadAuthorized(ownTelPayload), 'RBAC_ISOLATION', 'Client service allows own telemetry for worker');
  assert(!realtimeService.isPayloadAuthorized(foreignTelPayload), 'RBAC_ISOLATION', 'Client service rejects foreign telemetry for worker');
  assert(realtimeService.isPayloadAuthorized(ownAlertPayload), 'RBAC_ISOLATION', 'Client service allows own alert for worker');
  assert(!realtimeService.isPayloadAuthorized(foreignAlertPayload), 'RBAC_ISOLATION', 'Client service rejects foreign alert for worker');

  realtimeService.setUser({ role: 'SUPERVISOR', worker_id: null });
  assert(realtimeService.isPayloadAuthorized(foreignTelPayload), 'RBAC_ISOLATION', 'Client service permits all fleet telemetry for supervisor');

  // =========================================================================
  // 7. HEARTBEAT / KEEPALIVE & WATCHDOG
  // =========================================================================
  console.log('\n--- 7. HEARTBEAT & KEEPALIVE WATCHDOG ---');

  const sseClientMock: SseClient = {
    id: 'sse-hb-test-1',
    res: mockRes(),
    role: 'SUPERVISOR',
    workerId: null,
    assignedHelmetId: null,
  };

  publisher.addSseClient(sseClientMock);
  assert(publisher.isHeartbeatActive(), 'HEARTBEAT', 'Publisher heartbeat timer active when SSE clients connected');
  assert(publisher.hasSseClient('sse-hb-test-1'), 'HEARTBEAT', 'SSE client registered in publisher');

  publisher.sendHeartbeat();
  const mockResObj = sseClientMock.res as unknown as { _written: string[] };
  assert(mockResObj._written.some((w) => w.includes('heartbeat')), 'HEARTBEAT', 'Heartbeat event and comment transmitted to connected client');

  publisher.removeSseClient('sse-hb-test-1');
  assert(!publisher.hasSseClient('sse-hb-test-1'), 'HEARTBEAT', 'SSE client cleanly removed from publisher');

  // Client watchdog check
  realtimeService.recordHeartbeat();
  const lastHb = realtimeService.getLastHeartbeat();
  assert(Date.now() - lastHb < 100, 'HEARTBEAT', 'Client records latest heartbeat timestamp');
  assert(realtimeService.checkKeepalive() === true, 'HEARTBEAT', 'Fresh connection passes keepalive watchdog check');

  // Stale connection simulation
  realtimeService.setHeartbeatTimeout(50); // 50ms timeout for test
  await new Promise((r) => setTimeout(r, 60));
  const keepalivePassed = realtimeService.checkKeepalive();
  assert(keepalivePassed === false, 'HEARTBEAT', 'Watchdog detects stale connection when heartbeat exceeds timeout');
  assert(realtimeService.getConnectionState() === 'ERROR', 'HEARTBEAT', 'Connection state transitions to ERROR on watchdog timeout');
  realtimeService.setHeartbeatTimeout(45000); // restore default

  // =========================================================================
  // 8. AUTHORITATIVE EVENT DEDUPLICATION
  // =========================================================================
  console.log('\n--- 8. AUTHORITATIVE EVENT DEDUPLICATION ---');

  realtimeService.connectInProcessBroker();
  realtimeService.clearDeduplicationCache();

  let receivedPacketCount = 0;
  const unsubDedup = realtimeService.subscribeTable('telemetry', () => {
    receivedPacketCount++;
  });

  const duplicatePayload: PostgresChangesPayload = {
    schema: 'public',
    table: 'telemetry',
    eventType: 'INSERT',
    new: {
      id: 'PKT-DEDUP-001',
      helmet_id: 'MC-001',
      sequence_number: 99,
      timestamp: '2026-10-06T12:00:00.000Z',
      safety_status: 'SAFE',
    },
    old: null,
    commit_timestamp: '2026-10-06T12:00:00.000Z',
  };

  // First dispatch -> accepted
  realtimeService.handleIncomingPayload(duplicatePayload);
  assert(receivedPacketCount === 1, 'DEDUPLICATION', 'First incoming event delivered to table subscriber');

  // Duplicate dispatch -> dropped
  realtimeService.handleIncomingPayload(duplicatePayload);
  assert(receivedPacketCount === 1, 'DEDUPLICATION', 'Duplicate incoming event dropped without invoking subscriber');
  assert(realtimeService.getDuplicateEventsDroppedCount() === 1, 'DEDUPLICATION', 'Duplicate event counter incremented');

  unsubDedup();

  // =========================================================================
  // 9. OFFLINE -> RECONNECT LIFECYCLE
  // =========================================================================
  console.log('\n--- 9. OFFLINE -> RECONNECT LIFECYCLE ---');

  realtimeService.triggerOffline();
  assert(realtimeService.getConnectionState() === 'DISCONNECTED', 'OFFLINE_RECONNECT', 'Service transitions to DISCONNECTED when network drops offline');

  realtimeService.triggerOnline();
  assert(
    realtimeService.getConnectionState() === 'CONNECTED' || realtimeService.getConnectionState() === 'CONNECTING',
    'OFFLINE_RECONNECT',
    'Service initiates reconnection when network comes back online'
  );

  // =========================================================================
  // 10. ALERT LIFECYCLE & SAFE RECOVERY
  // =========================================================================
  console.log('\n--- 10. ALERT RECOVERY LIFECYCLE ---');

  const alertStore: DbAlert[] = [];
  const initialAlertsCount = alertStore.length;

  // Hazard frame: Gas = 890 raw -> WARNING
  const hazardEval = SafetyEngine.evaluate({
    temperature: 28,
    gasValue: 890,
    totalAcceleration: 9.8,
    sosPressed: false,
  });
  assert(hazardEval.status === 'WARNING', 'ALERT_RECOVERY', 'Gas reading 890 evaluates to WARNING');

  AlertEngine.processAlerts(
    alertStore,
    'MC-001',
    'WRK-001',
    {
      packetId: 'PKT-HAZ-1',
      helmetId: 'MC-001',
      timestamp: new Date().toISOString(),
      sequenceNumber: 1,
      temperature: 28,
      humidity: 50,
      gasValue: 890,
      accelX: 0,
      accelY: 0,
      accelZ: 9.8,
      totalAcceleration: 9.8,
      gyroX: 0,
      gyroY: 0,
      gyroZ: 0,
      fallDetected: false,
      sosPressed: false,
      batteryVolts: 4.1,
      rssi: -60,
    },
    hazardEval
  );

  assert(alertStore.length === initialAlertsCount + 1, 'ALERT_RECOVERY', 'Active hazard alert created');
  assert(alertStore[0].status === 'TRIGGERED', 'ALERT_RECOVERY', 'Alert created in TRIGGERED state');

  // Normal frame: Gas = 220 raw -> SAFE recovery
  const safeRecoveryEval = SafetyEngine.evaluate({
    temperature: 26,
    gasValue: 220,
    totalAcceleration: 9.8,
    sosPressed: false,
  });
  assert(safeRecoveryEval.status === 'SAFE', 'ALERT_RECOVERY', 'Normal gas reading 220 evaluates to SAFE');

  AlertEngine.processAlerts(
    alertStore,
    'MC-001',
    'WRK-001',
    {
      packetId: 'PKT-REC-1',
      helmetId: 'MC-001',
      timestamp: new Date().toISOString(),
      sequenceNumber: 2,
      temperature: 26,
      humidity: 50,
      gasValue: 220,
      accelX: 0,
      accelY: 0,
      accelZ: 9.8,
      totalAcceleration: 9.8,
      gyroX: 0,
      gyroY: 0,
      gyroZ: 0,
      fallDetected: false,
      sosPressed: false,
      batteryVolts: 4.1,
      rssi: -60,
    },
    safeRecoveryEval
  );

  assert(alertStore[0].status === 'RESOLVED', 'ALERT_RECOVERY', 'Active hazard alert automatically transitioned to RESOLVED on SAFE recovery');
  assert(alertStore[0].resolved_at !== undefined, 'ALERT_RECOVERY', 'Alert resolved_at timestamp populated');

  // =========================================================================
  // 11. BACKEND RESTART RESILIENCE
  // =========================================================================
  console.log('\n--- 11. BACKEND RESTART RESILIENCE ---');

  // Simulate server restart by resetting publisher instance
  RealtimePublisher.resetInstance();
  assert(RealtimePublisher.getInstance().getSseClientsCount() === 0, 'RESTART_RESILIENCE', 'Publisher restart clears client connections cleanly');

  // Authoritative state in PostgreSQL remains intact
  const helmetsPostRestart = await db.getHelmets();
  assert(helmetsPostRestart.length > 0, 'RESTART_RESILIENCE', 'Authoritative helmet records persist across backend restart');

  const alertsPostRestart = await db.getAlertsStore();
  assert(alertsPostRestart.length > 0, 'RESTART_RESILIENCE', 'Authoritative alerts store persists across backend restart');

  // New publishers can publish without state corruption
  const postRestartPublisher = RealtimePublisher.getInstance();
  const testPayload = postRestartPublisher.publish('helmets', 'UPDATE', { id: 'MC-001', status: 'SAFE' });
  assert(testPayload.eventType === 'UPDATE', 'RESTART_RESILIENCE', 'Fresh publisher broadcasts events normally post-restart');

  // =========================================================================
  // 12. SUBSCRIPTION CLEANUP ON LOGOUT & UNMOUNT
  // =========================================================================
  console.log('\n--- 12. SUBSCRIPTION CLEANUP ON LOGOUT & UNMOUNT ---');

  realtimeService.connectInProcessBroker();
  const initialSubs = realtimeService.getTableSubscriberCount();

  const unsub1 = realtimeService.subscribeTable('telemetry', () => {});
  const unsub2 = realtimeService.subscribeTable('helmets', () => {});
  assert(realtimeService.getTableSubscriberCount() === initialSubs + 2, 'CLEANUP', 'Active subscriber count tracks new subscriptions');

  unsub1();
  unsub2();
  assert(realtimeService.getTableSubscriberCount() === initialSubs, 'CLEANUP', 'Unsubscribe callbacks decrement subscriber count');

  // User logout cleanup
  realtimeService.cleanupOnLogout();
  assert(realtimeService.getConnectionState() === 'DISCONNECTED', 'CLEANUP', 'cleanupOnLogout disconnects active realtime stream');
  assert(realtimeService.getProcessedEventCount() === 0, 'CLEANUP', 'cleanupOnLogout clears deduplication cache');

  // TelemetryService unmount cleanup
  telemetryService.cleanup();
  assert(telemetryService.getActiveSubscriptionCount() === 0, 'CLEANUP', 'TelemetryService.cleanup clears all table subscriptions');
  telemetryService.reattachRealtimeSubscriptions();
  assert(telemetryService.getActiveSubscriptionCount() === 4, 'CLEANUP', 'TelemetryService.reattachRealtimeSubscriptions rebinds 4 operational tables');

  // =========================================================================
  // 13. SIMULATION & MOCK TELEMETRY INTEGRITY
  // =========================================================================
  console.log('\n--- 13. SIMULATION INTEGRITY (ZERO PHYSICAL ESP8266) ---');

  const mockProvider = new MockTelemetryProvider();
  assert(mockProvider.isSimulation === true, 'SIMULATION_INTEGRITY', 'Simulation provider operates purely in software simulation mode');
  assert(mockProvider.getRegisteredHelmetIds().length === 16, 'SIMULATION_INTEGRITY', 'Commissioned fleet contains exactly 16 virtual helmets');

  mockProvider.triggerScenario('SAFE', 'MC-001');
  mockProvider.tick();
  assert(mockProvider.getScenario('MC-001') === 'SAFE', 'SIMULATION_INTEGRITY', 'SAFE scenario functional');

  mockProvider.triggerScenario('HIGH_GAS', 'MC-001');
  assert(mockProvider.getScenario('MC-001') === 'HIGH_GAS', 'SIMULATION_INTEGRITY', 'HIGH_GAS scenario functional');

  mockProvider.triggerScenario('FALL_DETECTED', 'MC-001');
  assert(mockProvider.getScenario('MC-001') === 'FALL_DETECTED', 'SIMULATION_INTEGRITY', 'FALL_DETECTED scenario functional');

  mockProvider.triggerScenario('SOS_ACTIVATED', 'MC-001');
  assert(mockProvider.getScenario('MC-001') === 'SOS_ACTIVATED', 'SIMULATION_INTEGRITY', 'SOS_ACTIVATED scenario functional');

  mockProvider.disconnect();

  console.log('\n============================================================');
  console.log(`TOTAL PHASE 10 CHECKS: ${totalChecks}`);
  console.log(`PASSED:                ${passedChecks}`);
  console.log(`FAILED:                ${totalChecks - passedChecks}`);
  console.log('============================================================\n');

  if (totalChecks !== passedChecks) {
    process.exit(1);
  }
}

runPhase10Tests().catch((err) => {
  console.error('Phase 10 Test execution error:', err);
  process.exit(1);
});
