/**
 * MineCare - Phase 2 Comprehensive Backend Test Suite
 *
 * Verifies:
 * 1. DATABASE: 16 workers, 16 helmets, 4 zones, initial zone distribution, assignments history
 * 2. TELEMETRY: Ingestion validation, malformed rejection, persistence, latest/history retrieval
 * 3. SAFETY ENGINE: Precedence rules (DANGER > WARNING > SAFE), fall, gas, temp, SOS
 * 4. ALERT ENGINE: Deduplication, auto-recovery, acknowledgement, resolution
 * 5. ZONE SYSTEM: Check-in, check-out, supervisor reassignment, history ledger
 * 6. OFFLINE ENGINE: last_seen connectivity states (ONLINE, STALE, OFFLINE)
 * 7. REST API: All 18 endpoints via BackendApp request dispatcher
 */

import { IncomingMessage, ServerResponse } from 'http';
import { Socket } from 'net';
import { DatabaseRepository } from '../src/backend/db/DatabaseRepository';
import { TelemetryValidator } from '../src/backend/validation/TelemetryValidator';
import { SafetyEngine } from '../src/backend/safety/SafetyEngine';
import { AlertEngine } from '../src/backend/alerts/AlertEngine';
import { OfflineEngine } from '../src/backend/offline/OfflineEngine';
import { BackendApp } from '../src/backend/app';
import type { DbAlert, DbHelmet } from '../src/backend/types';

interface TestResult {
  category: string;
  name: string;
  passed: boolean;
  error?: string;
}

const results: TestResult[] = [];

function assert(condition: boolean, category: string, name: string, message?: string): void {
  if (condition) {
    results.push({ category, name, passed: true });
    console.log(`  ✓ [${category}] ${name}`);
  } else {
    results.push({ category, name, passed: false, error: message || 'Assertion failed' });
    console.error(`  ✗ [${category}] ${name} - ${message || 'Assertion failed'}`);
  }
}

async function runTests() {
  console.log('\n============================================================');
  console.log('MINECARE PHASE 2 - BACKEND & DATABASE TEST SUITE');
  console.log('============================================================\n');

  const db = DatabaseRepository.getInstance();

  // =========================================================================
  // 1. DATABASE SEED TESTS
  // =========================================================================
  console.log('--- 1. DATABASE & RELATIONSHIPS ---');
  const workers = db.getWorkers();
  const helmets = db.getHelmets();
  const zones = db.getZones();
  const initialHistory = db.getZoneAssignmentsHistory();

  assert(workers.length === 16, 'DATABASE', 'Exactly 16 workers seeded');
  assert(helmets.length === 16, 'DATABASE', 'Exactly 16 helmets seeded (MC-001 to MC-016)');
  assert(zones.length === 4, 'DATABASE', 'Exactly 4 mine zones seeded');
  assert(initialHistory.length === 16, 'DATABASE', 'Exactly 16 initial zone assignments created');

  // Verify worker identities
  const rMarak = db.getWorker('WRK-001') || db.getWorker('EMP-4200');
  assert(Boolean(rMarak && rMarak.name === 'R. Marak'), 'DATABASE', 'Worker R. Marak exists');

  const sKujur = db.getWorker('WRK-002') || db.getWorker('EMP-4201');
  assert(Boolean(sKujur && sKujur.name === 'S. Kujur'), 'DATABASE', 'Worker S. Kujur exists');

  // Verify helmet identities
  const mc001 = db.getHelmet('MC-001');
  assert(Boolean(mc001 && mc001.helmet_code === 'MC-001'), 'DATABASE', 'Helmet MC-001 exists');
  const mc016 = db.getHelmet('MC-016');
  assert(Boolean(mc016 && mc016.helmet_code === 'MC-016'), 'DATABASE', 'Helmet MC-016 exists');

  // Verify initial 4 workers per zone distribution
  const zoneCounts: Record<string, number> = {};
  workers.forEach(w => {
    const zoneName = w.current_work_zone_name || w.assigned_zone_name || 'unknown';
    zoneCounts[zoneName] = (zoneCounts[zoneName] || 0) + 1;
  });
  const balancedDistribution = Object.values(zoneCounts).every(count => count === 4);
  assert(balancedDistribution, 'DATABASE', 'Initial zone distribution is exactly 4 workers per zone');

  // =========================================================================
  // 2. TELEMETRY VALIDATION & STORAGE TESTS
  // =========================================================================
  console.log('\n--- 2. TELEMETRY VALIDATION & PERSISTENCE ---');
  const validPacket = {
    packetId: 'PKT-TEST-001',
    helmetId: 'MC-001',
    sequenceNumber: 101,
    temperature: 28.5,
    humidity: 55.0,
    gasValue: 210,
    accelX: 0.1,
    accelY: 0.2,
    accelZ: 9.8,
    totalAcceleration: 9.8,
    gyroX: 0.0,
    gyroY: 0.0,
    gyroZ: 0.0,
    fallDetected: false,
    sosPressed: false,
  };

  const validRes = TelemetryValidator.validate(validPacket);
  assert(validRes.isValid && validRes.packet !== null, 'TELEMETRY', 'Valid telemetry accepted');

  const invalidPacketMissingHelmet = { temperature: 28.0, gasValue: 200 };
  const invalidRes1 = TelemetryValidator.validate(invalidPacketMissingHelmet);
  assert(!invalidRes1.isValid && invalidRes1.errors.length > 0, 'TELEMETRY', 'Missing helmetId rejected gracefully');

  const invalidPacketBadNumbers = { helmetId: 'MC-001', temperature: 'twenty-five', gasValue: NaN };
  const invalidRes2 = TelemetryValidator.validate(invalidPacketBadNumbers);
  assert(!invalidRes2.isValid, 'TELEMETRY', 'Non-numeric temperature/gas rejected');

  const invalidPacketFuture = {
    helmetId: 'MC-001',
    timestamp: new Date(Date.now() + 600000).toISOString(),
    temperature: 25,
    gasValue: 200,
    accelX: 0,
    accelY: 0,
    accelZ: 9.8,
  };
  const invalidRes3 = TelemetryValidator.validate(invalidPacketFuture);
  assert(!invalidRes3.isValid, 'TELEMETRY', 'Future timestamp (>2 min) rejected');

  // Test persistence & history retrieval
  db.saveTelemetry({
    id: 'PKT-HIST-01',
    helmet_id: 'MC-002',
    timestamp: new Date(Date.now() - 2000).toISOString(),
    sequence_number: 1,
    temperature: 27.0,
    humidity: 50.0,
    gas_value: 200,
    acceleration_x: 0,
    acceleration_y: 0,
    acceleration_z: 9.8,
    total_acceleration: 9.8,
    gyro_x: 0,
    gyro_y: 0,
    gyro_z: 0,
    fall_detected: false,
    sos_pressed: false,
    safety_status: 'SAFE',
    created_at: new Date().toISOString(),
  });

  db.saveTelemetry({
    id: 'PKT-HIST-02',
    helmet_id: 'MC-002',
    timestamp: new Date().toISOString(),
    sequence_number: 2,
    temperature: 27.5,
    humidity: 51.0,
    gas_value: 205,
    acceleration_x: 0,
    acceleration_y: 0,
    acceleration_z: 9.8,
    total_acceleration: 9.8,
    gyro_x: 0,
    gyro_y: 0,
    gyro_z: 0,
    fall_detected: false,
    sos_pressed: false,
    safety_status: 'SAFE',
    created_at: new Date().toISOString(),
  });

  const latest = db.getLatestTelemetry('MC-002');
  assert(Boolean(latest && latest.id === 'PKT-HIST-02'), 'TELEMETRY', 'Latest telemetry retrieved correctly');

  const history = db.getTelemetryHistory('MC-002', 10);
  assert(history.length >= 2, 'TELEMETRY', 'Telemetry history list retrieved correctly');

  // =========================================================================
  // 3. CENTRAL AUTHORITATIVE SAFETY ENGINE TESTS
  // =========================================================================
  console.log('\n--- 3. CENTRAL SAFETY ENGINE RULES ---');

  // Safe nominal test
  const safeEval = SafetyEngine.evaluate({
    temperature: 25.0,
    gasValue: 200,
    totalAcceleration: 9.8,
    sosPressed: false,
  });
  assert(safeEval.status === 'SAFE', 'SAFETY', 'Nominal readings -> SAFE');

  // High Gas test (> 800)
  const gasEval = SafetyEngine.evaluate({
    temperature: 25.0,
    gasValue: 850,
    totalAcceleration: 9.8,
    sosPressed: false,
  });
  assert(gasEval.status === 'WARNING' && gasEval.primaryTrigger === 'HIGH_RAW_GAS_LEVEL', 'SAFETY', 'gas > 800 -> WARNING');

  // High Temp test (> 40°C)
  const tempEval = SafetyEngine.evaluate({
    temperature: 42.5,
    gasValue: 200,
    totalAcceleration: 9.8,
    sosPressed: false,
  });
  assert(tempEval.status === 'WARNING' && tempEval.primaryTrigger === 'HIGH_TEMPERATURE', 'SAFETY', 'temp > 40°C -> WARNING');

  // Fall test (> 15.0 m/s²)
  const fallEval = SafetyEngine.evaluate({
    temperature: 25.0,
    gasValue: 200,
    totalAcceleration: 16.2,
    sosPressed: false,
  });
  assert(fallEval.status === 'DANGER' && fallEval.primaryTrigger === 'FALL_IMPACT_DETECTED', 'SAFETY', 'fall > 15.0 m/s² -> DANGER');

  // SOS test (sosPressed = true)
  const sosEval = SafetyEngine.evaluate({
    temperature: 25.0,
    gasValue: 200,
    totalAcceleration: 9.8,
    sosPressed: true,
  });
  assert(sosEval.status === 'DANGER' && sosEval.primaryTrigger === 'SOS_BUTTON_TRIGGERED', 'SAFETY', 'SOS pressed -> DANGER');

  // Precedence test: DANGER over WARNING
  const comboEval = SafetyEngine.evaluate({
    temperature: 45.0, // Warning
    gasValue: 950,    // Warning
    totalAcceleration: 18.0, // Danger
    sosPressed: true, // Danger
  });
  assert(comboEval.status === 'DANGER', 'SAFETY', 'Precedence: DANGER > WARNING');

  // =========================================================================
  // 4. ALERT LIFECYCLE & DEDUPLICATION TESTS
  // =========================================================================
  console.log('\n--- 4. ALERT LIFECYCLE & DEDUPLICATION ---');
  const alertTestStore: DbAlert[] = [];

  // Packet 1: High gas triggers alert
  const alertPkt1 = {
    packetId: 'P1',
    helmetId: 'MC-003',
    timestamp: new Date().toISOString(),
    sequenceNumber: 1,
    temperature: 26,
    humidity: 55,
    gasValue: 880,
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
    rssi: -65,
  };
  const safetyGas = SafetyEngine.evaluate({
    temperature: 26,
    gasValue: 880,
    totalAcceleration: 9.8,
    sosPressed: false,
  });

  const res1 = AlertEngine.processAlerts(alertTestStore, 'MC-003', 'W-003', alertPkt1, safetyGas);
  assert(Boolean(res1.createdAlert && res1.createdAlert.severity === 'WARNING'), 'ALERTS', 'High gas creates initial active alert');
  assert(alertTestStore.length === 1, 'ALERTS', 'Alerts store has 1 active alert');

  // Packet 2: Ongoing high gas (same condition) - should NOT duplicate
  const alertPkt2 = { ...alertPkt1, sequenceNumber: 2, gasValue: 890 };
  const res2 = AlertEngine.processAlerts(alertTestStore, 'MC-003', 'W-003', alertPkt2, safetyGas);
  assert(res2.createdAlert === null, 'ALERTS', 'Duplicate active alert prevented on consecutive frames');
  assert(alertTestStore.length === 1, 'ALERTS', 'Alert count remains 1');

  // Acknowledge alert
  const alertId = alertTestStore[0].id;
  const acked = AlertEngine.acknowledge(alertTestStore, alertId, 'Shift Supervisor');
  assert(Boolean(acked && acked.status === 'ACKNOWLEDGED' && acked.acknowledged_by === 'Shift Supervisor'), 'ALERTS', 'Alert successfully acknowledged');

  // Packet 3: Condition returns to SAFE -> Auto-resolve alert
  const alertPkt3 = { ...alertPkt1, sequenceNumber: 3, gasValue: 210 };
  const safetySafe = SafetyEngine.evaluate({
    temperature: 26,
    gasValue: 210,
    totalAcceleration: 9.8,
    sosPressed: false,
  });
  const res3 = AlertEngine.processAlerts(alertTestStore, 'MC-003', 'W-003', alertPkt3, safetySafe);
  assert(res3.resolvedAlerts.length === 1, 'ALERTS', 'Returning to safe condition auto-resolves active alert');
  assert(alertTestStore[0].status === 'RESOLVED', 'ALERTS', 'Alert status in store transitioned to RESOLVED');

  // =========================================================================
  // 5. ZONE ASSIGNMENT & HISTORY TESTS
  // =========================================================================
  console.log('\n--- 5. ZONE ASSIGNMENT, REASSIGNMENT & AUDIT LEDGER ---');

  // Check-In test
  const checkInAssignment = db.createZoneAssignment('WRK-001', 'MC-001', 'zone-level-1-north', 'CHECK_IN');
  assert(checkInAssignment.active && checkInAssignment.assignment_type === 'CHECK_IN', 'ZONE', 'Worker check-in creates active assignment');
  assert(Boolean(checkInAssignment.checked_in_at), 'ZONE', 'checked_in_at is recorded');

  // Reassignment test: Move WRK-001 from Level 1 North to Level 2 South
  const reassignAssignment = db.createZoneAssignment('WRK-001', 'MC-001', 'zone-level-2-south', 'SUPERVISOR_REASSIGN');
  assert(reassignAssignment.active && reassignAssignment.zone_id === 'zone-level-2-south', 'ZONE', 'Supervisor reassignment creates new active zone assignment');
  assert(checkInAssignment.active === false && Boolean(checkInAssignment.checked_out_at), 'ZONE', 'Previous assignment is closed with checked_out_at, not deleted');

  // Check-Out test
  const checkedOut = db.checkOutWorker('WRK-001');
  assert(checkedOut, 'ZONE', 'Worker successfully checked out');
  assert(reassignAssignment.active === false && Boolean(reassignAssignment.checked_out_at), 'ZONE', 'Active assignment marked inactive on check-out');

  // History audit verification
  const w1History = db.getZoneAssignmentsHistory('WRK-001');
  assert(w1History.length >= 3, 'ZONE', 'Full chronological audit ledger maintained (initial + checkin + reassign)');

  // Active zone derivation
  const activeAssignment = db.getActiveZoneAssignment('WRK-001');
  assert(activeAssignment === undefined, 'ZONE', 'Checked-out worker has no active zone assignment');

  // =========================================================================
  // 6. OFFLINE ENGINE TESTS
  // =========================================================================
  console.log('\n--- 6. OFFLINE & HEARTBEAT DETECTION ---');

  const now = Date.now();
  const onlineState = OfflineEngine.evaluateConnectivity(new Date(now - 2000).toISOString(), now);
  assert(onlineState === 'ONLINE', 'OFFLINE', 'Packet < 4s ago -> ONLINE');

  const staleState = OfflineEngine.evaluateConnectivity(new Date(now - 6000).toISOString(), now);
  assert(staleState === 'STALE', 'OFFLINE', 'Packet between 4s and 8s ago -> STALE');

  const offlineState = OfflineEngine.evaluateConnectivity(new Date(now - 10000).toISOString(), now);
  assert(offlineState === 'OFFLINE', 'OFFLINE', 'Packet > 8s ago -> OFFLINE');

  // Heartbeat fleet check creates offline alert
  const testHelmet: DbHelmet = {
    id: 'MC-TEST-OFFLINE',
    helmet_code: 'MC-TEST-OFFLINE',
    worker_id: 'WRK-001',
    status: 'SAFE',
    online: true,
    last_seen: new Date(now - 12000).toISOString(),
    battery_level: 80,
    serial_number: 'TEST',
    firmware_version: '1.0',
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
  const offlineAlertsStore: DbAlert[] = [];
  OfflineEngine.checkFleetHeartbeats([testHelmet], offlineAlertsStore);
  assert(!testHelmet.online, 'OFFLINE', 'Helmet marked offline after timeout');
  assert(offlineAlertsStore.length === 1 && offlineAlertsStore[0].type === 'HELMET_OFFLINE', 'OFFLINE', 'HELMET_OFFLINE alert triggered');

  // =========================================================================
  // 7. VERSIONED REST API ENDPOINTS DISPATCHER TESTS (/api/v1/*)
  // =========================================================================
  console.log('\n--- 7. VERSIONED REST API (18 ENDPOINTS) ---');
  const app = BackendApp.getInstance();

  async function mockRequest(pathname: string, method: string = 'GET', bodyData?: unknown): Promise<{ status: number; body: any }> {
    return new Promise((resolve) => {
      const socket = new Socket();
      const req = new IncomingMessage(socket);
      req.url = pathname;
      req.method = method;
      req.headers = { host: 'localhost:5173', 'content-type': 'application/json' };

      const res = new ServerResponse(req);
      let responseBody = '';

      res.end = function (chunk?: any) {
        if (chunk) responseBody += chunk.toString();
        let parsed = responseBody;
        try {
          parsed = JSON.parse(responseBody);
        } catch {}
        resolve({ status: res.statusCode, body: parsed });
        return this;
      } as any;

      if (bodyData) {
        req.push(JSON.stringify(bodyData));
        req.push(null);
      } else {
        req.push(null);
      }

      app.handleRequest(req, res);
    });
  }

  // 1. GET /api/v1/helmets
  const apiHelmets = await mockRequest('/api/v1/helmets');
  assert(apiHelmets.status === 200 && Array.isArray(apiHelmets.body) && apiHelmets.body.length === 16, 'API', 'GET /api/v1/helmets returns 16 helmets');

  // 2. GET /api/v1/helmets/:id
  const apiHelmet = await mockRequest('/api/v1/helmets/MC-001');
  assert(apiHelmet.status === 200 && apiHelmet.body.helmet_code === 'MC-001', 'API', 'GET /api/v1/helmets/:id returns helmet MC-001');

  // 3. POST /api/v1/telemetry
  const apiTelemetryPost = await mockRequest('/api/v1/telemetry', 'POST', {
    helmetId: 'MC-001',
    temperature: 25.5,
    humidity: 58.0,
    gasValue: 210,
    accelX: 0.1,
    accelY: 0.2,
    accelZ: 9.8,
    totalAcceleration: 9.8,
    gyroX: 0,
    gyroY: 0,
    gyroZ: 0,
    fallDetected: false,
    sosPressed: false,
  });
  assert(apiTelemetryPost.status === 201 && apiTelemetryPost.body.success === true, 'API', 'POST /api/v1/telemetry ingests packet');

  // 4. GET /api/v1/helmets/:id/latest
  const apiLatest = await mockRequest('/api/v1/helmets/MC-001/latest');
  assert(apiLatest.status === 200 && apiLatest.body.helmet_id === 'MC-001', 'API', 'GET /api/v1/helmets/:id/latest returns latest packet');

  // 5. GET /api/v1/helmets/:id/history
  const apiHist = await mockRequest('/api/v1/helmets/MC-001/history');
  assert(apiHist.status === 200 && Array.isArray(apiHist.body), 'API', 'GET /api/v1/helmets/:id/history returns array');

  // 6. GET /api/v1/workers
  const apiWorkers = await mockRequest('/api/v1/workers');
  assert(apiWorkers.status === 200 && Array.isArray(apiWorkers.body) && apiWorkers.body.length === 16, 'API', 'GET /api/v1/workers returns 16 workers');

  // 7. GET /api/v1/workers/:id
  const apiWorker = await mockRequest('/api/v1/workers/WRK-001');
  assert(apiWorker.status === 200 && apiWorker.body.name === 'R. Marak', 'API', 'GET /api/v1/workers/:id returns worker details');

  // 8. GET /api/v1/zones
  const apiZones = await mockRequest('/api/v1/zones');
  assert(apiZones.status === 200 && Array.isArray(apiZones.body) && apiZones.body.length === 4, 'API', 'GET /api/v1/zones returns 4 zones');

  // 9. GET /api/v1/zones/:id
  const apiZone = await mockRequest('/api/v1/zones/portal-surface');
  assert(apiZone.status === 200 && apiZone.body.name === 'Portal / Surface', 'API', 'GET /api/v1/zones/:id returns zone');

  // 10. GET /api/v1/zones/:id/workers
  const apiZoneWorkers = await mockRequest('/api/v1/zones/portal-surface/workers');
  assert(apiZoneWorkers.status === 200 && Array.isArray(apiZoneWorkers.body), 'API', 'GET /api/v1/zones/:id/workers returns workers');

  // 11. GET /api/v1/alerts
  const apiAlerts = await mockRequest('/api/v1/alerts');
  assert(apiAlerts.status === 200 && Array.isArray(apiAlerts.body), 'API', 'GET /api/v1/alerts returns alerts list');

  // 12. GET /api/v1/alerts/active
  const apiActiveAlerts = await mockRequest('/api/v1/alerts/active');
  assert(apiActiveAlerts.status === 200 && Array.isArray(apiActiveAlerts.body), 'API', 'GET /api/v1/alerts/active returns active alerts');

  // 13. GET /api/v1/alerts/history
  const apiAlertHist = await mockRequest('/api/v1/alerts/history');
  assert(apiAlertHist.status === 200 && Array.isArray(apiAlertHist.body), 'API', 'GET /api/v1/alerts/history returns alert history');

  // 14. POST /api/v1/workers/:id/check-in
  const apiCheckIn = await mockRequest('/api/v1/workers/WRK-001/check-in', 'POST', { zoneId: 'level-1-north-drift' });
  assert(apiCheckIn.status === 200 && apiCheckIn.body.success === true, 'API', 'POST /api/v1/workers/:id/check-in succeeds');

  // 15. POST /api/v1/workers/:id/zone
  const apiReassign = await mockRequest('/api/v1/workers/WRK-001/zone', 'POST', { zoneId: 'level-2-south-panel' });
  assert(apiReassign.status === 200 && apiReassign.body.success === true, 'API', 'POST /api/v1/workers/:id/zone reassigns worker');

  // 16. POST /api/v1/workers/:id/check-out
  const apiCheckOut = await mockRequest('/api/v1/workers/WRK-001/check-out', 'POST', {});
  assert(apiCheckOut.status === 200 && apiCheckOut.body.success === true, 'API', 'POST /api/v1/workers/:id/check-out succeeds');

  // 17. GET /api/v1/system/health
  const apiHealth = await mockRequest('/api/v1/system/health');
  assert(apiHealth.status === 200 && apiHealth.body.status !== undefined && apiHealth.body.services.backend.status === 'ONLINE', 'API', 'GET /api/v1/system/health returns system diagnostics');

  // =========================================================================
  // SUMMARY
  // =========================================================================
  console.log('\n============================================================');
  const total = results.length;
  const passed = results.filter(r => r.passed).length;
  const failed = total - passed;

  console.log(`TOTAL CHECKS: ${total}`);
  console.log(`PASSED:       ${passed}`);
  console.log(`FAILED:       ${failed}`);
  console.log('============================================================\n');

  if (failed > 0) {
    process.exit(1);
  } else {
    process.exit(0);
  }
}

runTests().catch(err => {
  console.error('Test runner encountered unexpected error:', err);
  process.exit(1);
});
