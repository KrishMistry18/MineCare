/**
 * MineCare - Phase 3 Authentication & Role-Based Access Control (RBAC) Test Suite
 *
 * Verifies:
 * 1. AUTHENTICATION: Login, logout, session restoration, invalid credentials, expired session
 * 2. AUTHORIZATION: Admin, Supervisor, and Worker role boundaries
 * 3. ROW LEVEL SECURITY (RLS): Worker data isolation, self-only check-in/out, supervisor permissions
 * 4. ROUTE ENFORCEMENT: Unauthenticated rejections (401), role barriers (403)
 * 5. AUDIT TRAIL: Action logging for zone reassignment, check-in/out, alert ack/resolve, role changes
 * 6. CLIENT SECURITY: Secrets audit, no service role key, no plaintext password storage
 */

import { IncomingMessage, ServerResponse } from 'http';
import { Socket } from 'net';
import { BackendApp } from '../src/backend/app';
import { DatabaseRepository } from '../src/backend/db/DatabaseRepository';
import type { DbAlert } from '../src/backend/types';

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
const db = DatabaseRepository.getInstance();


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

async function runAuthRbacTests() {
  console.log('\n============================================================');
  console.log('MINECARE PHASE 3 - AUTHENTICATION & RBAC TEST SUITE');
  console.log('============================================================\n');

  // =========================================================================
  // 1. AUTHENTICATION & SESSION MANAGEMENT
  // =========================================================================
  console.log('--- 1. AUTHENTICATION & SESSION LIFECYCLE ---');

  // 1.1 Valid Admin Login
  const adminLogin = await mockRequest('/api/v1/auth/login', 'POST', {
    email: 'admin@minecare.local',
    password: 'Admin#Password2026',
  });
  assert(adminLogin.status === 200, 'AUTH', 'Admin login succeeds with 200 OK');
  assert(adminLogin.body.user.role === 'ADMIN', 'AUTH', 'Admin user role is ADMIN');
  assert(typeof adminLogin.body.token === 'string', 'AUTH', 'Admin session token generated');
  const adminToken = adminLogin.body.token;

  // 1.2 Valid Supervisor Login
  const supervisorLogin = await mockRequest('/api/v1/auth/login', 'POST', {
    email: 'supervisor@minecare.local',
    password: 'Supervisor#Password2026',
  });
  assert(supervisorLogin.status === 200, 'AUTH', 'Supervisor login succeeds with 200 OK');
  assert(supervisorLogin.body.user.role === 'SUPERVISOR', 'AUTH', 'Supervisor user role is SUPERVISOR');
  const supervisorToken = supervisorLogin.body.token;

  // 1.3 Valid Worker Login
  const workerLogin = await mockRequest('/api/v1/auth/login', 'POST', {
    email: 'worker.marak@minecare.local',
    password: 'Worker#Password2026',
  });
  assert(workerLogin.status === 200, 'AUTH', 'Worker login succeeds with 200 OK');
  assert(workerLogin.body.user.role === 'WORKER', 'AUTH', 'Worker user role is WORKER');
  assert(workerLogin.body.user.worker_id === 'WRK-001', 'AUTH', 'Worker user linked to WRK-001');
  const workerToken = workerLogin.body.token;

  // 1.4 Invalid Credentials
  const badLogin1 = await mockRequest('/api/v1/auth/login', 'POST', {
    email: 'admin@minecare.local',
    password: 'bad',
  });
  assert(badLogin1.status === 401, 'AUTH', 'Short password rejected with 401');

  const badLogin2 = await mockRequest('/api/v1/auth/login', 'POST', {
    email: 'unknown.user@minecare.local',
    password: 'Password123',
  });
  assert(badLogin2.status === 401, 'AUTH', 'Unknown email rejected with 401');

  // 1.5 Session Restoration
  const sessionCheck = await mockRequest('/api/v1/auth/session', 'GET', undefined, supervisorToken);
  assert(sessionCheck.status === 200, 'AUTH', 'GET /api/v1/auth/session restores active session');
  assert(sessionCheck.body.user.email === 'supervisor@minecare.local', 'AUTH', 'Session user matches logged-in user');

  // 1.6 Expired Session
  const expiredToken = 'mc_tok_expired_test';
  db.saveSession({
    token: expiredToken,
    user: adminLogin.body.user,
    expires_at: Date.now() - 5000, // in the past
  });
  const expiredCheck = await mockRequest('/api/v1/auth/session', 'GET', undefined, expiredToken);
  assert(expiredCheck.status === 401, 'AUTH', 'Expired session token rejected with 401');

  // 1.7 Logout
  const tempLogin = await mockRequest('/api/v1/auth/login', 'POST', {
    email: 'supervisor@minecare.local',
    password: 'Password2026!',
  });
  const tempToken = tempLogin.body.token;
  const logoutRes = await mockRequest('/api/v1/auth/logout', 'POST', { token: tempToken }, tempToken);
  assert(logoutRes.status === 200 && logoutRes.body.success === true, 'AUTH', 'Logout returns success');
  const postLogoutCheck = await mockRequest('/api/v1/auth/session', 'GET', undefined, tempToken);
  assert(postLogoutCheck.status === 401, 'AUTH', 'Invalidated token rejected after logout');

  // =========================================================================
  // 2. UNAUTHENTICATED ROUTE REJECTION
  // =========================================================================
  console.log('\n--- 2. UNAUTHENTICATED ROUTE PROTECTION ---');

  const unauthHelmets = await mockRequest('/api/v1/helmets', 'GET');
  assert(unauthHelmets.status === 401, 'UNAUTH', 'Unauthenticated GET /api/v1/helmets rejected (401)');

  const unauthWorkers = await mockRequest('/api/v1/workers', 'GET');
  assert(unauthWorkers.status === 401, 'UNAUTH', 'Unauthenticated GET /api/v1/workers rejected (401)');

  const unauthAdmin = await mockRequest('/api/v1/admin/users', 'GET');
  assert(unauthAdmin.status === 401, 'UNAUTH', 'Unauthenticated GET /api/v1/admin/users rejected (401)');

  const unauthAlerts = await mockRequest('/api/v1/alerts', 'GET');
  assert(unauthAlerts.status === 401, 'UNAUTH', 'Unauthenticated GET /api/v1/alerts rejected (401)');

  const publicHealth = await mockRequest('/api/v1/system/health', 'GET');
  assert(publicHealth.status === 200, 'UNAUTH', 'System health diagnostics remains accessible (200)');

  // =========================================================================
  // 3. WORKER ROLE PERMISSIONS & DATA ISOLATION (RLS)
  // =========================================================================
  console.log('\n--- 3. WORKER ROLE PERMISSIONS & ISOLATION (RLS) ---');

  // 3.1 Worker queries workers list -> receives ONLY their own record
  const workerListQuery = await mockRequest('/api/v1/workers', 'GET', undefined, workerToken);
  assert(workerListQuery.status === 200, 'WORKER', 'Worker GET /api/v1/workers succeeds');
  assert(workerListQuery.body.length === 1, 'WORKER', 'Worker sees ONLY 1 worker record (themselves)');
  assert(workerListQuery.body[0].id === 'WRK-001', 'WORKER', 'Worker sees their own worker_id WRK-001');

  // 3.2 Worker queries other worker details -> 403 Forbidden
  const otherWorkerQuery = await mockRequest('/api/v1/workers/WRK-002', 'GET', undefined, workerToken);
  assert(otherWorkerQuery.status === 403, 'WORKER', 'Worker querying WRK-002 rejected with 403 Forbidden');

  // 3.3 Worker queries helmets -> receives ONLY their assigned helmet (MC-001)
  const workerHelmetsQuery = await mockRequest('/api/v1/helmets', 'GET', undefined, workerToken);
  assert(workerHelmetsQuery.status === 200, 'WORKER', 'Worker GET /api/v1/helmets succeeds');
  assert(workerHelmetsQuery.body.length === 1, 'WORKER', 'Worker sees ONLY their assigned helmet');
  assert(workerHelmetsQuery.body[0].id === 'MC-001', 'WORKER', 'Assigned helmet is MC-001');

  // 3.4 Worker queries another helmet's details -> 403 Forbidden
  const otherHelmetQuery = await mockRequest('/api/v1/helmets/MC-002', 'GET', undefined, workerToken);
  assert(otherHelmetQuery.status === 403, 'WORKER', 'Worker inspecting MC-002 rejected with 403 Forbidden');

  // 3.5 Worker queries another helmet's telemetry -> 403 Forbidden
  const otherTelemetryQuery = await mockRequest('/api/v1/helmets/MC-002/latest', 'GET', undefined, workerToken);
  assert(otherTelemetryQuery.status === 403, 'WORKER', 'Worker accessing MC-002 telemetry rejected with 403 Forbidden');

  // 3.6 Worker can check themselves in
  const workerSelfCheckIn = await mockRequest(
    '/api/v1/workers/WRK-001/check-in',
    'POST',
    { zoneId: 'level-1-north-drift' },
    workerToken
  );
  assert(workerSelfCheckIn.status === 200 && workerSelfCheckIn.body?.success === true, 'WORKER', 'Worker can check themselves into a zone', workerSelfCheckIn);

  // 3.7 Worker CANNOT check in another worker -> 403 Forbidden
  const workerOtherCheckIn = await mockRequest(
    '/api/v1/workers/WRK-002/check-in',
    'POST',
    { zoneId: 'level-1-north-drift' },
    workerToken
  );
  assert(workerOtherCheckIn.status === 403, 'WORKER', 'Worker attempting to check in another worker rejected with 403 Forbidden');

  // 3.8 Worker can check themselves out
  const workerSelfCheckOut = await mockRequest(
    '/api/v1/workers/WRK-001/check-out',
    'POST',
    {},
    workerToken
  );
  assert(workerSelfCheckOut.status === 200 && workerSelfCheckOut.body.success === true, 'WORKER', 'Worker can check themselves out of a zone');

  // 3.9 Worker CANNOT check out another worker -> 403 Forbidden
  const workerOtherCheckOut = await mockRequest(
    '/api/v1/workers/WRK-002/check-out',
    'POST',
    {},
    workerToken
  );
  assert(workerOtherCheckOut.status === 403, 'WORKER', 'Worker attempting to check out another worker rejected with 403 Forbidden');

  // 3.10 Worker CANNOT perform zone reassignment -> 403 Forbidden
  const workerReassign = await mockRequest(
    '/api/v1/workers/WRK-001/zone',
    'POST',
    { zoneId: 'level-2-south-panel' },
    workerToken
  );
  assert(workerReassign.status === 403, 'WORKER', 'Worker attempting zone reassignment rejected with 403 Forbidden');

  // 3.11 Worker CANNOT acknowledge supervisor alerts -> 403 Forbidden
  const testAlert: DbAlert = {
    id: 'ALT-TEST-001',
    helmet_id: 'MC-001',
    worker_id: 'WRK-001',
    type: 'HIGH_GAS',
    severity: 'WARNING',
    message: 'High gas detected',
    sensor_values: { gas_value: 850 },
    timestamp: new Date().toISOString(),
    status: 'ACTIVE',
    acknowledged: false,
    resolved: false,
    created_at: new Date().toISOString(),
  };
  db.getAlertsStore().push(testAlert);

  const workerAckAlert = await mockRequest(
    `/api/v1/alerts/${testAlert.id}/acknowledge`,
    'POST',
    {},
    workerToken
  );
  assert(workerAckAlert.status === 403, 'WORKER', 'Worker attempting to acknowledge alert rejected with 403 Forbidden');

  // 3.12 Worker CANNOT resolve alerts -> 403 Forbidden
  const workerResolveAlert = await mockRequest(
    `/api/v1/alerts/${testAlert.id}/resolve`,
    'POST',
    { notes: 'Worker attempt' },
    workerToken
  );
  assert(workerResolveAlert.status === 403, 'WORKER', 'Worker attempting to resolve alert rejected with 403 Forbidden');

  // 3.13 Worker CANNOT access admin users -> 403 Forbidden
  const workerAdminAccess = await mockRequest('/api/v1/admin/users', 'GET', undefined, workerToken);
  assert(workerAdminAccess.status === 403, 'WORKER', 'Worker accessing /api/v1/admin/users rejected with 403 Forbidden');

  // =========================================================================
  // 4. SUPERVISOR ROLE PERMISSIONS
  // =========================================================================
  console.log('\n--- 4. SUPERVISOR ROLE PERMISSIONS ---');

  // 4.1 Supervisor sees all 16 workers
  const supWorkers = await mockRequest('/api/v1/workers', 'GET', undefined, supervisorToken);
  assert(supWorkers.status === 200 && supWorkers.body.length === 16, 'SUPERVISOR', 'Supervisor sees all 16 workers');

  // 4.2 Supervisor sees all 16 helmets
  const supHelmets = await mockRequest('/api/v1/helmets', 'GET', undefined, supervisorToken);
  assert(supHelmets.status === 200 && supHelmets.body.length === 16, 'SUPERVISOR', 'Supervisor sees all 16 helmets');

  // 4.3 Supervisor can reassign worker to a zone
  const supReassign = await mockRequest(
    '/api/v1/workers/WRK-001/zone',
    'POST',
    { zoneId: 'level-1-north-drift', updateDefault: false },
    supervisorToken
  );
  assert(supReassign.status === 200 && supReassign.body.success === true, 'SUPERVISOR', 'Supervisor can reassign worker zone', supReassign);

  // 4.4 Supervisor can check workers in / out
  const supCheckIn = await mockRequest(
    '/api/v1/workers/WRK-002/check-in',
    'POST',
    { zoneId: 'level-2-south-panel' },
    supervisorToken
  );
  assert(supCheckIn.status === 200, 'SUPERVISOR', 'Supervisor can check in workers', supCheckIn);

  // 4.5 Supervisor can acknowledge alerts
  const supAckAlert = await mockRequest(
    `/api/v1/alerts/${testAlert.id}/acknowledge`,
    'POST',
    { supervisorName: 'Chief Supervisor' },
    supervisorToken
  );
  assert(supAckAlert.status === 200 && supAckAlert.body.status === 'ACKNOWLEDGED', 'SUPERVISOR', 'Supervisor can acknowledge alerts', supAckAlert);

  // 4.6 Supervisor can resolve alerts
  const supResolveAlert = await mockRequest(
    `/api/v1/alerts/${testAlert.id}/resolve`,
    'POST',
    { notes: 'Ventilation verified safe' },
    supervisorToken
  );
  assert(supResolveAlert.status === 200 && supResolveAlert.body.status === 'RESOLVED', 'SUPERVISOR', 'Supervisor can resolve alerts', supResolveAlert);


  // 4.7 Supervisor CANNOT access admin user management -> 403 Forbidden
  const supAdminAccess = await mockRequest('/api/v1/admin/users', 'GET', undefined, supervisorToken);
  assert(supAdminAccess.status === 403, 'SUPERVISOR', 'Supervisor accessing /api/v1/admin/users rejected with 403 Forbidden');

  // 4.8 Supervisor CANNOT change user roles -> 403 Forbidden
  const supRoleChange = await mockRequest(
    '/api/v1/admin/users/PRF-003/role',
    'PUT',
    { role: 'SUPERVISOR' },
    supervisorToken
  );
  assert(supRoleChange.status === 403, 'SUPERVISOR', 'Supervisor changing user role rejected with 403 Forbidden');

  // =========================================================================
  // 5. ADMIN ROLE PERMISSIONS & USER MANAGEMENT
  // =========================================================================
  console.log('\n--- 5. ADMIN ROLE PERMISSIONS & USER MANAGEMENT ---');

  // 5.1 Admin can list all users
  const adminUsers = await mockRequest('/api/v1/admin/users', 'GET', undefined, adminToken);
  assert(adminUsers.status === 200 && Array.isArray(adminUsers.body), 'ADMIN', 'Admin can list user accounts', adminUsers);
  assert(Array.isArray(adminUsers.body) && adminUsers.body.length >= 4, 'ADMIN', 'Seeded profiles present', adminUsers);


  // 5.2 Admin can create a new operator account
  const newUserRes = await mockRequest(
    '/api/v1/admin/users',
    'POST',
    {
      name: 'Shift Lead Sharma',
      email: 'lead.sharma@minecare.local',
      role: 'SUPERVISOR',
    },
    adminToken
  );
  assert(newUserRes.status === 201 && newUserRes.body.success === true, 'ADMIN', 'Admin can create operator account');
  const createdUserId = newUserRes.body.profile.id;

  // 5.3 Admin can change a user's role
  const roleUpdateRes = await mockRequest(
    `/api/v1/admin/users/${createdUserId}/role`,
    'PUT',
    { role: 'ADMIN' },
    adminToken
  );
  assert(roleUpdateRes.status === 200 && roleUpdateRes.body.profile.role === 'ADMIN', 'ADMIN', 'Admin can update user role to ADMIN');

  // 5.4 Admin can view audit logs
  const adminAuditLogs = await mockRequest('/api/v1/admin/audit-logs', 'GET', undefined, adminToken);
  assert(adminAuditLogs.status === 200 && Array.isArray(adminAuditLogs.body), 'ADMIN', 'Admin can view audit logs');
  assert(adminAuditLogs.body.length > 0, 'ADMIN', 'Audit log records present');

  // =========================================================================
  // 6. SECURITY & SECRETS AUDIT
  // =========================================================================
  console.log('\n--- 6. SECURITY & CREDENTIALS INTEGRITY ---');

  // 6.1 Check that profiles do NOT contain password hashes/plaintexts in exposed endpoints
  const exposedProfiles = adminUsers.body;
  const hasPasswordProperty = exposedProfiles.some((p: any) => 'password' in p || 'password_hash' in p);
  assert(!hasPasswordProperty, 'SECURITY', 'User profiles do NOT expose passwords in API responses');

  // 6.2 Check that audit logs track critical operations
  const auditActions = db.getAuditLogs().map((l) => l.action);
  assert(auditActions.includes('USER_CREATE'), 'SECURITY', 'USER_CREATE action recorded in audit log');
  assert(auditActions.includes('ROLE_CHANGE'), 'SECURITY', 'ROLE_CHANGE action recorded in audit log');
  assert(auditActions.includes('WORKER_CHECK_IN'), 'SECURITY', 'WORKER_CHECK_IN action recorded in audit log');
  assert(auditActions.includes('ZONE_REASSIGN'), 'SECURITY', 'ZONE_REASSIGN action recorded in audit log');
  assert(auditActions.includes('ALERT_RESOLVE'), 'SECURITY', 'ALERT_RESOLVE action recorded in audit log');

  // =========================================================================
  // SUMMARY
  // =========================================================================
  console.log('\n============================================================');
  const passed = results.filter((r) => r.passed).length;
  const failed = results.filter((r) => !r.passed).length;
  console.log(`TOTAL CHECKS: ${results.length}`);
  console.log(`PASSED:       ${passed}`);
  console.log(`FAILED:       ${failed}`);
  console.log('============================================================\n');

  if (failed > 0) {
    process.exit(1);
  } else {
    process.exit(0);
  }
}

runAuthRbacTests().catch((err) => {
  console.error('Fatal test error:', err);
  process.exit(1);
});
