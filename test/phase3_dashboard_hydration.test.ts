/**
 * MineCare - Phase 3 Real Dashboard Data Hydration Test Suite
 *
 * Automated verification of Phase 3 requirements:
 * 1. Initial dashboard load retrieves actual persisted telemetry from database/backend
 * 2. Helmets with no saved telemetry display NO DATA (no synthetic placeholder packets)
 * 3. Offline helmets do not appear online because of placeholder state
 * 4. Telemetry age determines freshness: ONLINE (<4s), STALE (4-8s), OFFLINE (>8s)
 * 5. Sensor faults from Phase 2 (dhtValid: false, mpuValid: false) remain visible as SENSOR_FAULT
 * 6. Real readings update when realtime events arrive
 * 7. Race-condition guard: Older initial API responses cannot overwrite newer realtime readings
 * 8. Both active alerts and resolved alert history load without duplicates
 * 9. API failures produce explicit ERROR state rather than fake normal data
 * 10. Realtime subscriptions, reconnection reconciliation, and cleanup lifecycle are preserved
 */

process.env.NODE_ENV = 'test';

import { TelemetryService } from '../src/services/telemetry/TelemetryService';
import { helmetService } from '../src/services/api/helmetService';
import { alertService } from '../src/services/api/alertService';
import type { DbAlert, DbHelmet, DbTelemetry } from '../src/backend/types';

let totalTests = 0;
let passedTests = 0;

function assert(condition: boolean, category: string, description: string, detail?: string) {
  totalTests++;
  if (condition) {
    passedTests++;
    console.log(`  ✓ [${category}] ${description}`);
  } else {
    console.error(`  ✗ [${category}] FAILED: ${description}${detail ? ` (${detail})` : ''}`);
    process.exitCode = 1;
  }
}

async function runPhase3Tests() {
  console.log('\n============================================================');
  console.log('MINECARE PHASE 3 — REAL DASHBOARD DATA HYDRATION TEST SUITE');
  console.log('============================================================\n');

  // =========================================================================
  // TEST 1: NO SYNTHETIC PLACEHOLDERS ON INITIALIZATION
  // =========================================================================
  console.log('--- 1. INITIAL STATE & EMPTY NO-DATA CONTRACT ---');

  // Reset instance to clean slate
  TelemetryService.resetInstance();

  // Mock helmetService and alertService to control initial load responses
  const originalGetHelmets = helmetService.getHelmets;
  const originalGetLatestTelemetry = helmetService.getLatestTelemetry;
  const originalGetTelemetryHistory = helmetService.getTelemetryHistory;
  const originalGetActiveAlerts = alertService.getActiveAlerts;
  const originalGetAlertHistory = alertService.getAlertHistory;

  const mockDbHelmets: DbHelmet[] = [
    {
      id: 'MC-001',
      serial_number: 'SN-MC-001',
      worker_id: 'WRK-001',
      status: 'SAFE',
      online: true,
      last_seen: new Date(Date.now() - 2000).toISOString(),
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    },
    {
      id: 'MC-002',
      serial_number: 'SN-MC-002',
      worker_id: 'WRK-002',
      status: 'SAFE',
      online: false,
      last_seen: new Date(Date.now() - 30000).toISOString(),
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    },
    {
      id: 'MC-003',
      serial_number: 'SN-MC-003',
      worker_id: 'WRK-003',
      status: 'SAFE',
      online: false,
      last_seen: null,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    },
    {
      id: 'MC-004',
      serial_number: 'SN-MC-004',
      worker_id: 'WRK-004',
      status: 'SAFE',
      online: true,
      last_seen: new Date(Date.now() - 6000).toISOString(), // 6s old -> STALE
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    },
    {
      id: 'MC-005',
      serial_number: 'SN-MC-005',
      worker_id: 'WRK-005',
      status: 'SAFE',
      online: true,
      last_seen: new Date(Date.now() - 1000).toISOString(),
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    },
  ];

  const nowMs = Date.now();
  const mockTelemetryMC001: DbTelemetry = {
    id: 'PKT-DB-001',
    helmet_id: 'MC-001',
    timestamp: new Date(nowMs - 1500).toISOString(), // 1.5s old -> ONLINE
    sequence_number: 55,
    temperature: 31.8,
    humidity: 68.2,
    gas_value: 410,
    acceleration_x: 0.1,
    acceleration_y: 0.2,
    acceleration_z: 9.81,
    total_acceleration: 9.81,
    gyro_x: 0,
    gyro_y: 0,
    gyro_z: 0,
    fall_detected: false,
    sos_pressed: false,
    dht_valid: true,
    mpu_valid: true,
    safety_status: 'SAFE',
    created_at: new Date(nowMs - 1500).toISOString(),
  };

  const mockTelemetryMC002: DbTelemetry = {
    id: 'PKT-DB-002',
    helmet_id: 'MC-002',
    timestamp: new Date(nowMs - 35000).toISOString(), // 35s old -> OFFLINE
    sequence_number: 12,
    temperature: 28.4,
    humidity: 55.0,
    gas_value: 300,
    acceleration_x: 0.0,
    acceleration_y: 0.0,
    acceleration_z: 9.81,
    total_acceleration: 9.81,
    gyro_x: 0,
    gyro_y: 0,
    gyro_z: 0,
    fall_detected: false,
    sos_pressed: false,
    dht_valid: true,
    mpu_valid: true,
    safety_status: 'SAFE',
    created_at: new Date(nowMs - 35000).toISOString(),
  };

  const mockTelemetryMC004: DbTelemetry = {
    id: 'PKT-DB-004',
    helmet_id: 'MC-004',
    timestamp: new Date(nowMs - 6000).toISOString(), // 6s old -> STALE
    sequence_number: 80,
    temperature: 29.5,
    humidity: 62.0,
    gas_value: 520,
    acceleration_x: 0.05,
    acceleration_y: 0.1,
    acceleration_z: 9.81,
    total_acceleration: 9.81,
    gyro_x: 0,
    gyro_y: 0,
    gyro_z: 0,
    fall_detected: false,
    sos_pressed: false,
    dht_valid: true,
    mpu_valid: true,
    safety_status: 'SAFE',
    created_at: new Date(nowMs - 6000).toISOString(),
  };

  // MC-005 has a Phase 2 sensor fault persisted in database (DHT offline)
  const mockTelemetryMC005: DbTelemetry = {
    id: 'PKT-DB-005',
    helmet_id: 'MC-005',
    timestamp: new Date(nowMs - 1000).toISOString(),
    sequence_number: 99,
    temperature: -999.0,
    humidity: -999.0,
    gas_value: 230,
    acceleration_x: 0.0,
    acceleration_y: 0.0,
    acceleration_z: 9.81,
    total_acceleration: 9.81,
    gyro_x: 0,
    gyro_y: 0,
    gyro_z: 0,
    fall_detected: false,
    sos_pressed: false,
    dht_valid: false, // DHT22 FAULT
    mpu_valid: true,
    safety_status: 'SENSOR_FAULT',
    created_at: new Date(nowMs - 1000).toISOString(),
  };

  // Setup service mocks
  helmetService.getHelmets = async () => mockDbHelmets;
  helmetService.getLatestTelemetry = async (id: string) => {
    if (id === 'MC-001') return mockTelemetryMC001;
    if (id === 'MC-002') return mockTelemetryMC002;
    if (id === 'MC-004') return mockTelemetryMC004;
    if (id === 'MC-005') return mockTelemetryMC005;
    if (id === 'MC-003') {
      const err: any = new Error('No telemetry recorded for helmet MC-003');
      err.status = 404;
      throw err;
    }
    if (id === 'MC-ERROR') {
      const err: any = new Error('Network error or 500 Internal Server Error');
      err.status = 500;
      throw err;
    }
    const err: any = new Error('Not found');
    err.status = 404;
    throw err;
  };
  helmetService.getTelemetryHistory = async () => [];

  // Alerts: Mock active alert and resolved historical alert
  const mockActiveAlert: DbAlert = {
    id: 'ALT-ACTIVE-001',
    helmet_id: 'MC-005',
    worker_id: 'WRK-005',
    type: 'SENSOR_FAULT',
    severity: 'WARNING',
    message: 'DHT22 Temperature/Humidity Sensor Offline',
    status: 'TRIGGERED',
    triggered_at: new Date(nowMs - 1000).toISOString(),
    acknowledged_at: null,
    acknowledged_by: null,
    resolved_at: null,
    supervisor_notes: null,
    readings_snapshot: {
      temperature: -999,
      humidity: -999,
      gas_value: 230,
      total_acceleration: 9.81,
      sos_pressed: false,
      fall_detected: false,
      dht_valid: false,
      mpu_valid: true,
    },
    created_at: new Date(nowMs - 1000).toISOString(),
    updated_at: new Date(nowMs - 1000).toISOString(),
  };

  const mockResolvedAlert: DbAlert = {
    id: 'ALT-RESOLVED-001',
    helmet_id: 'MC-001',
    worker_id: 'WRK-001',
    type: 'GAS_HAZARD',
    severity: 'WARNING',
    message: 'Raw Gas ADC > 800',
    status: 'RESOLVED',
    triggered_at: new Date(nowMs - 7200000).toISOString(), // 2 hours ago
    acknowledged_at: new Date(nowMs - 7100000).toISOString(),
    acknowledged_by: 'Shift Supervisor',
    resolved_at: new Date(nowMs - 7000000).toISOString(),
    supervisor_notes: 'Ventilation purged chamber; readings nominal',
    readings_snapshot: {
      temperature: 28,
      humidity: 60,
      gas_value: 890,
      total_acceleration: 9.81,
      sos_pressed: false,
      fall_detected: false,
      dht_valid: true,
      mpu_valid: true,
    },
    created_at: new Date(nowMs - 7200000).toISOString(),
    updated_at: new Date(nowMs - 7000000).toISOString(),
  };

  alertService.getActiveAlerts = async () => [mockActiveAlert];
  alertService.getAlertHistory = async () => [mockResolvedAlert];

  // Initialize service
  const service = TelemetryService.getInstance();

  // Await initial hydration
  await service.loadInitialState();

  // 1.1 Verify MC-001 hydrated with real database values (not placeholders)
  const h1 = service.getHelmet('MC-001');
  assert(Boolean(h1), 'HYDRATION', 'Helmet MC-001 retrieved from TelemetryService');
  assert(h1?.hasData === true, 'HYDRATION', 'MC-001 hasData is true after database hydration');
  assert(h1?.telemetrySource === 'DATABASE', 'HYDRATION', 'MC-001 telemetrySource is DATABASE');
  assert(h1?.telemetry?.dht22.temperature === 31.8, 'HYDRATION', 'MC-001 temperature is 31.8°C (actual DB value, not 26.5°C placeholder)');
  assert(h1?.telemetry?.dht22.humidity === 68.2, 'HYDRATION', 'MC-001 humidity is 68.2% (actual DB value, not 60% placeholder)');
  assert(h1?.telemetry?.mq2.rawGasValue === 410, 'HYDRATION', 'MC-001 raw gas is 410 ADC (actual DB value, not 220 ADC placeholder)');
  assert(h1?.connectivity === 'ONLINE', 'HYDRATION', 'MC-001 fresh telemetry (<4s) evaluated as ONLINE');

  // 1.2 Verify MC-003 with NO database records shows NO DATA empty state
  const h3 = service.getHelmet('MC-003');
  assert(Boolean(h3), 'EMPTY_STATE', 'Helmet MC-003 retrieved from TelemetryService');
  assert(h3?.hasData === false, 'EMPTY_STATE', 'MC-003 hasData is false (no telemetry history)');
  assert(h3?.telemetry === null, 'EMPTY_STATE', 'MC-003 telemetry packet is null (no fake normal packet instantiated)');
  assert(h3?.telemetrySource === 'NO_DATA', 'EMPTY_STATE', 'MC-003 telemetrySource is NO_DATA');
  assert(h3?.connectivity === 'OFFLINE', 'EMPTY_STATE', 'MC-003 with no data marked OFFLINE');

  // =========================================================================
  // TEST 2: HELMET STATUS & FRESHNESS INDICATORS
  // =========================================================================
  console.log('\n--- 2. FRESHNESS & CONNECTIVITY EVALUATION ---');

  // 2.1 MC-004: Telemetry 6s old -> STALE
  const h4 = service.getHelmet('MC-004');
  assert(Boolean(h4), 'FRESHNESS', 'Helmet MC-004 retrieved');
  assert(h4?.connectivity === 'STALE', 'FRESHNESS', 'Telemetry received 6s ago evaluated as STALE (4-8s threshold)');
  assert(h4?.hasData === true, 'FRESHNESS', 'MC-004 retains persisted readings (not blanked out)');
  assert(h4?.telemetry?.dht22.temperature === 29.5, 'FRESHNESS', 'MC-004 displays actual last recorded temperature 29.5°C');

  // 2.2 MC-002: Telemetry 35s old -> OFFLINE with last recorded values
  const h2 = service.getHelmet('MC-002');
  assert(Boolean(h2), 'FRESHNESS', 'Helmet MC-002 retrieved');
  assert(h2?.connectivity === 'OFFLINE', 'FRESHNESS', 'Telemetry older than 8s evaluated as OFFLINE');
  assert(h2?.hasData === true, 'FRESHNESS', 'Offline helmet retains last known persisted measurement');
  assert(h2?.telemetry?.mq2.rawGasValue === 300, 'FRESHNESS', 'Offline helmet displays actual last gas measurement (300 ADC)');
  assert(h2?.lastHeartbeat === mockTelemetryMC002.timestamp, 'FRESHNESS', 'Offline helmet displays actual last heartbeat timestamp');

  // =========================================================================
  // TEST 3: SENSOR FAULT PRESERVATION (PHASE 2 COMPATIBILITY)
  // =========================================================================
  console.log('\n--- 3. SENSOR FAULT PRESERVATION ---');

  const h5 = service.getHelmet('MC-005');
  assert(Boolean(h5), 'SENSOR_FAULT', 'Helmet MC-005 retrieved');
  assert(h5?.safety.status === 'SENSOR_FAULT', 'SENSOR_FAULT', 'Phase 2 SENSOR_FAULT preserved (not masked as SAFE)');
  assert(h5?.telemetry?.sensorHealth?.dht22 === false, 'SENSOR_FAULT', 'sensorHealth.dht22 accurately reflects false');
  assert(h5?.telemetry?.sensorHealth?.mpu6050 === true, 'SENSOR_FAULT', 'sensorHealth.mpu6050 accurately reflects true');
  assert(h5?.safety.triggerDetails.some((d) => d.includes('DHT22')), 'SENSOR_FAULT', 'Trigger details specify DHT22 fault');

  // =========================================================================
  // TEST 4: REALTIME STREAMING & RACE CONDITION GUARDS
  // =========================================================================
  console.log('\n--- 4. REALTIME UPDATES & RACE CONDITION GUARDS ---');

  // 4.1 Realtime event updates MC-001
  const realtimePacketTime = nowMs + 1000;
  const newRealtimePacket: DbTelemetry = {
    id: 'PKT-RT-001',
    helmet_id: 'MC-001',
    timestamp: new Date(realtimePacketTime).toISOString(),
    sequence_number: 56,
    temperature: 33.2,
    humidity: 71.0,
    gas_value: 450,
    acceleration_x: 0.1,
    acceleration_y: 0.2,
    acceleration_z: 9.81,
    total_acceleration: 9.81,
    gyro_x: 0,
    gyro_y: 0,
    gyro_z: 0,
    fall_detected: false,
    sos_pressed: false,
    dht_valid: true,
    mpu_valid: true,
    safety_status: 'SAFE',
    created_at: new Date(realtimePacketTime).toISOString(),
  };

  service.handleRealtimeTelemetry(newRealtimePacket);
  const h1Updated = service.getHelmet('MC-001');
  assert(h1Updated?.telemetry?.dht22.temperature === 33.2, 'REALTIME', 'Realtime telemetry event updates helmet reading to 33.2°C');

  // 4.2 Race condition guard: Older delayed initial response MUST NOT overwrite newer realtime update
  const staleDelayedResponse: DbTelemetry = {
    id: 'PKT-DELAYED-OLD',
    helmet_id: 'MC-001',
    timestamp: new Date(nowMs - 5000).toISOString(), // 5s OLDER than the realtime packet
    sequence_number: 50,
    temperature: 20.0,
    humidity: 40.0,
    gas_value: 100,
    acceleration_x: 0.0,
    acceleration_y: 0.0,
    acceleration_z: 9.81,
    total_acceleration: 9.81,
    gyro_x: 0,
    gyro_y: 0,
    gyro_z: 0,
    fall_detected: false,
    sos_pressed: false,
    dht_valid: true,
    mpu_valid: true,
    safety_status: 'SAFE',
    created_at: new Date(nowMs - 5000).toISOString(),
  };

  // Attempting to deliver older packet via handleRealtimeTelemetry
  service.handleRealtimeTelemetry(staleDelayedResponse);
  const h1Protected = service.getHelmet('MC-001');
  assert(
    h1Protected?.telemetry?.dht22.temperature === 33.2,
    'RACE_GUARD',
    'Older packet (timestamp older than current latest) rejected; reading remains 33.2°C'
  );

  // =========================================================================
  // TEST 5: ALERT HISTORY LOADING & DEDUPLICATION
  // =========================================================================
  console.log('\n--- 5. ALERT HISTORY & DEDUPLICATION ---');

  const alerts = service.getAlerts();
  assert(alerts.length >= 2, 'ALERTS', 'Both active and resolved alerts loaded in TelemetryService');
  const hasActive = alerts.some((a) => a.id === 'ALT-ACTIVE-001' && !a.resolved);
  const hasResolved = alerts.some((a) => a.id === 'ALT-RESOLVED-001' && a.resolved);
  assert(hasActive, 'ALERTS', 'Active alert ALT-ACTIVE-001 present and marked active');
  assert(hasResolved, 'ALERTS', 'Resolved alert ALT-RESOLVED-001 present and marked resolved');
  assert(
    alerts.find((a) => a.id === 'ALT-RESOLVED-001')?.supervisorNotes === 'Ventilation purged chamber; readings nominal',
    'ALERTS',
    'Supervisor resolution notes preserved from database'
  );

  // Re-run initial load: alerts should not duplicate
  await service.loadInitialState();
  const alertsAfterReload = service.getAlerts();
  const activeCount = alertsAfterReload.filter((a) => a.id === 'ALT-ACTIVE-001').length;
  const resolvedCount = alertsAfterReload.filter((a) => a.id === 'ALT-RESOLVED-001').length;
  assert(activeCount === 1, 'ALERTS_DEDUP', 'Active alert not duplicated across re-hydrations');
  assert(resolvedCount === 1, 'ALERTS_DEDUP', 'Resolved alert not duplicated across re-hydrations');

  // =========================================================================
  // TEST 6: API FAILURE HANDLING (NO FAKE NORMAL VALUES)
  // =========================================================================
  console.log('\n--- 6. API FAILURE & ERROR ENVELOPE STATES ---');

  mockDbHelmets.push({
    id: 'MC-ERROR',
    serial_number: 'SN-MC-ERR',
    worker_id: null,
    status: 'SAFE',
    online: true,
    last_seen: new Date().toISOString(),
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  });

  await service.loadInitialState();
  const errorHelmet = service.getHelmet('MC-ERROR');
  assert(Boolean(errorHelmet), 'ERROR_HANDLING', 'Error helmet MC-ERROR registered');
  assert(errorHelmet?.dataLoadingState === 'ERROR', 'ERROR_HANDLING', 'API 500 error produces explicit ERROR state');
  assert(Boolean(errorHelmet?.errorMessage), 'ERROR_HANDLING', 'Error message recorded on helmet object');
  assert(errorHelmet?.hasData === false, 'ERROR_HANDLING', 'Failed helmet does not fabricate hasData: true');
  assert(errorHelmet?.telemetry === null, 'ERROR_HANDLING', 'Failed helmet NEVER silently substitutes fake normal readings');

  // =========================================================================
  // TEST 7: REALTIME RECONNECTION RECONCILIATION & CLEANUP
  // =========================================================================
  console.log('\n--- 7. REALTIME RECONNECTION RECONCILIATION & LIFECYCLE ---');

  assert(service.getActiveSubscriptionCount() === 4, 'LIFECYCLE', 'Exactly 4 operational realtime table subscriptions active');

  // Trigger state reconciliation (as happens on Realtime CONNECTED event)
  let reconciled = false;
  try {
    await service.reconcileBackendState();
    reconciled = true;
  } catch {
    reconciled = false;
  }
  assert(reconciled, 'RECONCILIATION', 'reconcileBackendState() completes without error');

  // Clean cleanup
  service.cleanup();
  assert(service.getActiveSubscriptionCount() === 0, 'LIFECYCLE', 'Subscriptions cleanly unsubscribed on service cleanup');

  // Restore mocks
  helmetService.getHelmets = originalGetHelmets;
  helmetService.getLatestTelemetry = originalGetLatestTelemetry;
  helmetService.getTelemetryHistory = originalGetTelemetryHistory;
  alertService.getActiveAlerts = originalGetActiveAlerts;
  alertService.getAlertHistory = originalGetAlertHistory;

  console.log('\n============================================================');
  console.log(`TOTAL PHASE 3 CHECKS: ${totalTests}`);
  console.log(`PASSED:               ${passedTests}`);
  console.log(`FAILED:               ${totalTests - passedTests}`);
  console.log('============================================================\n');

  if (totalTests !== passedTests) {
    process.exit(1);
  }
}

void runPhase3Tests();
