/**
 * MineCare - Phase 4 Comprehensive Test Suite
 * Real-Time Operations, Live Telemetry, Stateful Simulation, and RBAC Delivery
 */

import { DatabaseRepository } from '../src/backend/db/DatabaseRepository';
import { SafetyEngine } from '../src/backend/safety/SafetyEngine';
import { AlertEngine } from '../src/backend/alerts/AlertEngine';
import { OfflineEngine } from '../src/backend/offline/OfflineEngine';
import { RealtimePublisher, type PostgresChangesPayload } from '../src/backend/realtime/RealtimePublisher';
import { SupabaseRealtimeService } from '../src/services/realtime/SupabaseRealtimeService';
import { MockTelemetryProvider } from '../src/services/telemetry/MockTelemetryProvider';
import { ZoneAssignmentProvider } from '../src/services/zones/ZoneAssignmentProvider';
import type { DbAlert } from '../src/backend/types';

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

async function runPhase4Tests() {
  console.log('\n============================================================');
  console.log('MINECARE PHASE 4 - REAL-TIME OPERATIONS & TELEMETRY TEST SUITE');
  console.log('============================================================');

  const db = DatabaseRepository.getInstance();
  const realtimeService = SupabaseRealtimeService.getInstance();
  const publisher = RealtimePublisher.getInstance();

  // =========================================================================
  // 1. SUPABASE REALTIME SUBSCRIPTIONS & LIFECYCLE
  // =========================================================================
  console.log('\n--- 1. SUPABASE REALTIME SUBSCRIPTIONS & LIFECYCLE ---');

  // Subscription initialization
  realtimeService.connect();
  assert(
    realtimeService.getConnectionState() === 'CONNECTED' || realtimeService.getConnectionState() === 'CONNECTING',
    'REALTIME',
    'Realtime service initializes connection state'
  );

  let receivedTelemetryEvents: PostgresChangesPayload[] = [];
  let receivedHelmetEvents: PostgresChangesPayload[] = [];
  let receivedAlertEvents: PostgresChangesPayload[] = [];
  let receivedZoneEvents: PostgresChangesPayload[] = [];

  const unsubTel = realtimeService.subscribeTable('telemetry', (p) => receivedTelemetryEvents.push(p));
  const unsubHlm = realtimeService.subscribeTable('helmets', (p) => receivedHelmetEvents.push(p));
  const unsubAlt = realtimeService.subscribeTable('alerts', (p) => receivedAlertEvents.push(p));
  const unsubZon = realtimeService.subscribeTable('zone_assignments', (p) => receivedZoneEvents.push(p));

  // Telemetry publish & receive
  publisher.publish('telemetry', 'INSERT', {
    id: 'PKT-TEST-001',
    helmet_id: 'MC-001',
    timestamp: new Date().toISOString(),
    temperature: 26.5,
    gas_value: 210,
    safety_status: 'SAFE',
  });

  assert(receivedTelemetryEvents.length === 1, 'REALTIME', 'Telemetry INSERT event received by subscriber');
  assert(
    receivedTelemetryEvents[0].new.id === 'PKT-TEST-001',
    'REALTIME',
    'Received telemetry packet ID matches published packet'
  );

  // Helmet update publish & receive
  publisher.publish('helmets', 'UPDATE', {
    id: 'MC-001',
    status: 'WARNING',
    online: true,
  });

  assert(receivedHelmetEvents.length === 1, 'REALTIME', 'Helmet UPDATE event received by subscriber');
  assert(receivedHelmetEvents[0].new.status === 'WARNING', 'REALTIME', 'Received helmet status is WARNING');

  // Alert publish & receive
  publisher.publish('alerts', 'INSERT', {
    id: 'ALT-TEST-001',
    helmet_id: 'MC-001',
    type: 'GAS_HAZARD',
    severity: 'WARNING',
    status: 'TRIGGERED',
  });

  assert(receivedAlertEvents.length === 1, 'REALTIME', 'Alert INSERT event received by subscriber');

  // Zone assignment publish & receive
  publisher.publish('zone_assignments', 'INSERT', {
    id: 'ZA-TEST-001',
    worker_id: 'WRK-001',
    zone_id: 'zone-level-2-south-panel',
    active: true,
  });

  assert(receivedZoneEvents.length === 1, 'REALTIME', 'Zone assignment INSERT event received by subscriber');

  // Subscription cleanup test
  unsubTel();
  unsubHlm();
  unsubAlt();
  unsubZon();

  publisher.publish('telemetry', 'INSERT', {
    id: 'PKT-TEST-002',
    helmet_id: 'MC-001',
  });

  assert(receivedTelemetryEvents.length === 1, 'REALTIME', 'Unsubscribed listener does not receive new events (no memory leak)');

  // =========================================================================
  // 2. REALISTIC SIMULATION SCENARIOS (ALL 8 SCENARIOS)
  // =========================================================================
  console.log('\n--- 2. REALISTIC SIMULATION SCENARIOS ---');

  const provider = new MockTelemetryProvider();

  // 1. NORMAL / SAFE
  provider.triggerScenario('SAFE', 'MC-001');
  provider.tick();
  const safeEval = SafetyEngine.evaluate({
    temperature: 26.5,
    gasValue: 220,
    totalAcceleration: 9.8,
    sosPressed: false,
  });
  assert(safeEval.status === 'SAFE', 'SIMULATION', 'NORMAL scenario evaluates to SAFE baseline');

  // 2. HIGH TEMPERATURE (ramp: 32 -> 35 -> 38 -> 41 -> 43)
  provider.triggerScenario('HIGH_TEMPERATURE', 'MC-001');
  const tempAlertsStore: DbAlert[] = [];
  const tempSteps = [32.0, 35.0, 38.0, 41.0, 43.0];
  let tempTriggered = false;

  for (const t of tempSteps) {
    const evalT = SafetyEngine.evaluate({
      temperature: t,
      gasValue: 210,
      totalAcceleration: 9.8,
      sosPressed: false,
    });
    if (t > 40.0) {
      tempTriggered = evalT.status === 'WARNING';
      AlertEngine.processAlerts(
        tempAlertsStore,
        'MC-001',
        'WRK-001',
        { packetId: `P-${t}`, helmetId: 'MC-001', timestamp: new Date().toISOString(), sequenceNumber: 1, temperature: t, humidity: 55, gasValue: 210, accelX: 0, accelY: 0, accelZ: 9.8, totalAcceleration: 9.8, gyroX: 0, gyroY: 0, gyroZ: 0, fallDetected: false, sosPressed: false, batteryVolts: 4.1, rssi: -65 },
        evalT
      );
    }
  }
  assert(tempTriggered, 'SIMULATION', 'HIGH TEMPERATURE gradually climbs past 40°C -> WARNING');
  assert(
    tempAlertsStore.length === 1 && tempAlertsStore[0].type === 'HEAT_STRESS',
    'SIMULATION',
    'HEAT_STRESS alert created once temperature > 40°C'
  );

  // 3. HIGH GAS (ramp: 300 -> 450 -> 620 -> 790 -> 850 -> 910)
  provider.triggerScenario('HIGH_GAS', 'MC-001');
  const gasAlertsStore: DbAlert[] = [];
  const gasSteps = [300, 450, 620, 790, 850, 910];
  let gasTriggered = false;

  for (const g of gasSteps) {
    const evalG = SafetyEngine.evaluate({
      temperature: 26.0,
      gasValue: g,
      totalAcceleration: 9.8,
      sosPressed: false,
    });
    if (g > 800) {
      gasTriggered = evalG.status === 'WARNING';
      AlertEngine.processAlerts(
        gasAlertsStore,
        'MC-001',
        'WRK-001',
        { packetId: `P-${g}`, helmetId: 'MC-001', timestamp: new Date().toISOString(), sequenceNumber: 1, temperature: 26, humidity: 55, gasValue: g, accelX: 0, accelY: 0, accelZ: 9.8, totalAcceleration: 9.8, gyroX: 0, gyroY: 0, gyroZ: 0, fallDetected: false, sosPressed: false, batteryVolts: 4.1, rssi: -65 },
        evalG
      );
    }
  }
  assert(gasTriggered, 'SIMULATION', 'HIGH GAS gradually climbs past 800 raw ADC -> WARNING');
  assert(
    gasAlertsStore.length === 1 && gasAlertsStore[0].type === 'GAS_HAZARD',
    'SIMULATION',
    'GAS_HAZARD alert created once gasValue > 800 raw'
  );

  // 4. FALL (spike: 9.8 -> 10.1 -> 22.4 -> 18.1 -> 9.7)
  provider.triggerScenario('FALL_DETECTED', 'MC-001');
  const fallAlertsStore: DbAlert[] = [];
  const accelSteps = [9.8, 10.1, 22.4, 18.1, 9.7];
  let fallTriggered = false;

  for (const a of accelSteps) {
    const evalA = SafetyEngine.evaluate({
      temperature: 26.0,
      gasValue: 210,
      totalAcceleration: a,
      sosPressed: false,
    });
    if (a > 15.0) {
      fallTriggered = evalA.status === 'DANGER';
      AlertEngine.processAlerts(
        fallAlertsStore,
        'MC-001',
        'WRK-001',
        { packetId: `P-${a}`, helmetId: 'MC-001', timestamp: new Date().toISOString(), sequenceNumber: 1, temperature: 26, humidity: 55, gasValue: 210, accelX: 0, accelY: 0, accelZ: a, totalAcceleration: a, gyroX: 0, gyroY: 0, gyroZ: 0, fallDetected: true, sosPressed: false, batteryVolts: 4.1, rssi: -65 },
        evalA
      );
    }
  }
  assert(fallTriggered, 'SIMULATION', 'FALL acceleration spike (> 15.0 m/s²) evaluates to DANGER');
  assert(
    fallAlertsStore.length === 1 && fallAlertsStore[0].type === 'WORKER_FALL',
    'SIMULATION',
    'WORKER_FALL alert created on impact spike'
  );

  // 5. SOS
  provider.triggerScenario('SOS_ACTIVATED', 'MC-001');
  const sosEval = SafetyEngine.evaluate({
    temperature: 26.0,
    gasValue: 210,
    totalAcceleration: 9.8,
    sosPressed: true,
  });
  assert(sosEval.status === 'DANGER', 'SIMULATION', 'SOS pressed evaluates to DANGER');

  const sosAlertsStore: DbAlert[] = [];
  AlertEngine.processAlerts(
    sosAlertsStore,
    'MC-001',
    'WRK-001',
    { packetId: 'P-SOS', helmetId: 'MC-001', timestamp: new Date().toISOString(), sequenceNumber: 1, temperature: 26, humidity: 55, gasValue: 210, accelX: 0, accelY: 0, accelZ: 9.8, totalAcceleration: 9.8, gyroX: 0, gyroY: 0, gyroZ: 0, fallDetected: false, sosPressed: true, batteryVolts: 4.1, rssi: -65 },
    sosEval
  );
  assert(
    sosAlertsStore.length === 1 && sosAlertsStore[0].type === 'SOS_EMERGENCY',
    'SIMULATION',
    'SOS_EMERGENCY alert created'
  );

  // 6. MULTIPLE ALERTS (gas > 800 AND temp > 40°C AND SOS = true)
  provider.triggerScenario('MULTIPLE_ALERTS', 'MC-001');
  const multiEval = SafetyEngine.evaluate({
    temperature: 42.5,
    gasValue: 915,
    totalAcceleration: 9.8,
    sosPressed: true,
  });
  assert(multiEval.status === 'DANGER', 'SIMULATION', 'MULTIPLE ALERTS priority evaluates to DANGER');
  assert(multiEval.primaryTrigger === 'SOS_BUTTON_TRIGGERED' || multiEval.primaryTrigger === 'MULTIPLE_HAZARDS', 'SIMULATION', 'Compound trigger identified');

  // 7. RECOVERY (gas: 910 -> 650 -> 400 -> 250, temp: 43 -> 38 -> 31)
  const recoveryAlertsStore: DbAlert[] = [...gasAlertsStore];
  assert(recoveryAlertsStore.length > 0 && recoveryAlertsStore[0].status === 'TRIGGERED', 'SIMULATION', 'Active hazard alert exists prior to recovery');

  const recEval = SafetyEngine.evaluate({
    temperature: 26.5,
    gasValue: 220,
    totalAcceleration: 9.8,
    sosPressed: false,
  });
  assert(recEval.status === 'SAFE', 'SIMULATION', 'Normalized sensor values return status to SAFE');

  AlertEngine.processAlerts(
    recoveryAlertsStore,
    'MC-001',
    'WRK-001',
    { packetId: 'P-REC', helmetId: 'MC-001', timestamp: new Date().toISOString(), sequenceNumber: 1, temperature: 26.5, humidity: 55, gasValue: 220, accelX: 0, accelY: 0, accelZ: 9.8, totalAcceleration: 9.8, gyroX: 0, gyroY: 0, gyroZ: 0, fallDetected: false, sosPressed: false, batteryVolts: 4.1, rssi: -65 },
    recEval
  );
  assert(recoveryAlertsStore[0].status === 'RESOLVED', 'SIMULATION', 'Environmental alert auto-resolved upon SAFE recovery');

  // 8. OFFLINE SCENARIO
  provider.triggerScenario('HELMET_OFFLINE', 'MC-001');
  const nowMs = Date.now();
  const staleCheck = OfflineEngine.evaluateConnectivity(new Date(nowMs - 6000).toISOString(), nowMs);
  assert(staleCheck === 'STALE', 'SIMULATION', 'No packets for 4-8s evaluates to STALE');

  const offlineCheck = OfflineEngine.evaluateConnectivity(new Date(nowMs - 10000).toISOString(), nowMs);
  assert(offlineCheck === 'OFFLINE', 'SIMULATION', 'No packets for > 8s evaluates to OFFLINE');

  // =========================================================================
  // 3. OPERATIONAL STATE TRANSITIONS
  // =========================================================================
  console.log('\n--- 3. OPERATIONAL STATE TRANSITIONS ---');

  // SAFE → WARNING
  const s2w = SafetyEngine.evaluate({ temperature: 26, gasValue: 850, totalAcceleration: 9.8, sosPressed: false });
  assert(s2w.status === 'WARNING', 'STATE', 'SAFE → WARNING (gas > 800)');

  // SAFE → DANGER
  const s2d = SafetyEngine.evaluate({ temperature: 26, gasValue: 200, totalAcceleration: 18.5, sosPressed: false });
  assert(s2d.status === 'DANGER', 'STATE', 'SAFE → DANGER (accel > 15.0 m/s²)');

  // WARNING → SAFE
  const w2s = SafetyEngine.evaluate({ temperature: 26, gasValue: 350, totalAcceleration: 9.8, sosPressed: false });
  assert(w2s.status === 'SAFE', 'STATE', 'WARNING → SAFE (gas normalised)');

  // DANGER → SAFE
  const d2s = SafetyEngine.evaluate({ temperature: 26, gasValue: 200, totalAcceleration: 9.8, sosPressed: false });
  assert(d2s.status === 'SAFE', 'STATE', 'DANGER → SAFE (impact resolved)');

  // ONLINE → STALE
  const on2st = OfflineEngine.evaluateConnectivity(new Date(nowMs - 5000).toISOString(), nowMs);
  assert(on2st === 'STALE', 'STATE', 'ONLINE → STALE (5 seconds elapsed)');

  // STALE → OFFLINE
  const st2off = OfflineEngine.evaluateConnectivity(new Date(nowMs - 9000).toISOString(), nowMs);
  assert(st2off === 'OFFLINE', 'STATE', 'STALE → OFFLINE (9 seconds elapsed)');

  // OFFLINE → ONLINE
  const off2on = OfflineEngine.evaluateConnectivity(new Date(nowMs - 1000).toISOString(), nowMs);
  assert(off2on === 'ONLINE', 'STATE', 'OFFLINE → ONLINE (packet received 1s ago)');

  // =========================================================================
  // 4. ALERTS: DEDUPLICATION, ACKNOWLEDGEMENT, RESOLUTION & RECOVERY
  // =========================================================================
  console.log('\n--- 4. ALERTS LIFECYCLE & DEDUPLICATION ---');

  const dedupStore: DbAlert[] = [];
  const gasFrame = (gas: number, seq: number) => ({
    packetId: `PKT-${seq}`,
    helmetId: 'MC-005',
    timestamp: new Date().toISOString(),
    sequenceNumber: seq,
    temperature: 28,
    humidity: 55,
    gasValue: gas,
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
  });

  // Consecutive hazardous packets: 910 -> 920 -> 930 -> 915
  const gasSeq = [910, 920, 930, 915];
  gasSeq.forEach((g, i) => {
    const safety = SafetyEngine.evaluate({ temperature: 28, gasValue: g, totalAcceleration: 9.8, sosPressed: false });
    AlertEngine.processAlerts(dedupStore, 'MC-005', 'WRK-005', gasFrame(g, i + 1), safety);
  });

  assert(dedupStore.length === 1, 'ALERTS', 'Consecutive hazard frames (910, 920, 930, 915) maintain exactly 1 active alert');
  assert(dedupStore[0].readings_snapshot?.gas_value === 915, 'ALERTS', 'Ongoing active alert snapshot updated to latest frame');

  // Supervisor acknowledgement
  const ackAlert = AlertEngine.acknowledge(dedupStore, dedupStore[0].id, 'R. Supervisor');
  assert(ackAlert !== null && ackAlert.status === 'ACKNOWLEDGED', 'ALERTS', 'Supervisor successfully acknowledges alert');
  assert(ackAlert?.acknowledged_by === 'R. Supervisor', 'ALERTS', 'Acknowledged supervisor recorded');

  // Supervisor resolution
  const resAlert = AlertEngine.resolve(dedupStore, dedupStore[0].id, 'Ventilation verified safe');
  assert(resAlert !== null && resAlert.status === 'RESOLVED', 'ALERTS', 'Supervisor successfully resolves alert');
  assert(resAlert?.supervisor_notes === 'Ventilation verified safe', 'ALERTS', 'Resolution notes recorded');

  // =========================================================================
  // 5. ZONE: CHECK-IN, CHECK-OUT, REASSIGNMENT & OCCUPANCY
  // =========================================================================
  console.log('\n--- 5. ZONE OPERATIONS & OCCUPANCY ---');

  const zoneProvider = ZoneAssignmentProvider.getInstance();
  const helmetsInitial = db.getHelmets().map(h => ({
    helmetId: h.id,
    serialNumber: h.serial_number || '',
    firmwareVersion: h.firmware_version,
    assignedWorkerId: h.worker_id,
    assignedShaft: 'Portal / Surface',
    assignedZone: 'Portal / Surface',
    currentWorkZone: 'Portal / Surface',
    connectivity: 'ONLINE' as const,
    lastHeartbeat: new Date().toISOString(),
    telemetry: {} as any,
    safety: { status: 'SAFE' as const, primaryTrigger: 'NORMAL', triggerDetails: [], outputs: {} as any, sensorHealth: {} as any },
  }));

  // Initial zone occupancy check: 4 workers per zone
  const initialOccupancy = zoneProvider.getZoneOccupancies(helmetsInitial);
  const northDrift = initialOccupancy.find(z => z.zoneName.includes('North Drift'));
  assert(northDrift !== undefined, 'ZONE', 'Level 1 - North Drift zone exists');
  assert(northDrift?.workerCount === 4, 'ZONE', 'Initial North Drift has exactly 4 workers');
  assert(northDrift?.safeCount === 4, 'ZONE', 'Initial North Drift safeCount is 4');

  // Check-out realtime update
  zoneProvider.applyRealtimeAssignment({
    worker_id: 'WRK-001',
    active: false,
  });
  const afterCheckoutOccupancy = zoneProvider.getZoneOccupancies(helmetsInitial);
  const northDriftAfterCheckout = afterCheckoutOccupancy.find(z => z.zoneName.includes('North Drift'));
  assert(northDriftAfterCheckout?.workerCount === 3, 'ZONE', 'Worker check-out decrements zone workerCount to 3');

  // Check-in realtime update
  zoneProvider.applyRealtimeAssignment({
    worker_id: 'WRK-001',
    zone_id: 'zone-level-1-north-drift',
    active: true,
  });
  const afterCheckinOccupancy = zoneProvider.getZoneOccupancies(helmetsInitial);
  const northDriftAfterCheckin = afterCheckinOccupancy.find(z => z.zoneName.includes('North Drift'));
  assert(northDriftAfterCheckin?.workerCount === 4, 'ZONE', 'Worker check-in restores zone workerCount to 4');

  // Dynamic Occupancy Safety Breakdown: MC-009 → DANGER
  // e.g. North Drift: SAFE 4 -> SAFE 3, DANGER 1
  const helmetsWithDanger = helmetsInitial.map(h => {
    if (h.helmetId === 'MC-009') {
      return {
        ...h,
        safety: { ...h.safety, status: 'DANGER' as const },
      };
    }
    return h;
  });

  const dangerOccupancy = zoneProvider.getZoneOccupancies(helmetsWithDanger);
  const northDriftWithDanger = dangerOccupancy.find(z => z.zoneName.includes('North Drift'));
  assert(northDriftWithDanger?.workerCount === 4, 'ZONE', 'North Drift total workerCount remains 4');
  assert(northDriftWithDanger?.safeCount === 3, 'ZONE', 'North Drift safeCount dynamically becomes 3');
  assert(northDriftWithDanger?.dangerCount === 1, 'ZONE', 'North Drift dangerCount dynamically becomes 1 (MC-009 -> DANGER)');

  // Supervisor Reassignment
  zoneProvider.applyRealtimeAssignment({
    worker_id: 'WRK-001',
    zone_id: 'zone-level-3-haul-road',
    active: true,
  });
  const afterReassignOccupancy = zoneProvider.getZoneOccupancies(helmetsInitial);
  const haulRoad = afterReassignOccupancy.find(z => z.zoneName.includes('Haul Road'));
  assert(haulRoad?.workerCount === 5, 'ZONE', 'Supervisor reassignment updates destination zone occupancy to 5');

  // Restore WRK-001 back to North Drift for clean state
  zoneProvider.applyRealtimeAssignment({
    worker_id: 'WRK-001',
    zone_id: 'zone-level-1-north-drift',
    active: true,
  });

  // =========================================================================
  // 6. ROLE AWARENESS & WORKER AUTHORIZATION ISOLATION
  // =========================================================================
  console.log('\n--- 6. ROLE AWARENESS & WORKER ISOLATION ---');

  // Worker client: WRK-001 (assigned helmet MC-001)
  const workerService = SupabaseRealtimeService.getInstance();
  workerService.setUser({
    role: 'WORKER',
    worker_id: 'WRK-001',
    assignedHelmetId: 'MC-001',
  });

  // Test 1: Worker's own telemetry packet is accepted
  const workerOwnTelemetry: PostgresChangesPayload = {
    schema: 'public',
    table: 'telemetry',
    eventType: 'INSERT',
    new: { id: 'PKT-W1', helmet_id: 'MC-001', temperature: 26 },
    old: null,
    commit_timestamp: new Date().toISOString(),
  };
  assert(
    workerService.isPayloadAuthorized(workerOwnTelemetry),
    'AUTHORIZATION',
    'Worker client receives own helmet telemetry (MC-001)'
  );

  // Test 2: Foreign telemetry packet (MC-002) is rejected/dropped
  const foreignTelemetry: PostgresChangesPayload = {
    schema: 'public',
    table: 'telemetry',
    eventType: 'INSERT',
    new: { id: 'PKT-W2', helmet_id: 'MC-002', temperature: 29 },
    old: null,
    commit_timestamp: new Date().toISOString(),
  };
  assert(
    !workerService.isPayloadAuthorized(foreignTelemetry),
    'AUTHORIZATION',
    'Worker client drops foreign helmet telemetry (MC-002)'
  );

  // Test 3: Foreign helmet status update (MC-005) is rejected
  const foreignHelmet: PostgresChangesPayload = {
    schema: 'public',
    table: 'helmets',
    eventType: 'UPDATE',
    new: { id: 'MC-005', status: 'WARNING' },
    old: null,
    commit_timestamp: new Date().toISOString(),
  };
  assert(
    !workerService.isPayloadAuthorized(foreignHelmet),
    'AUTHORIZATION',
    'Worker client drops foreign helmet updates (MC-005)'
  );

  // Test 4: Worker's own alert is accepted
  const workerOwnAlert: PostgresChangesPayload = {
    schema: 'public',
    table: 'alerts',
    eventType: 'INSERT',
    new: { id: 'ALT-W1', worker_id: 'WRK-001', helmet_id: 'MC-001', severity: 'WARNING' },
    old: null,
    commit_timestamp: new Date().toISOString(),
  };
  assert(
    workerService.isPayloadAuthorized(workerOwnAlert),
    'AUTHORIZATION',
    'Worker client receives own alert (WRK-001)'
  );

  // Test 5: Foreign worker's alert is rejected
  const foreignAlert: PostgresChangesPayload = {
    schema: 'public',
    table: 'alerts',
    eventType: 'INSERT',
    new: { id: 'ALT-W2', worker_id: 'WRK-002', helmet_id: 'MC-002', severity: 'CRITICAL' },
    old: null,
    commit_timestamp: new Date().toISOString(),
  };
  assert(
    !workerService.isPayloadAuthorized(foreignAlert),
    'AUTHORIZATION',
    'Worker client drops foreign worker alert (WRK-002)'
  );

  // Test 6: Foreign worker's zone assignment is rejected
  const foreignAssignment: PostgresChangesPayload = {
    schema: 'public',
    table: 'zone_assignments',
    eventType: 'INSERT',
    new: { id: 'ZA-W3', worker_id: 'WRK-003', zone_id: 'zone-portal-surface', active: true },
    old: null,
    commit_timestamp: new Date().toISOString(),
  };
  assert(
    !workerService.isPayloadAuthorized(foreignAssignment),
    'AUTHORIZATION',
    'Worker client drops foreign worker zone assignments (WRK-003)'
  );

  // Test 7: Supervisor client receives all operational events
  workerService.setUser({
    role: 'SUPERVISOR',
    worker_id: null,
  });
  assert(
    workerService.isPayloadAuthorized(foreignTelemetry),
    'AUTHORIZATION',
    'Supervisor client authorized to receive all fleet telemetry'
  );
  assert(
    workerService.isPayloadAuthorized(foreignAlert),
    'AUTHORIZATION',
    'Supervisor client authorized to receive all fleet alerts'
  );

  // Clean disconnect
  realtimeService.disconnect();
  assert(
    realtimeService.getConnectionState() === 'DISCONNECTED',
    'REALTIME',
    'Realtime service cleanly disconnected on teardown'
  );

  console.log('\n============================================================');
  console.log(`TOTAL PHASE 4 CHECKS: ${totalChecks}`);
  console.log(`PASSED:               ${passedChecks}`);
  console.log(`FAILED:               ${totalChecks - passedChecks}`);
  console.log('============================================================\n');

  if (totalChecks !== passedChecks) {
    process.exit(1);
  }
}

runPhase4Tests().catch((err) => {
  console.error('Test execution error:', err);
  process.exit(1);
});
