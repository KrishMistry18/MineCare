/**
 * MineCare - Phase 9 Task 9.1: Route Parameter & Input Validation Test Suite
 *
 * Verifies comprehensive API-boundary validation:
 * 1. UUID & Entity ID validation (helmets, workers, zones, alerts, users)
 * 2. Path parameter injection resistance (SQL injection, script tags, path traversal)
 * 3. Pagination validation (negative values, NaN, limits exceeding max, non-integers)
 * 4. Sort validation against allowlists (invalid columns, invalid direction)
 * 5. Query filter enum validation (status, severity, date ranges)
 * 6. Standardized 400 Bad Request error responses (ApiError envelope, no stack leaks)
 * 7. IDOR Protection: Valid foreign IDs pass validation but fail authorization (403 Forbidden)
 * 8. Valid parameters pass with expected success codes (200 / 201)
 */

process.env.NODE_ENV = 'test';

import { IncomingMessage, ServerResponse } from 'http';
import { Socket } from 'net';
import { BackendApp } from '../src/backend/app';
import { InputValidator } from '../src/backend/security/InputValidator';

interface TestResult {
  category: string;
  name: string;
  passed: boolean;
  error?: string;
}

const results: TestResult[] = [];

function assert(condition: boolean, category: string, name: string, detail?: unknown): void {
  if (condition) {
    results.push({ category, name, passed: true });
    console.log(`  ✓ [${category}] ${name}`);
  } else {
    const errorStr = detail !== undefined ? JSON.stringify(detail) : 'Assertion failed';
    results.push({ category, name, passed: false, error: errorStr });
    console.error(`  ✗ [${category}] ${name} -> ${errorStr}`);
  }
}

const app = BackendApp.getInstance();

async function mockRequest(
  pathname: string,
  method: string = 'GET',
  bodyData?: unknown,
  token?: string
): Promise<{ status: number; body: any }> {
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
      let parsed: any = responseBody;
      try {
        parsed = JSON.parse(responseBody);
      } catch {}
      resolve({ status: res.statusCode, body: parsed });
      return this;
    } as any;

    if (bodyData !== undefined) {
      req.push(JSON.stringify(bodyData));
      req.push(null);
    } else {
      req.push(null);
    }

    app.handleRequest(req, res);
  });
}

async function runTask9ValidationTests() {
  console.log('\n============================================================');
  console.log('MINECARE TASK 9.1 — ROUTE PARAMETER VALIDATION TEST SUITE');
  console.log('============================================================\n');

  // =========================================================================
  // 1. UNIT VALIDATOR VERIFICATION
  // =========================================================================
  console.log('--- 1. INPUTVALIDATOR UNIT CHECKS ---');

  // UUID Validation
  assert(InputValidator.validateUuid('4bed7a7d-0d4c-41d4-9950-8ee9ef934fde') === true, 'UNIT', 'Valid UUID format passes');
  assert(InputValidator.validateUuid('not-a-uuid') === false, 'UNIT', 'Malformed UUID string rejected');
  assert(InputValidator.validateUuid(12345) === false, 'UNIT', 'Non-string UUID rejected');
  assert(InputValidator.validateUuid('') === false, 'UNIT', 'Empty UUID rejected');

  // Entity ID Validation
  assert(InputValidator.validateEntityId('MC-001', 'helmetId').isValid === true, 'UNIT', 'Valid helmetId format passes');
  assert(InputValidator.validateEntityId('WRK-001', 'workerId').isValid === true, 'UNIT', 'Valid workerId format passes');
  assert(InputValidator.validateEntityId('zone-portal-surface', 'zoneId').isValid === true, 'UNIT', 'Valid zoneId format passes');
  assert(InputValidator.validateEntityId('', 'id').isValid === false, 'UNIT', 'Empty entity ID rejected');
  assert(InputValidator.validateEntityId('   ', 'id').isValid === false, 'UNIT', 'Whitespace-only entity ID rejected');
  assert(InputValidator.validateEntityId('ab', 'id').isValid === false, 'UNIT', 'Entity ID shorter than 3 chars rejected');
  assert(InputValidator.validateEntityId('a'.repeat(65), 'id').isValid === false, 'UNIT', 'Entity ID longer than 64 chars rejected');
  assert(InputValidator.validateEntityId("' OR 1=1 --", 'id').isValid === false, 'UNIT', 'SQL injection in entity ID rejected');
  assert(InputValidator.validateEntityId('<script>alert(1)</script>', 'id').isValid === false, 'UNIT', 'XSS payload in entity ID rejected');
  assert(InputValidator.validateEntityId('../../etc/passwd', 'id').isValid === false, 'UNIT', 'Path traversal in entity ID rejected');

  // Optional Entity ID
  assert(InputValidator.validateOptionalEntityId(undefined).isValid === true, 'UNIT', 'Omitted optional entity ID passes');
  assert(InputValidator.validateOptionalEntityId(null).isValid === true, 'UNIT', 'Null optional entity ID passes');
  assert(InputValidator.validateOptionalEntityId('').isValid === true, 'UNIT', 'Empty optional entity ID passes');
  assert(InputValidator.validateOptionalEntityId('MC-001').isValid === true, 'UNIT', 'Valid optional entity ID passes');
  assert(InputValidator.validateOptionalEntityId("' OR 1=1").isValid === false, 'UNIT', 'Malformed optional entity ID rejected');

  // Pagination Validation
  const validPag = InputValidator.validatePagination('25', '50', 50, 1000);
  assert(validPag.isValid && validPag.sanitized?.limit === 25 && validPag.sanitized?.offset === 50, 'UNIT', 'Valid pagination parameters parsed');

  const defaultPag = InputValidator.validatePagination(undefined, undefined, 50, 1000);
  assert(defaultPag.isValid && defaultPag.sanitized?.limit === 50 && defaultPag.sanitized?.offset === 0, 'UNIT', 'Default pagination applied when omitted');

  const negLimit = InputValidator.validatePagination('-5', '0');
  assert(negLimit.isValid === false, 'UNIT', 'Negative limit rejected');

  const negOffset = InputValidator.validatePagination('10', '-1');
  assert(negOffset.isValid === false, 'UNIT', 'Negative offset rejected');

  const nanLimit = InputValidator.validatePagination('abc', '0');
  assert(nanLimit.isValid === false, 'UNIT', 'NaN limit rejected');

  const excessiveLimit = InputValidator.validatePagination('5000', '0', 50, 1000);
  assert(excessiveLimit.isValid === false, 'UNIT', 'Excessive limit (>1000) rejected');

  // Sort Validation
  const validSort = InputValidator.validateSort('triggered_at', 'ASC', ['triggered_at', 'severity', 'status'], 'triggered_at');
  assert(validSort.isValid && validSort.sanitized?.field === 'triggered_at' && validSort.sanitized?.direction === 'ASC', 'UNIT', 'Valid sort field & direction accepted');

  const invalidField = InputValidator.validateSort('passwords', 'DESC', ['triggered_at', 'severity']);
  assert(invalidField.isValid === false, 'UNIT', 'Sort field not in allowlist rejected');

  const invalidDir = InputValidator.validateSort('triggered_at', 'SIDEWAYS', ['triggered_at']);
  assert(invalidDir.isValid === false, 'UNIT', 'Sort direction not ASC/DESC rejected');

  // Alert Filters
  assert(InputValidator.validateAlertStatus('TRIGGERED').isValid === true, 'UNIT', 'Valid alert status TRIGGERED accepted');
  assert(InputValidator.validateAlertStatus('RESOLVED').isValid === true, 'UNIT', 'Valid alert status RESOLVED accepted');
  assert(InputValidator.validateAlertStatus('MALICIOUS').isValid === false, 'UNIT', 'Unknown alert status rejected');
  assert(InputValidator.validateAlertSeverity('CRITICAL').isValid === true, 'UNIT', 'Valid alert severity CRITICAL accepted');
  assert(InputValidator.validateAlertSeverity('CATASTROPHIC').isValid === false, 'UNIT', 'Unknown alert severity rejected');

  // =========================================================================
  // 2. SETUP AUTHENTICATION FOR API-LEVEL TESTING
  // =========================================================================
  console.log('\n--- 2. AUTHENTICATION SETUP ---');

  const adminLogin = await mockRequest('/api/v1/auth/login', 'POST', {
    email: 'admin@minecare.local',
    password: 'Admin#Password2026',
  });
  assert(adminLogin.status === 200, 'AUTH', 'Admin login succeeds');
  const adminToken = adminLogin.body.token;

  const supLogin = await mockRequest('/api/v1/auth/login', 'POST', {
    email: 'supervisor@minecare.local',
    password: 'Supervisor#Password2026',
  });
  assert(supLogin.status === 200, 'AUTH', 'Supervisor login succeeds');
  const supToken = supLogin.body.token;

  const workerALogin = await mockRequest('/api/v1/auth/login', 'POST', {
    email: 'worker.marak@minecare.local',
    password: 'Worker#Password2026',
  });
  assert(workerALogin.status === 200, 'AUTH', 'Worker A login succeeds');
  const workerAToken = workerALogin.body.token;

  // =========================================================================
  // 3. API-LEVEL PATH PARAMETER VALIDATION (REJECTING MALFORMED ENTITY IDS)
  // =========================================================================
  console.log('\n--- 3. PATH PARAMETER INJECTION RESISTANCE (400 BAD REQUEST) ---');

  // Helmet Routes
  const badHelmetLatest = await mockRequest("/api/v1/helmets/' OR 1=1 --/latest", 'GET', undefined, supToken);
  assert(badHelmetLatest.status === 400, 'PATH_VAL', 'GET /helmets/:id/latest with SQL injection returns 400');
  assert(badHelmetLatest.body.code === 'VALIDATION_ERROR', 'ERROR_ENV', 'Response includes VALIDATION_ERROR code');

  const scriptHelmetLatest = await mockRequest('/api/v1/helmets/<script>/latest', 'GET', undefined, supToken);
  assert(scriptHelmetLatest.status === 400, 'PATH_VAL', 'GET /helmets/:id/latest with XSS payload returns 400');

  const traversalHelmetLatest = await mockRequest('/api/v1/helmets/..%2F..%2Fetc/latest', 'GET', undefined, supToken);
  assert(traversalHelmetLatest.status === 400, 'PATH_VAL', 'GET /helmets/:id/latest with path traversal returns 400');

  const badHelmetHistory = await mockRequest("/api/v1/helmets/' OR 1=1/history", 'GET', undefined, supToken);
  assert(badHelmetHistory.status === 400, 'PATH_VAL', 'GET /helmets/:id/history with SQL injection returns 400');

  const badHelmetDetails = await mockRequest('/api/v1/helmets/bad%20id', 'GET', undefined, supToken);
  assert(badHelmetDetails.status === 400, 'PATH_VAL', 'GET /helmets/:id with spaces returns 400');

  // Worker Routes
  const badWorkerGet = await mockRequest("/api/v1/workers/' OR 1=1", 'GET', undefined, supToken);
  assert(badWorkerGet.status === 400, 'PATH_VAL', 'GET /workers/:id with SQL injection returns 400');

  const badWorkerCheckIn = await mockRequest("/api/v1/workers/' OR 1=1/check-in", 'POST', { zoneId: 'portal-surface' }, supToken);
  assert(badWorkerCheckIn.status === 400, 'PATH_VAL', 'POST /workers/:id/check-in with malformed workerId returns 400');

  const badWorkerZoneCheckIn = await mockRequest('/api/v1/workers/WRK-001/check-in', 'POST', { zoneId: "' OR 1=1" }, supToken);
  assert(badWorkerZoneCheckIn.status === 400, 'PATH_VAL', 'POST /workers/:id/check-in with malformed zoneId returns 400');

  const badWorkerCheckOut = await mockRequest("/api/v1/workers/' OR 1=1/check-out", 'POST', {}, supToken);
  assert(badWorkerCheckOut.status === 400, 'PATH_VAL', 'POST /workers/:id/check-out with malformed workerId returns 400');

  const badWorkerZoneReassign = await mockRequest("/api/v1/workers/' OR 1=1/zone", 'POST', { zoneId: 'portal-surface' }, supToken);
  assert(badWorkerZoneReassign.status === 400, 'PATH_VAL', 'POST /workers/:id/zone with malformed workerId returns 400');

  const badZoneInReassign = await mockRequest('/api/v1/workers/WRK-001/zone', 'POST', { zoneId: "' OR 1=1" }, supToken);
  assert(badZoneInReassign.status === 400, 'PATH_VAL', 'POST /workers/:id/zone with malformed zoneId payload returns 400');

  // Zone Routes
  const badZoneWorkers = await mockRequest("/api/v1/zones/' OR 1=1/workers", 'GET', undefined, supToken);
  assert(badZoneWorkers.status === 400, 'PATH_VAL', 'GET /zones/:id/workers with SQL injection returns 400');

  const badZoneGet = await mockRequest('/api/v1/zones/<script>', 'GET', undefined, supToken);
  assert(badZoneGet.status === 400, 'PATH_VAL', 'GET /zones/:id with XSS payload returns 400');

  // Alert Routes
  const badAlertAck = await mockRequest("/api/v1/alerts/' OR 1=1/acknowledge", 'POST', {}, supToken);
  assert(badAlertAck.status === 400, 'PATH_VAL', 'POST /alerts/:id/acknowledge with malformed alertId returns 400');

  const badAlertResolve = await mockRequest("/api/v1/alerts/' OR 1=1/resolve", 'POST', { notes: 'Safe' }, supToken);
  assert(badAlertResolve.status === 400, 'PATH_VAL', 'POST /alerts/:id/resolve with malformed alertId returns 400');

  const excessiveNotes = await mockRequest('/api/v1/alerts/alert-test-01/resolve', 'POST', { notes: 'A'.repeat(501) }, supToken);
  assert(excessiveNotes.status === 400, 'PAYLOAD_VAL', 'POST /alerts/:id/resolve with excessive notes (>500 chars) returns 400');

  // Admin Routes
  const badAdminUserId = await mockRequest("/api/v1/admin/users/' OR 1=1/role", 'PUT', { role: 'SUPERVISOR' }, adminToken);
  assert(badAdminUserId.status === 400, 'PATH_VAL', 'PUT /admin/users/:id/role with malformed userId returns 400');

  const badAdminUserRole = await mockRequest('/api/v1/admin/users/PRF-001/role', 'PUT', { role: 'SUPER_HACKER' }, adminToken);
  assert(badAdminUserRole.status === 400, 'PATH_VAL', 'PUT /admin/users/:id/role with invalid role enum returns 400');

  // Analytics Path Parameters
  const badAnalyticsHelmet = await mockRequest("/api/v1/analytics/helmets/' OR 1=1", 'GET', undefined, supToken);
  assert(badAnalyticsHelmet.status === 400, 'PATH_VAL', 'GET /analytics/helmets/:id with malformed helmetId returns 400');

  const badAnalyticsWorker = await mockRequest("/api/v1/analytics/workers/' OR 1=1", 'GET', undefined, supToken);
  assert(badAnalyticsWorker.status === 400, 'PATH_VAL', 'GET /analytics/workers/:id with malformed workerId returns 400');

  // =========================================================================
  // 4. API-LEVEL PAGINATION VALIDATION
  // =========================================================================
  console.log('\n--- 4. PAGINATION QUERY VALIDATION ---');

  const negAuditLimit = await mockRequest('/api/v1/admin/audit-logs?limit=-10', 'GET', undefined, adminToken);
  assert(negAuditLimit.status === 400, 'PAG_VAL', 'GET /admin/audit-logs?limit=-10 returns 400');

  const nanAuditLimit = await mockRequest('/api/v1/admin/audit-logs?limit=notanumber', 'GET', undefined, adminToken);
  assert(nanAuditLimit.status === 400, 'PAG_VAL', 'GET /admin/audit-logs?limit=notanumber returns 400');

  const excessiveAuditLimit = await mockRequest('/api/v1/admin/audit-logs?limit=99999', 'GET', undefined, adminToken);
  assert(excessiveAuditLimit.status === 400, 'PAG_VAL', 'GET /admin/audit-logs?limit=99999 (>1000) returns 400');

  const negAuditOffset = await mockRequest('/api/v1/admin/audit-logs?offset=-1', 'GET', undefined, adminToken);
  assert(negAuditOffset.status === 400, 'PAG_VAL', 'GET /admin/audit-logs?offset=-1 returns 400');

  const negHelmetLimit = await mockRequest('/api/v1/helmets/MC-001/history?limit=-5', 'GET', undefined, supToken);
  assert(negHelmetLimit.status === 400, 'PAG_VAL', 'GET /helmets/:id/history?limit=-5 returns 400');

  const excessiveHelmetLimit = await mockRequest('/api/v1/helmets/MC-001/history?limit=5000', 'GET', undefined, supToken);
  assert(excessiveHelmetLimit.status === 400, 'PAG_VAL', 'GET /helmets/:id/history?limit=5000 returns 400');

  const negAlertsLimit = await mockRequest('/api/v1/alerts?limit=-1', 'GET', undefined, supToken);
  assert(negAlertsLimit.status === 400, 'PAG_VAL', 'GET /alerts?limit=-1 returns 400');

  const excessiveAlertsLimit = await mockRequest('/api/v1/alerts?limit=2500', 'GET', undefined, supToken);
  assert(excessiveAlertsLimit.status === 400, 'PAG_VAL', 'GET /alerts?limit=2500 returns 400');

  const negAlertHistoryLimit = await mockRequest('/api/v1/alerts/history?limit=-1', 'GET', undefined, supToken);
  assert(negAlertHistoryLimit.status === 400, 'PAG_VAL', 'GET /alerts/history?limit=-1 returns 400');

  // =========================================================================
  // 5. API-LEVEL SORT VALIDATION
  // =========================================================================
  console.log('\n--- 5. SORT PARAMETER ALLOWLIST VALIDATION ---');

  const badSortCol = await mockRequest('/api/v1/alerts?sort=password_hash', 'GET', undefined, supToken);
  assert(badSortCol.status === 400, 'SORT_VAL', 'GET /alerts?sort=password_hash rejected with 400');

  const sqlSortCol = await mockRequest("/api/v1/alerts?sort=id; DROP TABLE alerts;--", 'GET', undefined, supToken);
  assert(sqlSortCol.status === 400, 'SORT_VAL', 'GET /alerts?sort=<sql injection> rejected with 400');

  const badSortDir = await mockRequest('/api/v1/alerts?sort=triggered_at&direction=INVALID_DIR', 'GET', undefined, supToken);
  assert(badSortDir.status === 400, 'SORT_VAL', 'GET /alerts?direction=INVALID_DIR rejected with 400');

  const validSortReq = await mockRequest('/api/v1/alerts?sort=triggered_at&direction=ASC', 'GET', undefined, supToken);
  assert(validSortReq.status === 200, 'SORT_VAL', 'GET /alerts with valid allowlisted sort & direction returns 200');

  // =========================================================================
  // 6. API-LEVEL FILTER ENUM & TIME RANGE VALIDATION
  // =========================================================================
  console.log('\n--- 6. FILTER ENUM & TIME RANGE VALIDATION ---');

  const badStatusFilter = await mockRequest('/api/v1/alerts?status=UNSUPPORTED_STATUS', 'GET', undefined, supToken);
  assert(badStatusFilter.status === 400, 'FILTER_VAL', 'GET /alerts?status=UNSUPPORTED_STATUS rejected with 400');

  const badSeverityFilter = await mockRequest('/api/v1/alerts?severity=SUPER_CRITICAL', 'GET', undefined, supToken);
  assert(badSeverityFilter.status === 400, 'FILTER_VAL', 'GET /alerts?severity=SUPER_CRITICAL rejected with 400');

  const badHelmetFilter = await mockRequest("/api/v1/alerts?helmetId=' OR 1=1", 'GET', undefined, supToken);
  assert(badHelmetFilter.status === 400, 'FILTER_VAL', 'GET /alerts?helmetId=<sql injection> rejected with 400');

  const badWorkerFilter = await mockRequest("/api/v1/alerts?workerId=' OR 1=1", 'GET', undefined, supToken);
  assert(badWorkerFilter.status === 400, 'FILTER_VAL', 'GET /alerts?workerId=<sql injection> rejected with 400');

  // Analytics query filters
  const badFromDate = await mockRequest('/api/v1/analytics/overview?from=not-a-date&to=2026-10-06T00:00:00Z', 'GET', undefined, supToken);
  assert(badFromDate.status === 400, 'ANALYTICS_VAL', 'GET /analytics/overview with malformed "from" date returns 400');

  const reversedDate = await mockRequest('/api/v1/analytics/overview?from=2026-10-06T00:00:00Z&to=2026-10-05T00:00:00Z', 'GET', undefined, supToken);
  assert(reversedDate.status === 400, 'ANALYTICS_VAL', 'GET /analytics/overview with reversed date range returns 400');

  const badAnalyticsHelmetFilter = await mockRequest("/api/v1/analytics/overview?helmetId=' OR 1=1", 'GET', undefined, supToken);
  assert(badAnalyticsHelmetFilter.status === 400, 'ANALYTICS_VAL', 'GET /analytics/overview with malformed helmetId returns 400');

  const badAnalyticsWorkerFilter = await mockRequest("/api/v1/analytics/overview?workerId=' OR 1=1", 'GET', undefined, supToken);
  assert(badAnalyticsWorkerFilter.status === 400, 'ANALYTICS_VAL', 'GET /analytics/overview with malformed workerId returns 400');

  const badAnalyticsZoneFilter = await mockRequest("/api/v1/analytics/overview?zoneId=' OR 1=1", 'GET', undefined, supToken);
  assert(badAnalyticsZoneFilter.status === 400, 'ANALYTICS_VAL', 'GET /analytics/overview with malformed zoneId returns 400');

  // =========================================================================
  // 7. VALID PARAMETERS PASS WITH 200 OK
  // =========================================================================
  console.log('\n--- 7. VALID PARAMETERS FUNCTIONALITY ---');

  const validHelmet = await mockRequest('/api/v1/helmets/MC-001', 'GET', undefined, supToken);
  assert(validHelmet.status === 200, 'VALID_PARAMS', 'GET /helmets/MC-001 with valid ID returns 200');

  const validHelmetHistory = await mockRequest('/api/v1/helmets/MC-001/history?limit=10&offset=0', 'GET', undefined, supToken);
  assert(validHelmetHistory.status === 200, 'VALID_PARAMS', 'GET /helmets/MC-001/history with valid pagination returns 200');

  const validWorker = await mockRequest('/api/v1/workers/WRK-001', 'GET', undefined, supToken);
  assert(validWorker.status === 200, 'VALID_PARAMS', 'GET /workers/WRK-001 with valid ID returns 200');

  const validZone = await mockRequest('/api/v1/zones/portal-surface', 'GET', undefined, supToken);
  assert(validZone.status === 200, 'VALID_PARAMS', 'GET /zones/portal-surface with valid ID returns 200');

  const validZoneWorkers = await mockRequest('/api/v1/zones/portal-surface/workers', 'GET', undefined, supToken);
  assert(validZoneWorkers.status === 200, 'VALID_PARAMS', 'GET /zones/portal-surface/workers with valid ID returns 200');

  const validAuditLogs = await mockRequest('/api/v1/admin/audit-logs?limit=50&offset=0', 'GET', undefined, adminToken);
  assert(validAuditLogs.status === 200, 'VALID_PARAMS', 'GET /admin/audit-logs with valid limit & offset returns 200');

  const validAlerts = await mockRequest('/api/v1/alerts?status=ACTIVE&severity=WARNING&limit=25', 'GET', undefined, supToken);
  assert(validAlerts.status === 200, 'VALID_PARAMS', 'GET /alerts with valid filters and pagination returns 200');

  // =========================================================================
  // 8. IDOR PROTECTION WITH SYNTACTICALLY VALID IDENTIFIERS
  // =========================================================================
  console.log('\n--- 8. IDOR REGRESSION PROTECTION (SYNTACTICALLY VALID IDs FAIL AUTH) ---');

  // Worker A (WRK-001) querying Worker B (WRK-002) details:
  // WRK-002 is syntactically VALID, so validation PASSES, but authorization MUST FAIL with 403 Forbidden!
  const idorWorkerDetails = await mockRequest('/api/v1/workers/WRK-002', 'GET', undefined, workerAToken);
  assert(idorWorkerDetails.status === 403, 'IDOR', 'Worker A accessing valid Worker B profile returns strictly 403 Forbidden');

  // Worker A querying Worker B's helmet (MC-002):
  const idorHelmetDetails = await mockRequest('/api/v1/helmets/MC-002', 'GET', undefined, workerAToken);
  assert(idorHelmetDetails.status === 403, 'IDOR', 'Worker A accessing valid Helmet B returns strictly 403 Forbidden');

  const idorHelmetTelemetry = await mockRequest('/api/v1/helmets/MC-002/latest', 'GET', undefined, workerAToken);
  assert(idorHelmetTelemetry.status === 403, 'IDOR', 'Worker A inspecting Helmet B telemetry returns strictly 403 Forbidden');

  const idorHelmetHistory = await mockRequest('/api/v1/helmets/MC-002/history', 'GET', undefined, workerAToken);
  assert(idorHelmetHistory.status === 403, 'IDOR', 'Worker A inspecting Helmet B history returns strictly 403 Forbidden');

  // Worker A querying foreign alerts:
  const idorWorkerAlerts = await mockRequest('/api/v1/alerts?workerId=WRK-002', 'GET', undefined, workerAToken);
  assert(idorWorkerAlerts.status === 403, 'IDOR', 'Worker A querying Worker B alerts returns strictly 403 Forbidden');

  // Worker A attempting to check in Worker B:
  const idorCheckIn = await mockRequest('/api/v1/workers/WRK-002/check-in', 'POST', { zoneId: 'portal-surface' }, workerAToken);
  assert(idorCheckIn.status === 403, 'IDOR', 'Worker A attempting to check in Worker B returns strictly 403 Forbidden');

  // Worker A attempting to check out Worker B:
  const idorCheckOut = await mockRequest('/api/v1/workers/WRK-002/check-out', 'POST', {}, workerAToken);
  assert(idorCheckOut.status === 403, 'IDOR', 'Worker A attempting to check out Worker B returns strictly 403 Forbidden');

  // Worker A attempting supervisor zone reassignment:
  const idorZoneReassign = await mockRequest('/api/v1/workers/WRK-001/zone', 'POST', { zoneId: 'portal-surface' }, workerAToken);
  assert(idorZoneReassign.status === 403, 'IDOR', 'Worker A attempting zone reassignment returns strictly 403 Forbidden');

  // Worker A attempting alert acknowledgement:
  const idorAlertAck = await mockRequest('/api/v1/alerts/alert-test-01/acknowledge', 'POST', {}, workerAToken);
  assert(idorAlertAck.status === 403, 'IDOR', 'Worker attempting alert acknowledgement returns strictly 403 Forbidden');

  // Worker A attempting alert resolution:
  const idorAlertResolve = await mockRequest('/api/v1/alerts/alert-test-01/resolve', 'POST', { notes: 'Resolved' }, workerAToken);
  assert(idorAlertResolve.status === 403, 'IDOR', 'Worker attempting alert resolution returns strictly 403 Forbidden');

  // Worker A attempting analytics on Worker B:
  const idorWorkerAnalytics = await mockRequest('/api/v1/analytics/workers/WRK-002', 'GET', undefined, workerAToken);
  assert(idorWorkerAnalytics.status === 403, 'IDOR', 'Worker A inspecting Worker B analytics returns strictly 403 Forbidden');

  // =========================================================================
  // 9. ERROR RESPONSE FORMAT & INFORMATION LEAKAGE AUDIT
  // =========================================================================
  console.log('\n--- 9. ERROR RESPONSE FORMAT & INFO LEAKAGE CHECKS ---');

  const errorResponse = await mockRequest("/api/v1/helmets/' OR 1=1/latest", 'GET', undefined, supToken);
  assert(errorResponse.status === 400, 'ERROR_AUDIT', 'Malformed request returns status 400 (not 500)');
  assert(errorResponse.body.code === 'VALIDATION_ERROR', 'ERROR_AUDIT', 'Envelope code is VALIDATION_ERROR');
  assert(typeof errorResponse.body.message === 'string', 'ERROR_AUDIT', 'Error envelope contains user-friendly message');
  assert(typeof errorResponse.body.requestId === 'string', 'ERROR_AUDIT', 'Error envelope includes correlation requestId');
  assert(!JSON.stringify(errorResponse.body).includes('syntax error at or near'), 'ERROR_AUDIT', 'Response does NOT leak PostgreSQL syntax errors');
  assert(!JSON.stringify(errorResponse.body).includes('node_modules'), 'ERROR_AUDIT', 'Response does NOT leak filesystem stack traces');

  // Summary
  console.log('\n============================================================');
  const totalChecks = results.length;
  const passedChecks = results.filter((r) => r.passed).length;
  console.log(`TOTAL TASK 9.1 CHECKS: ${totalChecks}`);
  console.log(`PASSED:                ${passedChecks}`);
  console.log(`FAILED:                ${totalChecks - passedChecks}`);
  console.log('============================================================\n');

  if (totalChecks !== passedChecks) {
    process.exitCode = 1;
  }
}

runTask9ValidationTests().catch((err) => {
  console.error('Fatal test execution error:', err);
  process.exitCode = 1;
});
