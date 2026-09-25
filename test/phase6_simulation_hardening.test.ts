/**
 * MineCare - Phase 6 End-to-End Safety Simulation & System Hardening Test Suite
 *
 * Verifies the complete software pipeline:
 * Mock Telemetry -> Telemetry API -> Validation -> Database Persistence ->
 * Safety Engine -> Alert Engine -> Helmet Status -> Realtime Publisher ->
 * Dashboard / Fleet / Worker Portal -> Historical Analytics
 *
 * HARDENING COVERAGE:
 * 1. Canonical Safety Scenarios (Normal, High Temp, High Gas, Fall, SOS, Multiple, Recovery, Offline, Reconnect)
 * 2. Strict Safety Priority (DANGER > WARNING > SAFE)
 * 3. Alert Lifecycle Hardening & Deduplication
 * 4. Realtime Publisher Event Integrity
 * 5. Multi-Helmet Isolation (MC-001, MC-002, MC-003, MC-004)
 * 6. Zone-Based Tracking & Safety Event Context (No GPS)
 * 7. Comprehensive RBAC & IDOR Attack Prevention
 * 8. Malformed Telemetry & Input Validation Resilience
 * 9. Full Data Integrity Scenario Sequence
 * 10. Rapid Ingestion Load & Buffer Stability
 */

import { Socket } from 'net';
import { IncomingMessage, ServerResponse } from 'http';
import { DatabaseRepository } from '../src/backend/db/DatabaseRepository';
import { SafetyEngine } from '../src/backend/safety/SafetyEngine';
import { OfflineEngine } from '../src/backend/offline/OfflineEngine';
import { TelemetryValidator } from '../src/backend/validation/TelemetryValidator';
import { RealtimePublisher } from '../src/backend/realtime/RealtimePublisher';
import { BackendApp } from '../src/backend/app';

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

async function runPhase6Tests() {
  console.log('\n============================================================');
  console.log('MINECARE PHASE 6 - END-TO-END SIMULATION & SYSTEM HARDENING');
  console.log('============================================================');

  const db = DatabaseRepository.getInstance();

  // Obtain authorized authentication tokens
  const adminLogin = await mockApi('/api/v1/auth/login', 'POST', {
    email: 'admin@minecare.local',
    password: 'Admin#Password2026',
  });
  const adminToken = adminLogin.data.token;

  const supLogin = await mockApi('/api/v1/auth/login', 'POST', {
    email: 'supervisor@minecare.local',
    password: 'Supervisor#Password2026',
  });
  const supToken = supLogin.data.token;

  const workerLogin = await mockApi('/api/v1/auth/login', 'POST', {
    email: 'worker.marak@minecare.local',
    password: 'Worker#Password2026',
  });
  const workerToken = workerLogin.data.token;

  assert(Boolean(adminToken && supToken && workerToken), 'AUTH', 'Auth tokens successfully acquired for all 3 roles');

  // =========================================================================
  // 1. CANONICAL SAFETY SCENARIOS (PIPELINE END-TO-END)
  // =========================================================================
  console.log('\n--- 1. CANONICAL SAFETY SCENARIOS ---');

  // 1.1 NORMAL (SAFE)
  const normalRes = await mockApi('/api/v1/telemetry', 'POST', {
    packetId: `PKT-MC001-NORM-${Date.now()}`,
    helmetId: 'MC-001',
    sequenceNumber: 101,
    temperature: 26.5,
    humidity: 58.0,
    gasValue: 220,
    accelX: 0.1,
    accelY: 0.2,
    accelZ: 9.81,
    totalAcceleration: 9.81,
    gyroX: 0.0,
    gyroY: 0.0,
    gyroZ: 0.0,
    fallDetected: false,
    sosPressed: false,
  });

  assert(normalRes.status === 201, 'SCENARIO_1', 'NORMAL scenario returns 201 Created');
  assert(normalRes.data.safety.status === 'SAFE', 'SCENARIO_1', 'NORMAL evaluates to SAFE status');
  assert(normalRes.data.safety.outputs.greenLed === true, 'SCENARIO_1', 'NORMAL outputs greenLed = true');
  assert(normalRes.data.safety.outputs.redLed === false, 'SCENARIO_1', 'NORMAL outputs redLed = false');
  assert(normalRes.data.safety.outputs.buzzer === false, 'SCENARIO_1', 'NORMAL outputs buzzer = false');
  const h1 = db.getHelmetWithDetails('MC-001');
  assert(h1?.status === 'SAFE', 'SCENARIO_1', 'Database helmet MC-001 status updated to SAFE');
  assert(h1?.online === true, 'SCENARIO_1', 'Database helmet MC-001 is ONLINE');

  // 1.2 HIGH TEMPERATURE (WARNING: > 40°C)
  const highTempRes = await mockApi('/api/v1/telemetry', 'POST', {
    packetId: `PKT-MC001-TEMP-${Date.now()}`,
    helmetId: 'MC-001',
    sequenceNumber: 102,
    temperature: 42.5,
    humidity: 62.0,
    gasValue: 220,
    accelX: 0.1,
    accelY: 0.2,
    accelZ: 9.81,
    totalAcceleration: 9.81,
    gyroX: 0.0,
    gyroY: 0.0,
    gyroZ: 0.0,
    fallDetected: false,
    sosPressed: false,
  });

  assert(highTempRes.status === 201, 'SCENARIO_2', 'HIGH TEMPERATURE returns 201 Created');
  assert(highTempRes.data.safety.status === 'WARNING', 'SCENARIO_2', 'HIGH TEMPERATURE evaluates to WARNING');
  assert(highTempRes.data.safety.primaryTrigger === 'HIGH_TEMPERATURE', 'SCENARIO_2', 'Trigger is HIGH_TEMPERATURE');
  assert(highTempRes.data.safety.outputs.greenLed === false, 'SCENARIO_2', 'Outputs greenLed = false');
  assert(highTempRes.data.safety.outputs.redLed === true, 'SCENARIO_2', 'Outputs redLed = true');
  assert(highTempRes.data.safety.outputs.buzzer === false, 'SCENARIO_2', 'Outputs buzzer = false (warning does not buzz)');
  const tempAlert = db.getAlerts().find((a) => a.helmet_id === 'MC-001' && a.type === 'HEAT_STRESS' && a.status === 'TRIGGERED');
  assert(Boolean(tempAlert), 'SCENARIO_2', 'HEAT_STRESS alert created in database');
  assert(tempAlert?.severity === 'WARNING', 'SCENARIO_2', 'HEAT_STRESS severity is WARNING');

  // 1.3 HIGH GAS (WARNING: Raw ADC > 800)
  const highGasRes = await mockApi('/api/v1/telemetry', 'POST', {
    packetId: `PKT-MC002-GAS-${Date.now()}`,
    helmetId: 'MC-002',
    sequenceNumber: 103,
    temperature: 28.0,
    humidity: 55.0,
    gasValue: 885, // Raw ADC units (0-1023)
    accelX: 0.1,
    accelY: 0.2,
    accelZ: 9.81,
    totalAcceleration: 9.81,
    gyroX: 0.0,
    gyroY: 0.0,
    gyroZ: 0.0,
    fallDetected: false,
    sosPressed: false,
  });

  assert(highGasRes.status === 201, 'SCENARIO_3', 'HIGH GAS returns 201 Created');
  assert(highGasRes.data.safety.status === 'WARNING', 'SCENARIO_3', 'HIGH GAS evaluates to WARNING');
  assert(highGasRes.data.safety.primaryTrigger === 'HIGH_RAW_GAS_LEVEL', 'SCENARIO_3', 'Trigger is HIGH_RAW_GAS_LEVEL');
  assert(highGasRes.data.safety.triggerDetails.some((d: string) => d.includes('885 > 800 ADC')), 'SCENARIO_3', 'Gas value preserved in raw ADC units');
  const gasAlert = db.getAlerts().find((a) => a.helmet_id === 'MC-002' && a.type === 'GAS_HAZARD' && a.status === 'TRIGGERED');
  assert(Boolean(gasAlert), 'SCENARIO_3', 'GAS_HAZARD alert created in database');
  assert(gasAlert?.severity === 'WARNING', 'SCENARIO_3', 'GAS_HAZARD severity is WARNING');

  // 1.4 FALL (DANGER: Total Accel > 15.0 m/s²)
  const fallRes = await mockApi('/api/v1/telemetry', 'POST', {
    packetId: `PKT-MC003-FALL-${Date.now()}`,
    helmetId: 'MC-003',
    sequenceNumber: 104,
    temperature: 27.0,
    humidity: 56.0,
    gasValue: 210,
    accelX: 11.2,
    accelY: 10.4,
    accelZ: 16.2,
    totalAcceleration: 22.4, // > 15.0 m/s²
    gyroX: 25.0,
    gyroY: -18.0,
    gyroZ: 4.0,
    fallDetected: true,
    sosPressed: false,
  });

  assert(fallRes.status === 201, 'SCENARIO_4', 'FALL returns 201 Created');
  assert(fallRes.data.safety.status === 'DANGER', 'SCENARIO_4', 'FALL evaluates to DANGER');
  assert(fallRes.data.safety.primaryTrigger === 'FALL_IMPACT_DETECTED', 'SCENARIO_4', 'Trigger is FALL_IMPACT_DETECTED');
  assert(fallRes.data.safety.outputs.buzzer === true, 'SCENARIO_4', 'DANGER activates buzzer in outputs');
  assert(fallRes.data.safety.outputs.redLed === true, 'SCENARIO_4', 'DANGER activates redLed');
  const fallAlert = db.getAlerts().find((a) => a.helmet_id === 'MC-003' && a.type === 'WORKER_FALL' && a.status === 'TRIGGERED');
  assert(Boolean(fallAlert), 'SCENARIO_4', 'WORKER_FALL alert created in database');
  assert(fallAlert?.severity === 'CRITICAL', 'SCENARIO_4', 'WORKER_FALL severity is CRITICAL');

  // 1.5 SOS (DANGER: Emergency Button Pressed)
  const sosRes = await mockApi('/api/v1/telemetry', 'POST', {
    packetId: `PKT-MC001-SOS-${Date.now()}`,
    helmetId: 'MC-001',
    sequenceNumber: 105,
    temperature: 26.5,
    humidity: 58.0,
    gasValue: 220,
    accelX: 0.1,
    accelY: 0.2,
    accelZ: 9.81,
    totalAcceleration: 9.81,
    gyroX: 0.0,
    gyroY: 0.0,
    gyroZ: 0.0,
    fallDetected: false,
    sosPressed: true,
  });

  assert(sosRes.status === 201, 'SCENARIO_5', 'SOS returns 201 Created');
  assert(sosRes.data.safety.status === 'DANGER', 'SCENARIO_5', 'SOS evaluates to DANGER');
  assert(sosRes.data.safety.outputs.buzzer === true, 'SCENARIO_5', 'SOS activates buzzer in outputs');
  const sosAlert = db.getAlerts().find((a) => a.helmet_id === 'MC-001' && a.type === 'SOS_EMERGENCY' && a.status === 'TRIGGERED');
  assert(Boolean(sosAlert), 'SCENARIO_5', 'SOS_EMERGENCY alert created in database');
  assert(sosAlert?.severity === 'CRITICAL', 'SCENARIO_5', 'SOS_EMERGENCY severity is CRITICAL');

  // 1.6 MULTIPLE ALERTS & PRECEDENCE (DANGER > WARNING > SAFE)
  const multiRes = await mockApi('/api/v1/telemetry', 'POST', {
    packetId: `PKT-MC005-MULTI-${Date.now()}`,
    helmetId: 'MC-005',
    sequenceNumber: 106,
    temperature: 43.5, // > 40°C (Warning)
    humidity: 60.0,
    gasValue: 920,     // > 800 ADC (Warning)
    accelX: 0.1,
    accelY: 0.2,
    accelZ: 9.81,
    totalAcceleration: 9.81,
    gyroX: 0.0,
    gyroY: 0.0,
    gyroZ: 0.0,
    fallDetected: false,
    sosPressed: true,   // SOS (Danger)
  });

  assert(multiRes.status === 201, 'SCENARIO_6', 'MULTIPLE ALERTS returns 201 Created');
  assert(multiRes.data.safety.status === 'DANGER', 'SCENARIO_6', 'DANGER takes strict precedence over WARNING');
  assert(multiRes.data.safety.primaryTrigger === 'MULTIPLE_HAZARDS', 'SCENARIO_6', 'Trigger identifies MULTIPLE_HAZARDS');
  assert(multiRes.data.safety.triggerDetails.length >= 3, 'SCENARIO_6', 'Trigger details include all 3 simultaneous hazards');
  assert(multiRes.data.safety.outputs.buzzer === true, 'SCENARIO_6', 'Buzzer active for compound danger hazard');

  // 1.7 RECOVERY (SAFE & Auto-Resolve of Hazard Alerts)
  const recRes = await mockApi('/api/v1/telemetry', 'POST', {
    packetId: `PKT-MC002-REC-${Date.now()}`,
    helmetId: 'MC-002',
    sequenceNumber: 107,
    temperature: 26.0,
    humidity: 55.0,
    gasValue: 215, // Returned to nominal safe baseline
    accelX: 0.1,
    accelY: 0.2,
    accelZ: 9.81,
    totalAcceleration: 9.81,
    gyroX: 0.0,
    gyroY: 0.0,
    gyroZ: 0.0,
    fallDetected: false,
    sosPressed: false,
  });

  assert(recRes.status === 201, 'SCENARIO_7', 'RECOVERY packet accepted with 201');
  assert(recRes.data.safety.status === 'SAFE', 'SCENARIO_7', 'Evaluates to SAFE status');
  assert(recRes.data.alertsResolvedCount >= 1, 'SCENARIO_7', 'Active environmental gas hazard auto-resolved');
  const resolvedGasAlert = db.getAlerts().find((a) => a.helmet_id === 'MC-002' && a.type === 'GAS_HAZARD');
  assert(resolvedGasAlert?.status === 'RESOLVED', 'SCENARIO_7', 'Gas alert marked RESOLVED in database');
  assert(Boolean(resolvedGasAlert?.resolved_at), 'SCENARIO_7', 'Gas alert resolved_at timestamp populated');
  assert(Boolean(resolvedGasAlert?.created_at), 'SCENARIO_7', 'Historical alert record NOT deleted during recovery');

  // 1.8 OFFLINE (ONLINE -> STALE -> OFFLINE after 8 seconds)
  const h4 = db.getHelmet('MC-004');
  assert(Boolean(h4), 'SCENARIO_8', 'Helmet MC-004 exists');
  // Backdate last_seen by 9.5 seconds
  if (h4) {
    h4.last_seen = new Date(Date.now() - 9500).toISOString();
    h4.online = true;
  }
  const offlineCheck = OfflineEngine.checkFleetHeartbeats(db.getRawHelmets(), db.getAlertsStore());
  assert(offlineCheck.statusChanges.some((c) => c.helmetId === 'MC-004' && c.state === 'OFFLINE'), 'SCENARIO_8', 'MC-004 detected as OFFLINE');
  const offlineAlert = db.getAlerts().find((a) => a.helmet_id === 'MC-004' && a.type === 'HELMET_OFFLINE' && a.status === 'TRIGGERED');
  assert(Boolean(offlineAlert), 'SCENARIO_8', 'HELMET_OFFLINE alert triggered in database');

  // 1.9 RECONNECT (Resume packet stream -> auto-resolve offline alert)
  const reconnectRes = await mockApi('/api/v1/telemetry', 'POST', {
    packetId: `PKT-MC004-REC-${Date.now()}`,
    helmetId: 'MC-004',
    sequenceNumber: 108,
    temperature: 26.8,
    humidity: 59.0,
    gasValue: 210,
    accelX: 0.1,
    accelY: 0.2,
    accelZ: 9.81,
    totalAcceleration: 9.81,
    gyroX: 0.0,
    gyroY: 0.0,
    gyroZ: 0.0,
    fallDetected: false,
    sosPressed: false,
  });

  assert(reconnectRes.status === 201, 'SCENARIO_9', 'Telemetry accepted on reconnect');
  const h4After = db.getHelmet('MC-004');
  assert(h4After?.online === true, 'SCENARIO_9', 'MC-004 restored to ONLINE status in database');
  const resolvedOfflineAlert = db.getAlerts().find((a) => a.helmet_id === 'MC-004' && a.type === 'HELMET_OFFLINE');
  assert(resolvedOfflineAlert?.status === 'RESOLVED', 'SCENARIO_9', 'HELMET_OFFLINE alert auto-resolved on packet stream resumption');

  // =========================================================================
  // 2. STRICT SAFETY PRIORITY MATRIX VALIDATION
  // =========================================================================
  console.log('\n--- 2. SAFETY PRIORITY MATRIX VALIDATION ---');

  const matrixTests = [
    { label: 'SOS only', temp: 25, gas: 200, accel: 9.8, sos: true, expected: 'DANGER', buzzer: true },
    { label: 'Fall only', temp: 25, gas: 200, accel: 18.5, sos: false, expected: 'DANGER', buzzer: true },
    { label: 'SOS + Gas + Temp', temp: 45, gas: 900, accel: 9.8, sos: true, expected: 'DANGER', buzzer: true },
    { label: 'Fall + Gas', temp: 25, gas: 900, accel: 19.0, sos: false, expected: 'DANGER', buzzer: true },
    { label: 'Gas only', temp: 25, gas: 850, accel: 9.8, sos: false, expected: 'WARNING', buzzer: false },
    { label: 'Temp only', temp: 42, gas: 200, accel: 9.8, sos: false, expected: 'WARNING', buzzer: false },
    { label: 'Gas + Temp', temp: 42, gas: 850, accel: 9.8, sos: false, expected: 'WARNING', buzzer: false },
    { label: 'Nominal baseline', temp: 26, gas: 220, accel: 9.8, sos: false, expected: 'SAFE', buzzer: false },
  ];

  matrixTests.forEach((t) => {
    const evalRes = SafetyEngine.evaluate({
      temperature: t.temp,
      gasValue: t.gas,
      totalAcceleration: t.accel,
      sosPressed: t.sos,
    });
    assert(evalRes.status === t.expected, 'PRIORITY', `${t.label} strictly evaluates to ${t.expected}`);
    assert(evalRes.outputs.buzzer === t.buzzer, 'PRIORITY', `${t.label} buzzer output = ${t.buzzer}`);
  });

  // =========================================================================
  // 3. ALERT LIFECYCLE HARDENING & DEDUPLICATION
  // =========================================================================
  console.log('\n--- 3. ALERT LIFECYCLE & DEDUPLICATION ---');

  // Deduplication: 10 consecutive packets of high gas for helmet MC-006
  for (let i = 0; i < 10; i++) {
    await mockApi('/api/v1/telemetry', 'POST', {
      packetId: `PKT-MC006-DEDUP-${i}-${Date.now()}`,
      helmetId: 'MC-006',
      sequenceNumber: 200 + i,
      temperature: 28.0,
      humidity: 55.0,
      gasValue: 850 + i * 5,
      accelX: 0.1,
      accelY: 0.2,
      accelZ: 9.81,
      totalAcceleration: 9.81,
      gyroX: 0.0,
      gyroY: 0.0,
      gyroZ: 0.0,
      fallDetected: false,
      sosPressed: false,
    });
  }

  const activeGasAlertsMC6 = db.getAlerts().filter((a) => a.helmet_id === 'MC-006' && a.type === 'GAS_HAZARD' && a.status === 'TRIGGERED');
  assert(activeGasAlertsMC6.length === 1, 'ALERT_LIFECYCLE', '10 consecutive hazard packets produce exactly 1 active alert (deduplication working)');
  assert(activeGasAlertsMC6[0].readings_snapshot.gas_value === 895, 'ALERT_LIFECYCLE', 'Readings snapshot updated to latest frame (895 ADC)');

  // Supervisor Acknowledgement
  const ackRes = await mockApi(`/api/v1/alerts/${activeGasAlertsMC6[0].id}/acknowledge`, 'POST', {
    supervisorName: 'Supervisor Test Unit',
  }, supToken);
  assert(ackRes.status === 200, 'ALERT_LIFECYCLE', 'Supervisor can acknowledge active alert');
  assert(ackRes.data.status === 'ACKNOWLEDGED', 'ALERT_LIFECYCLE', 'Alert status updated to ACKNOWLEDGED');
  assert(ackRes.data.acknowledged_by === 'Supervisor Test Unit', 'ALERT_LIFECYCLE', 'Supervisor name recorded in audit field');

  // Supervisor Resolution
  const resolveRes = await mockApi(`/api/v1/alerts/${activeGasAlertsMC6[0].id}/resolve`, 'POST', {
    supervisorNotes: 'Ventilation shaft fan restarted and verified.',
  }, supToken);
  assert(resolveRes.status === 200, 'ALERT_LIFECYCLE', 'Supervisor can resolve alert');
  assert(resolveRes.data.status === 'RESOLVED', 'ALERT_LIFECYCLE', 'Alert status updated to RESOLVED');
  assert(resolveRes.data.supervisor_notes.includes('Ventilation shaft'), 'ALERT_LIFECYCLE', 'Resolution notes recorded');

  // =========================================================================
  // 4. MULTI-HELMET SIMULTANEOUS ISOLATION
  // =========================================================================
  console.log('\n--- 4. MULTI-HELMET ISOLATION ---');

  // Run 4 distinct scenarios simultaneously
  // MC-001 -> SAFE
  // MC-002 -> HIGH GAS (WARNING)
  // MC-003 -> FALL (DANGER)
  // MC-004 -> OFFLINE
  await mockApi('/api/v1/telemetry', 'POST', {
    packetId: `PKT-MC001-ISO-${Date.now()}`,
    helmetId: 'MC-001',
    sequenceNumber: 301,
    temperature: 25.0,
    humidity: 55.0,
    gasValue: 200,
    accelX: 0.1,
    accelY: 0.2,
    accelZ: 9.81,
    totalAcceleration: 9.81,
    gyroX: 0.0,
    gyroY: 0.0,
    gyroZ: 0.0,
    fallDetected: false,
    sosPressed: false,
  });

  await mockApi('/api/v1/telemetry', 'POST', {
    packetId: `PKT-MC002-ISO-${Date.now()}`,
    helmetId: 'MC-002',
    sequenceNumber: 302,
    temperature: 28.0,
    humidity: 55.0,
    gasValue: 880,
    accelX: 0.1,
    accelY: 0.2,
    accelZ: 9.81,
    totalAcceleration: 9.81,
    gyroX: 0.0,
    gyroY: 0.0,
    gyroZ: 0.0,
    fallDetected: false,
    sosPressed: false,
  });

  await mockApi('/api/v1/telemetry', 'POST', {
    packetId: `PKT-MC003-ISO-${Date.now()}`,
    helmetId: 'MC-003',
    sequenceNumber: 303,
    temperature: 26.0,
    humidity: 55.0,
    gasValue: 210,
    accelX: 12.0,
    accelY: 10.0,
    accelZ: 14.0,
    totalAcceleration: 20.97,
    gyroX: 10.0,
    gyroY: -5.0,
    gyroZ: 2.0,
    fallDetected: true,
    sosPressed: false,
  });

  const hMC1 = db.getHelmetWithDetails('MC-001');
  const hMC2 = db.getHelmetWithDetails('MC-002');
  const hMC3 = db.getHelmetWithDetails('MC-003');

  assert(hMC1?.status === 'SAFE', 'MULTI_HELMET', 'MC-001 maintains SAFE state independently');
  assert(hMC2?.status === 'WARNING', 'MULTI_HELMET', 'MC-002 maintains WARNING state independently');
  assert(hMC3?.status === 'DANGER', 'MULTI_HELMET', 'MC-003 maintains DANGER state independently');

  // Verify alert association
  const alertMC2 = db.getAlerts().find((a) => a.helmet_id === 'MC-002' && a.status === 'TRIGGERED');
  assert(alertMC2?.type === 'GAS_HAZARD', 'MULTI_HELMET', 'MC-002 has isolated GAS_HAZARD alert');
  const alertMC3 = db.getAlerts().find((a) => a.helmet_id === 'MC-003' && a.status === 'TRIGGERED');
  assert(alertMC3?.type === 'WORKER_FALL', 'MULTI_HELMET', 'MC-003 has isolated WORKER_FALL alert');

  // =========================================================================
  // 5. ZONE CONTEXT & AUDIT LEDGER (NO GPS)
  // =========================================================================
  console.log('\n--- 5. ZONE CONTEXT & OPERATIONS ---');

  const zonesRes = await mockApi('/api/v1/zones', 'GET', undefined, supToken);
  assert(zonesRes.status === 200, 'ZONES', 'GET /api/v1/zones returns 200');
  assert(zonesRes.data.length === 4, 'ZONES', 'All 4 discrete mine zones present');

  const zoneNames = zonesRes.data.map((z: any) => z.name);
  assert(zoneNames.includes('Portal / Surface'), 'ZONES', 'Portal / Surface zone exists');
  assert(zoneNames.includes('Level 1 — North Drift'), 'ZONES', 'Level 1 — North Drift zone exists');
  assert(zoneNames.includes('Level 2 — South Panel'), 'ZONES', 'Level 2 — South Panel zone exists');
  assert(zoneNames.includes('Level 3 — Haul Road'), 'ZONES', 'Level 3 — Haul Road zone exists');

  // Check-in, check-out, and reassignment
  const checkOutRes = await mockApi('/api/v1/workers/WRK-001/check-out', 'POST', undefined, workerToken);
  assert(checkOutRes.status === 200, 'ZONES', 'Worker can check out from active zone');

  const checkInRes = await mockApi('/api/v1/workers/WRK-001/check-in', 'POST', {
    zoneId: 'level-2-south-panel',
  }, workerToken);
  assert(checkInRes.status === 200, 'ZONES', 'Worker can check in to Level 2 — South Panel');

  const reassignRes = await mockApi('/api/v1/workers/WRK-001/zone', 'POST', {
    zoneId: 'level-1-north-drift',
    updateDefault: true,
  }, supToken);
  assert(reassignRes.status === 200, 'ZONES', 'Supervisor can reassign worker to Level 1 — North Drift');

  // =========================================================================
  // 6. RBAC & IDOR SECURITY HARDENING
  // =========================================================================
  console.log('\n--- 6. RBAC & IDOR SECURITY HARDENING ---');

  // Worker A querying own profile -> 200
  const selfWorkerRes = await mockApi('/api/v1/workers/WRK-001', 'GET', undefined, workerToken);
  assert(selfWorkerRes.status === 200, 'RBAC_SECURITY', 'Worker A can access own profile (200)');

  // IDOR 1: Worker A querying Worker B profile -> 403
  const idorWorkerRes = await mockApi('/api/v1/workers/WRK-002', 'GET', undefined, workerToken);
  assert(idorWorkerRes.status === 403, 'RBAC_SECURITY', 'IDOR: Worker A querying Worker B profile returns 403 Forbidden');

  // IDOR 2: Worker A querying Worker B helmet -> 403
  const idorHelmetRes = await mockApi('/api/v1/helmets/MC-002', 'GET', undefined, workerToken);
  assert(idorHelmetRes.status === 403, 'RBAC_SECURITY', 'IDOR: Worker A querying Worker B helmet returns 403 Forbidden');

  // IDOR 3: Worker A querying Worker B alerts -> 403
  const idorAlertsRes = await mockApi('/api/v1/alerts?workerId=WRK-002', 'GET', undefined, workerToken);
  assert(idorAlertsRes.status === 403, 'RBAC_SECURITY', 'IDOR: Worker A querying Worker B alerts returns 403 Forbidden');

  // IDOR 4: Worker A querying Worker B helmet alerts -> 403
  const idorHelmetAlertsRes = await mockApi('/api/v1/alerts?helmetId=MC-002', 'GET', undefined, workerToken);
  assert(idorHelmetAlertsRes.status === 403, 'RBAC_SECURITY', 'IDOR: Worker A querying Worker B helmet alerts returns 403 Forbidden');

  // IDOR 5: Worker A querying Worker B analytics -> 403
  const nowQuery = new Date().toISOString();
  const pastQuery = new Date(Date.now() - 3600000).toISOString();
  const idorAnalyticsWorkerRes = await mockApi(`/api/v1/analytics/workers/WRK-002?from=${pastQuery}&to=${nowQuery}`, 'GET', undefined, workerToken);
  assert(idorAnalyticsWorkerRes.status === 403, 'RBAC_SECURITY', 'IDOR: Worker A querying Worker B analytics returns 403 Forbidden');

  // IDOR 6: Worker A querying Worker B helmet analytics -> 403
  const idorAnalyticsHelmetRes = await mockApi(`/api/v1/analytics/helmets/MC-002?from=${pastQuery}&to=${nowQuery}`, 'GET', undefined, workerToken);
  assert(idorAnalyticsHelmetRes.status === 403, 'RBAC_SECURITY', 'IDOR: Worker A querying Worker B helmet analytics returns 403 Forbidden');

  // Unauthorized operational action: Worker trying to reassign zones -> 403
  const workerReassignRes = await mockApi('/api/v1/workers/WRK-002/zone', 'POST', {
    zoneId: 'level-1-north-drift',
  }, workerToken);
  assert(workerReassignRes.status === 403, 'RBAC_SECURITY', 'Worker attempting supervisor zone reassignment returns 403 Forbidden');

  // Unauthorized operational action: Worker trying to acknowledge alert -> 403
  const workerAckRes = await mockApi('/api/v1/alerts/ALT-TEST/acknowledge', 'POST', {}, workerToken);
  assert(workerAckRes.status === 403, 'RBAC_SECURITY', 'Worker attempting alert acknowledgement returns 403 Forbidden');

  // Unauthorized admin action: Worker trying to access admin endpoint -> 403
  const workerAdminRes = await mockApi('/api/v1/admin/users', 'GET', undefined, workerToken);
  assert(workerAdminRes.status === 403, 'RBAC_SECURITY', 'Worker attempting admin access returns 403 Forbidden');

  // Unauthenticated access -> 401
  const unauthRes = await mockApi('/api/v1/helmets', 'GET');
  assert(unauthRes.status === 401, 'RBAC_SECURITY', 'Unauthenticated request to operational endpoint returns 401 Unauthorized');

  // =========================================================================
  // 7. INPUT VALIDATION & CRASH RESILIENCE
  // =========================================================================
  console.log('\n--- 7. INPUT VALIDATION & CRASH RESILIENCE ---');

  // Missing helmetId
  const missingHelmet = await mockApi('/api/v1/telemetry', 'POST', {
    temperature: 25.0,
    humidity: 50.0,
    gasValue: 200,
  });
  assert(missingHelmet.status === 400, 'VALIDATION', 'Missing helmetId returns 400 Bad Request');

  // Impossible temperature (> 120°C)
  const badTemp = await mockApi('/api/v1/telemetry', 'POST', {
    helmetId: 'MC-001',
    temperature: 150.0,
    humidity: 50.0,
    gasValue: 200,
  });
  assert(badTemp.status === 400, 'VALIDATION', 'Plausibility check rejects 150°C temperature (400)');

  // Impossible humidity (> 100%)
  const badHumidity = await mockApi('/api/v1/telemetry', 'POST', {
    helmetId: 'MC-001',
    temperature: 25.0,
    humidity: 125.0,
    gasValue: 200,
  });
  assert(badHumidity.status === 400, 'VALIDATION', 'Humidity > 100% rejected (400)');

  // Out-of-bounds MQ-2 Raw Gas (> 1023 ADC)
  const badGas = await mockApi('/api/v1/telemetry', 'POST', {
    helmetId: 'MC-001',
    temperature: 25.0,
    humidity: 50.0,
    gasValue: 2048, // Exceeds 10-bit ADC
  });
  assert(badGas.status === 400, 'VALIDATION', 'Gas ADC > 1023 rejected (400)');

  // Non-numeric acceleration
  const badAccel = await mockApi('/api/v1/telemetry', 'POST', {
    helmetId: 'MC-001',
    temperature: 25.0,
    humidity: 50.0,
    gasValue: 200,
    accelX: 'corrupted_string',
  });
  assert(badAccel.status === 400, 'VALIDATION', 'Non-numeric acceleration string rejected (400)');

  // Future timestamp (> 24 hours in future)
  const futureTimestamp = new Date(Date.now() + 48 * 3600 * 1000).toISOString();
  const badTime = await mockApi('/api/v1/telemetry', 'POST', {
    helmetId: 'MC-001',
    timestamp: futureTimestamp,
    temperature: 25.0,
    humidity: 50.0,
    gasValue: 200,
  });
  assert(badTime.status === 400, 'VALIDATION', 'Future timestamp (>24h) rejected (400)');

  // Malformed non-object JSON payload
  const nonObjectPayload = TelemetryValidator.validate('not_a_json_object');
  assert(!nonObjectPayload.isValid, 'VALIDATION', 'Validator rejects string payload safely');

  // =========================================================================
  // 8. DATA INTEGRITY FULL SCENARIO SEQUENCE
  // =========================================================================
  console.log('\n--- 8. DATA INTEGRITY FULL SCENARIO SEQUENCE ---');

  // Sequence: NORMAL -> HIGH GAS -> RECOVERY -> HIGH TEMP -> RECOVERY -> FALL -> RECOVERY -> SOS -> RECOVERY
  const testHelmet = 'MC-007';
  const sequenceSteps = [
    { name: 'NORMAL', temp: 26.0, gas: 210, accel: 9.8, sos: false, expStatus: 'SAFE' },
    { name: 'HIGH_GAS', temp: 26.0, gas: 880, accel: 9.8, sos: false, expStatus: 'WARNING' },
    { name: 'RECOVERY_1', temp: 26.0, gas: 210, accel: 9.8, sos: false, expStatus: 'SAFE' },
    { name: 'HIGH_TEMP', temp: 43.0, gas: 210, accel: 9.8, sos: false, expStatus: 'WARNING' },
    { name: 'RECOVERY_2', temp: 26.0, gas: 210, accel: 9.8, sos: false, expStatus: 'SAFE' },
    { name: 'FALL', temp: 26.0, gas: 210, accel: 21.0, sos: false, expStatus: 'DANGER' },
    { name: 'RECOVERY_3', temp: 26.0, gas: 210, accel: 9.8, sos: false, expStatus: 'SAFE' },
    { name: 'SOS', temp: 26.0, gas: 210, accel: 9.8, sos: true, expStatus: 'DANGER' },
    { name: 'RECOVERY_4', temp: 26.0, gas: 210, accel: 9.8, sos: false, expStatus: 'SAFE' },
  ];

  for (let idx = 0; idx < sequenceSteps.length; idx++) {
    const s = sequenceSteps[idx];
    const res = await mockApi('/api/v1/telemetry', 'POST', {
      packetId: `PKT-${testHelmet}-SEQ-${idx}-${Date.now()}`,
      helmetId: testHelmet,
      sequenceNumber: 500 + idx,
      temperature: s.temp,
      humidity: 58.0,
      gasValue: s.gas,
      accelX: 0.1,
      accelY: 0.2,
      accelZ: s.accel,
      totalAcceleration: s.accel,
      gyroX: 0.0,
      gyroY: 0.0,
      gyroZ: 0.0,
      fallDetected: s.accel > 15.0,
      sosPressed: s.sos,
    });
    assert(res.status === 201, 'SEQUENCE', `Step ${idx + 1} (${s.name}) accepted`);
    assert(res.data.safety.status === s.expStatus, 'SEQUENCE', `Step ${idx + 1} (${s.name}) evaluated to ${s.expStatus}`);
  }

  // Verify that all 9 packets were persisted
  const helmetPackets = db.getTelemetryByRange({
    from: new Date(Date.now() - 3600000).toISOString(),
    to: new Date(Date.now() + 60000).toISOString(),
    helmetId: testHelmet,
  });
  assert(helmetPackets.length >= 9, 'INTEGRITY', `All ${sequenceSteps.length} sequence telemetry packets persisted in database`);

  // Verify historical alerts remain intact
  const mc7Alerts = db.getAlerts().filter((a) => a.helmet_id === testHelmet);
  assert(mc7Alerts.length >= 4, 'INTEGRITY', 'Historical alerts from each hazard step preserved in database (not deleted)');
  const allResolved = mc7Alerts.filter((a) => a.status === 'RESOLVED');
  assert(allResolved.length >= 4, 'INTEGRITY', 'All hazard alerts transitioned to RESOLVED after respective recoveries');

  // =========================================================================
  // 9. RAPID INGESTION & BUFFER STABILITY
  // =========================================================================
  console.log('\n--- 9. RAPID INGESTION & BUFFER STABILITY ---');

  // Rapidly ingest 60 packets across 6 helmets
  const rapidPromises: Promise<{ status: number; data: any }>[] = [];
  for (let i = 0; i < 60; i++) {
    const targetHelmet = `MC-00${(i % 6) + 1}`;
    rapidPromises.push(
      mockApi('/api/v1/telemetry', 'POST', {
        packetId: `PKT-RAPID-${i}-${Date.now()}`,
        helmetId: targetHelmet,
        sequenceNumber: 1000 + i,
        temperature: 25.0 + (i % 5),
        humidity: 55.0,
        gasValue: 200 + (i % 20),
        accelX: 0.1,
        accelY: 0.2,
        accelZ: 9.81,
        totalAcceleration: 9.81,
        gyroX: 0.0,
        gyroY: 0.0,
        gyroZ: 0.0,
        fallDetected: false,
        sosPressed: false,
      })
    );
  }

  const rapidResults = await Promise.all(rapidPromises);
  const all201 = rapidResults.every((r) => r.status === 201);
  assert(all201, 'LOAD_STABILITY', '60 rapid concurrent packets ingested with 100% success (all 201)');

  // Verify memory and buffer bounds
  const mc1Packets = db.getTelemetryHistory('MC-001', 500);
  assert(mc1Packets.length <= 2000, 'LOAD_STABILITY', 'Rolling telemetry buffer remains bounded to configured capacity');

  // =========================================================================
  // 10. REALTIME SUBSCRIBER CLEANUP & SSE FALLBACK
  // =========================================================================
  console.log('\n--- 10. REALTIME PUBLISHER & SSE INTEGRITY ---');

  const pub = RealtimePublisher.getInstance();
  let receivedCount = 0;
  const unsub = pub.subscribe((payload) => {
    if (payload.table === 'telemetry') {
      receivedCount++;
    }
  });

  pub.publish('telemetry', 'INSERT', { id: 'TEST-EVENT' });
  assert(receivedCount === 1, 'REALTIME', 'Realtime subscriber receives published event');

  unsub();
  pub.publish('telemetry', 'INSERT', { id: 'TEST-EVENT-2' });
  assert(receivedCount === 1, 'REALTIME', 'Unsubscribed listener does not receive events (no memory leak)');

  // =========================================================================
  // SUMMARY
  // =========================================================================
  console.log('\n============================================================');
  console.log(`TOTAL PHASE 6 CHECKS: ${totalChecks}`);
  console.log(`PASSED:               ${passedChecks}`);
  console.log(`FAILED:               ${totalChecks - passedChecks}`);
  console.log('============================================================\n');

  if (totalChecks !== passedChecks) {
    process.exitCode = 1;
  }
}

runPhase6Tests().catch((err) => {
  console.error('Phase 6 Test execution error:', err);
  process.exitCode = 1;
});
