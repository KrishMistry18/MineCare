/**
 * MineCare - Phase 5 Comprehensive Test Suite
 * Analytics, Historical Intelligence, Time Range Validation, Aggregations, & RBAC
 */

import { DatabaseRepository } from '../src/backend/db/DatabaseRepository';
import { AnalyticsEngine } from '../src/backend/analytics/AnalyticsEngine';
import { BackendApp } from '../src/backend/app';
import { Socket } from 'net';
import { IncomingMessage, ServerResponse } from 'http';

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

function mockApi(
  pathname: string,
  method: string = 'GET',
  bodyData?: unknown,
  token?: string
): Promise<{ status: number; data: any }> {
  return new Promise((resolve) => {
    const socket = new Socket();
    const req = new IncomingMessage(socket);
    req.url = pathname;
    req.method = method;
    req.headers = {
      host: 'localhost:5173',
      'content-type': 'application/json',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    };

    const res = new ServerResponse(req);
    let responseBody = '';

    res.end = function (chunk?: any) {
      if (chunk) responseBody += chunk.toString();
      let parsed = responseBody;
      try {
        parsed = JSON.parse(responseBody);
      } catch {}
      resolve({ status: res.statusCode, data: parsed });
      return this;
    } as any;

    if (bodyData) {
      req.push(JSON.stringify(bodyData));
      req.push(null);
    } else {
      req.push(null);
    }

    const app = BackendApp.getInstance();
    app.handleRequest(req, res);
  });
}

async function runPhase5Tests() {
  console.log('\n============================================================');
  console.log('MINECARE PHASE 5 - ANALYTICS & HISTORICAL INTELLIGENCE TESTS');
  console.log('============================================================');

  const db = DatabaseRepository.getInstance();

  const now = Date.now();
  const nowIso = new Date(now).toISOString();

  // =========================================================================
  // 1. TIME RANGE VALIDATION (1h, 6h, 24h, 7d, 30d, Invalid)
  // =========================================================================
  console.log('\n--- 1. TIME RANGE VALIDATION ---');

  // Default (24 hours)
  const defaultRange = AnalyticsEngine.validateTimeRange(null, null);
  assert(defaultRange.valid, 'TIME_RANGE', 'Default time range is valid');
  assert(defaultRange.durationMs === 24 * 60 * 60 * 1000, 'TIME_RANGE', 'Default duration is exactly 24 hours');

  // Explicit 1 Hour range
  const r1h = AnalyticsEngine.validateTimeRange(
    new Date(now - 1 * 3600 * 1000).toISOString(),
    nowIso
  );
  assert(r1h.valid, 'TIME_RANGE', '1 hour range is valid');
  assert(r1h.durationMs === 1 * 3600 * 1000, 'TIME_RANGE', '1 hour duration matches 3,600,000 ms');

  // Explicit 6 Hours range
  const r6h = AnalyticsEngine.validateTimeRange(
    new Date(now - 6 * 3600 * 1000).toISOString(),
    nowIso
  );
  assert(r6h.valid, 'TIME_RANGE', '6 hours range is valid');
  assert(r6h.durationMs === 6 * 3600 * 1000, 'TIME_RANGE', '6 hours duration matches 21,600,000 ms');

  // Explicit 7 Days range
  const r7d = AnalyticsEngine.validateTimeRange(
    new Date(now - 7 * 24 * 3600 * 1000).toISOString(),
    nowIso
  );
  assert(r7d.valid, 'TIME_RANGE', '7 days range is valid');

  // Explicit 30 Days range
  const r30d = AnalyticsEngine.validateTimeRange(
    new Date(now - 30 * 24 * 3600 * 1000).toISOString(),
    nowIso
  );
  assert(r30d.valid, 'TIME_RANGE', '30 days range is valid');

  // Invalid: missing one parameter
  const rPartial = AnalyticsEngine.validateTimeRange(nowIso, null);
  assert(!rPartial.valid, 'TIME_RANGE', 'Partial time range rejected');

  // Invalid: malformed date string
  const rMalformed = AnalyticsEngine.validateTimeRange('not-a-date', nowIso);
  assert(!rMalformed.valid, 'TIME_RANGE', 'Malformed date string rejected');

  // Invalid: from > to (reversed range)
  const rReversed = AnalyticsEngine.validateTimeRange(
    nowIso,
    new Date(now - 3600 * 1000).toISOString()
  );
  assert(!rReversed.valid, 'TIME_RANGE', 'Reversed range (from > to) rejected');

  // Invalid: span exceeds 31 days
  const rTooLong = AnalyticsEngine.validateTimeRange(
    new Date(now - 45 * 24 * 3600 * 1000).toISOString(),
    nowIso
  );
  assert(!rTooLong.valid, 'TIME_RANGE', 'Range exceeding 31 days rejected');

  // Invalid: future to timestamp
  const rFuture = AnalyticsEngine.validateTimeRange(
    nowIso,
    new Date(now + 24 * 3600 * 1000).toISOString()
  );
  assert(!rFuture.valid, 'TIME_RANGE', 'Future timestamp rejected');

  // =========================================================================
  // 2. TELEMETRY AGGREGATION & SENSOR METRICS
  // =========================================================================
  console.log('\n--- 2. TELEMETRY AGGREGATION & SENSOR METRICS ---');

  // Empty dataset handling
  const emptyRes = AnalyticsEngine.computeTelemetryAnalytics([], now - 3600 * 1000, now);
  assert(!emptyRes.hasData, 'TELEMETRY', 'Empty dataset returns hasData: false');
  assert(emptyRes.packetCount === 0, 'TELEMETRY', 'Empty dataset has 0 packets');
  assert(emptyRes.metrics === null, 'TELEMETRY', 'Empty dataset returns null metrics (no fake zeroes)');
  assert(emptyRes.message === 'No telemetry recorded for this period.', 'TELEMETRY', 'Empty dataset provides clear message');

  // Seed sample deterministic telemetry packets for MC-001
  const samplePackets: DbTelemetry[] = [
    {
      id: 'PKT-HIST-01',
      helmet_id: 'MC-001',
      timestamp: new Date(now - 30 * 60 * 1000).toISOString(),
      sequence_number: 1,
      temperature: 24.0,
      humidity: 50.0,
      gas_value: 200,
      acceleration_x: 0.1,
      acceleration_y: 0.2,
      acceleration_z: 9.8,
      total_acceleration: 9.8,
      gyro_x: 0.1,
      gyro_y: 0.2,
      gyro_z: 0.1,
      fall_detected: false,
      sos_pressed: false,
      safety_status: 'SAFE',
      created_at: nowIso,
    },
    {
      id: 'PKT-HIST-02',
      helmet_id: 'MC-001',
      timestamp: new Date(now - 20 * 60 * 1000).toISOString(),
      sequence_number: 2,
      temperature: 42.0, // High temperature Warning (>40°C)
      humidity: 60.0,
      gas_value: 850, // High gas Warning (>800 ADC)
      acceleration_x: 0.2,
      acceleration_y: 0.3,
      acceleration_z: 9.7,
      total_acceleration: 9.7,
      gyro_x: 0.2,
      gyro_y: 0.1,
      gyro_z: 0.2,
      fall_detected: false,
      sos_pressed: false,
      safety_status: 'WARNING',
      created_at: nowIso,
    },
    {
      id: 'PKT-HIST-03',
      helmet_id: 'MC-001',
      timestamp: new Date(now - 10 * 60 * 1000).toISOString(),
      sequence_number: 3,
      temperature: 30.0,
      humidity: 55.0,
      gas_value: 300,
      acceleration_x: 2.1,
      acceleration_y: 3.4,
      acceleration_z: 16.5,
      total_acceleration: 17.0, // Fall impact Danger (>15 m/s²)
      gyro_x: 1.0,
      gyro_y: -0.5,
      gyro_z: 0.8,
      fall_detected: true,
      sos_pressed: false,
      safety_status: 'DANGER',
      created_at: nowIso,
    },
  ];

  samplePackets.forEach((p) => db.saveTelemetry(p));

  const telemetryAnalytics = AnalyticsEngine.computeTelemetryAnalytics(
    samplePackets,
    now - 3600 * 1000,
    now
  );

  assert(telemetryAnalytics.hasData, 'TELEMETRY', 'Populated dataset returns hasData: true');
  assert(telemetryAnalytics.packetCount === 3, 'TELEMETRY', 'Packet count is 3');

  // Temperature (24.0, 42.0, 30.0) -> min 24, max 42, avg 32, latest 30
  assert(telemetryAnalytics.metrics?.temperature.min === 24.0, 'TELEMETRY', 'Min temperature is 24.0°C');
  assert(telemetryAnalytics.metrics?.temperature.max === 42.0, 'TELEMETRY', 'Max temperature is 42.0°C');
  assert(telemetryAnalytics.metrics?.temperature.avg === 32.0, 'TELEMETRY', 'Avg temperature is 32.0°C');
  assert(telemetryAnalytics.metrics?.temperature.latest === 30.0, 'TELEMETRY', 'Latest temperature is 30.0°C');

  // Humidity (50.0, 60.0, 55.0) -> min 50, max 60, avg 55, latest 55
  assert(telemetryAnalytics.metrics?.humidity.min === 50.0, 'TELEMETRY', 'Min humidity is 50.0%');
  assert(telemetryAnalytics.metrics?.humidity.max === 60.0, 'TELEMETRY', 'Max humidity is 60.0%');
  assert(telemetryAnalytics.metrics?.humidity.avg === 55.0, 'TELEMETRY', 'Avg humidity is 55.0%');

  // Gas (200, 850, 300) -> min 200, max 850, avg 450, latest 300 (RAW ADC)
  assert(telemetryAnalytics.metrics?.gas.min === 200, 'TELEMETRY', 'Min gas is 200 ADC');
  assert(telemetryAnalytics.metrics?.gas.max === 850, 'TELEMETRY', 'Max gas is 850 ADC');
  assert(telemetryAnalytics.metrics?.gas.avg === 450, 'TELEMETRY', 'Avg gas is 450 ADC');
  assert(telemetryAnalytics.metrics?.gas.unit === 'ADC (0-1023 RAW)', 'TELEMETRY', 'Gas unit preserves raw ADC');

  // Motion & Fall (9.8, 9.7, 17.0) -> max 17.0
  assert(telemetryAnalytics.metrics?.acceleration.max === 17.0, 'TELEMETRY', 'Peak acceleration is 17.0 m/s²');
  assert(telemetryAnalytics.metrics?.acceleration.threshold === 15.0, 'TELEMETRY', 'Fall threshold remains 15.0 m/s²');

  // Safety breakdown (1 SAFE, 1 WARNING, 1 DANGER)
  assert(telemetryAnalytics.safetyBreakdown?.safePackets === 1, 'SAFETY', 'Safe packets count is 1');
  assert(telemetryAnalytics.safetyBreakdown?.warningPackets === 1, 'SAFETY', 'Warning packets count is 1');
  assert(telemetryAnalytics.safetyBreakdown?.dangerPackets === 1, 'SAFETY', 'Danger packets count is 1');
  assert(telemetryAnalytics.safetyBreakdown?.safePercentage === 33.3, 'SAFETY', 'Safe percentage is 33.3%');

  // Downsampling trend points generated
  assert(telemetryAnalytics.trend.length === 3, 'TELEMETRY', 'Trend points preserved without data loss for <= 100 samples');

  // =========================================================================
  // 3. ALERT ANALYTICS & TIMELINE
  // =========================================================================
  console.log('\n--- 3. ALERT ANALYTICS & TIMELINE ---');

  const sampleAlerts: DbAlert[] = [
    {
      id: 'ALT-HIST-01',
      helmet_id: 'MC-001',
      worker_id: 'WRK-001',
      type: 'GAS_HAZARD',
      severity: 'WARNING',
      message: 'Raw gas reading exceeded 800 ADC',
      status: 'RESOLVED',
      triggered_at: new Date(now - 50 * 60 * 1000).toISOString(),
      resolved_at: new Date(now - 40 * 60 * 1000).toISOString(),
      created_at: nowIso,
      updated_at: nowIso,
    },
    {
      id: 'ALT-HIST-02',
      helmet_id: 'MC-001',
      worker_id: 'WRK-001',
      type: 'WORKER_FALL',
      severity: 'CRITICAL',
      message: 'Impact acceleration spike detected',
      status: 'ACKNOWLEDGED',
      triggered_at: new Date(now - 25 * 60 * 1000).toISOString(),
      acknowledged_at: new Date(now - 20 * 60 * 1000).toISOString(),
      created_at: nowIso,
      updated_at: nowIso,
    },
    {
      id: 'ALT-HIST-03',
      helmet_id: 'MC-002',
      worker_id: 'WRK-002',
      type: 'HELMET_OFFLINE',
      severity: 'WARNING',
      message: 'Helmet heartbeat lost >8s',
      status: 'TRIGGERED',
      triggered_at: new Date(now - 10 * 60 * 1000).toISOString(),
      created_at: nowIso,
      updated_at: nowIso,
    },
  ];

  const alertAnalytics = AnalyticsEngine.computeAlertAnalytics(
    sampleAlerts,
    now - 3600 * 1000,
    now
  );

  assert(alertAnalytics.totalAlerts === 3, 'ALERTS', 'Total alerts count is 3');
  assert(alertAnalytics.activeAlerts === 1, 'ALERTS', 'Active alerts count is 1 (TRIGGERED)');
  assert(alertAnalytics.acknowledgedAlerts === 1, 'ALERTS', 'Acknowledged alerts count is 1');
  assert(alertAnalytics.resolvedAlerts === 1, 'ALERTS', 'Resolved alerts count is 1');

  assert(alertAnalytics.byType['GAS_HAZARD'] === 1, 'ALERTS', 'GAS_HAZARD count is 1');
  assert(alertAnalytics.byType['WORKER_FALL'] === 1, 'ALERTS', 'WORKER_FALL count is 1');
  assert(alertAnalytics.byType['HELMET_OFFLINE'] === 1, 'ALERTS', 'HELMET_OFFLINE count is 1');

  assert(alertAnalytics.bySeverity['CRITICAL'] === 1, 'ALERTS', 'CRITICAL severity count is 1');
  assert(alertAnalytics.bySeverity['WARNING'] === 2, 'ALERTS', 'WARNING severity count is 2');

  assert(alertAnalytics.timeline.length === 3, 'ALERTS', 'Timeline returns 3 incidents');
  assert(alertAnalytics.timeBuckets.length === 12, 'ALERTS', 'Time distribution has 12 discrete buckets');

  // =========================================================================
  // 4. ZONE OCCUPANCY & ACTIVITY HISTORY
  // =========================================================================
  console.log('\n--- 4. ZONE OCCUPANCY & ACTIVITY HISTORY ---');

  const zones = db.getZones();
  const assignments = db.getZoneAssignmentsHistory();
  const zoneAnalytics = AnalyticsEngine.computeZoneAnalytics(
    zones,
    assignments,
    sampleAlerts,
    db.getWorkers(),
    now - 24 * 3600 * 1000,
    now
  );

  assert(zoneAnalytics.length === 4, 'ZONES', 'Zone analytics includes all 4 zones');
  const northDrift = zoneAnalytics.find((z) => z.zoneName.includes('North Drift'));
  assert(northDrift !== undefined, 'ZONES', 'Level 1 - North Drift zone present');
  assert(northDrift!.uniqueWorkerCount >= 1, 'ZONES', 'North drift has tracked workers');
  assert(northDrift!.checkInCount >= 1, 'ZONES', 'North drift tracks check-in events');

  // =========================================================================
  // 5. CONNECTIVITY & UPTIME REPORTING (Non-Fabricated)
  // =========================================================================
  console.log('\n--- 5. CONNECTIVITY & UPTIME REPORTING ---');

  const connectivity = AnalyticsEngine.computeConnectivityAnalytics(
    db.getRawHelmets(),
    sampleAlerts,
    db.getWorkers(),
    now - 24 * 3600 * 1000,
    now
  );

  assert(connectivity.currentFleetStatus.total === 16, 'CONNECTIVITY', 'Fleet status accounts for 16 helmets');
  assert(connectivity.totalOfflineEventsInPeriod === 1, 'CONNECTIVITY', 'Recorded 1 HELMET_OFFLINE event');
  assert(connectivity.interruptedHelmets.length === 1, 'CONNECTIVITY', 'Identified MC-002 as interrupted helmet');
  assert(connectivity.interruptedHelmets[0].helmetId === 'MC-002', 'CONNECTIVITY', 'Interrupted helmet ID matches MC-002');
  assert(connectivity.uptimePercentage === null, 'CONNECTIVITY', 'Uptime percentage is strictly null (not fabricated)');
  assert(connectivity.uptimeLimitationNotice.includes('carrier-grade'), 'CONNECTIVITY', 'Data integrity notice explains limitation');

  // =========================================================================
  // 6. REST API ENDPOINTS & RBAC AUTHORIZATION
  // =========================================================================
  console.log('\n--- 6. REST API ENDPOINTS & RBAC AUTHORIZATION ---');

  // Obtain test tokens: Admin, Supervisor, Worker
  const adminLogin = await mockApi('/api/v1/auth/login', 'POST', { email: 'admin@minecare.local', password: 'Admin#Password2026' });
  const adminToken = adminLogin.data.token;

  const supLogin = await mockApi('/api/v1/auth/login', 'POST', { email: 'supervisor@minecare.local', password: 'Supervisor#Password2026' });
  const supToken = supLogin.data.token;

  const workerLogin = await mockApi('/api/v1/auth/login', 'POST', { email: 'worker.marak@minecare.local', password: 'Worker#Password2026' });
  const workerToken = workerLogin.data.token;

  const fromQuery = encodeURIComponent(new Date(now - 24 * 3600 * 1000).toISOString());
  const toQuery = encodeURIComponent(nowIso);

  // Test 1: Unauthenticated request to /api/v1/analytics/overview rejected with 401
  const unauthRes = await mockApi(`/api/v1/analytics/overview?from=${fromQuery}&to=${toQuery}`, 'GET');
  assert(unauthRes.status === 401, 'RBAC', 'Unauthenticated analytics request rejected (401)');

  // Test 2: Admin can query /api/v1/analytics/overview
  const adminRes = await mockApi(`/api/v1/analytics/overview?from=${fromQuery}&to=${toQuery}`, 'GET', undefined, adminToken);
  assert(adminRes.status === 200, 'RBAC', 'Admin GET /api/v1/analytics/overview succeeds (200)');
  assert(adminRes.data.kpi !== undefined, 'API', 'Overview response contains KPI section');
  assert(adminRes.data.telemetry !== undefined, 'API', 'Overview response contains telemetry');
  assert(adminRes.data.alerts !== undefined, 'API', 'Overview response contains alerts');
  assert(adminRes.data.zones !== undefined, 'API', 'Overview response contains zones');

  // Test 3: Supervisor can query /api/v1/analytics/telemetry
  const supTelRes = await mockApi(`/api/v1/analytics/telemetry?from=${fromQuery}&to=${toQuery}`, 'GET', undefined, supToken);
  assert(supTelRes.status === 200, 'RBAC', 'Supervisor GET /api/v1/analytics/telemetry succeeds (200)');

  // Test 4: Worker role is restricted to own data
  // Worker WRK-001 (assigned MC-001) querying another worker WRK-002 rejected with 403
  const workerForeignWorkerRes = await mockApi(`/api/v1/analytics/overview?from=${fromQuery}&to=${toQuery}&workerId=WRK-002`, 'GET', undefined, workerToken);
  assert(workerForeignWorkerRes.status === 403, 'RBAC', 'Worker querying foreign workerId rejected with 403');

  // Worker querying another helmet MC-002 rejected with 403
  const workerForeignHelmetRes = await mockApi(`/api/v1/analytics/overview?from=${fromQuery}&to=${toQuery}&helmetId=MC-002`, 'GET', undefined, workerToken);
  assert(workerForeignHelmetRes.status === 403, 'RBAC', 'Worker querying foreign helmetId rejected with 403');

  // Worker querying /api/v1/analytics/workers/WRK-002 rejected with 403
  const workerDirectWorkerRes = await mockApi(`/api/v1/analytics/workers/WRK-002?from=${fromQuery}&to=${toQuery}`, 'GET', undefined, workerToken);
  assert(workerDirectWorkerRes.status === 403, 'RBAC', 'Worker inspecting /workers/WRK-002 rejected with 403');

  // Worker querying own /api/v1/analytics/workers/WRK-001 succeeds (200)
  const workerSelfRes = await mockApi(`/api/v1/analytics/workers/WRK-001?from=${fromQuery}&to=${toQuery}`, 'GET', undefined, workerToken);
  assert(workerSelfRes.status === 200, 'RBAC', 'Worker inspecting own history succeeds with 200');
  assert(workerSelfRes.data.worker.id === 'WRK-001', 'RBAC', 'Worker data correctly returned');

  // Helmet specific analytics /api/v1/analytics/helmets/:id
  const helmetRes = await mockApi(`/api/v1/analytics/helmets/MC-001?from=${fromQuery}&to=${toQuery}`, 'GET', undefined, adminToken);
  assert(helmetRes.status === 200, 'API', 'GET /api/v1/analytics/helmets/MC-001 returns 200');
  assert(helmetRes.data.helmet.id === 'MC-001', 'API', 'Returns correct helmet details');
  assert(helmetRes.data.telemetry !== undefined, 'API', 'Returns helmet telemetry analytics');

  // Non-existent helmet returns 404
  const notFoundHelmetRes = await mockApi(`/api/v1/analytics/helmets/MC-999?from=${fromQuery}&to=${toQuery}`, 'GET', undefined, adminToken);
  assert(notFoundHelmetRes.status === 404, 'API', 'Non-existent helmet returns 404');

  // Dedicated /api/v1/analytics/alerts endpoint
  const alertsRes = await mockApi(`/api/v1/analytics/alerts?from=${fromQuery}&to=${toQuery}`, 'GET', undefined, supToken);
  assert(alertsRes.status === 200, 'API', 'GET /api/v1/analytics/alerts returns 200');

  // Dedicated /api/v1/analytics/zones endpoint
  const zonesRes = await mockApi(`/api/v1/analytics/zones?from=${fromQuery}&to=${toQuery}`, 'GET', undefined, supToken);
  assert(zonesRes.status === 200, 'API', 'GET /api/v1/analytics/zones returns 200');

  console.log('\n============================================================');
  console.log(`TOTAL PHASE 5 CHECKS: ${totalChecks}`);
  console.log(`PASSED:               ${passedChecks}`);
  console.log(`FAILED:               ${totalChecks - passedChecks}`);
  console.log('============================================================\n');

  if (totalChecks !== passedChecks) {
    process.exitCode = 1;
  }
}

runPhase5Tests().catch((err) => {
  console.error('Test execution error:', err);
  process.exitCode = 1;
});
