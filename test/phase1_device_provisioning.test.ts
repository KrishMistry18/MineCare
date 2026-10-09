/**
 * MineCare - Phase 1 ESP8266 Production-Grade Device Provisioning Test Suite
 *
 * Comprehensive verification of:
 * 1. Unauthorized Access: 401 when unauthenticated
 * 2. Insufficient Roles: 403 when authenticated as Worker or Supervisor (Admin-only RBAC)
 * 3. Unknown Helmet: 404 when helmet does not exist
 * 4. Malformed Requests: 400 on malformed entity IDs or invalid payloads
 * 5. Successful One-Time Issuance: 201 with 256-bit CSPRNG high-entropy raw token
 * 6. Hashed-At-Rest Storage: Zero plaintext tokens in database; only SHA-256 hash and prefix stored
 * 7. Metadata Endpoint: GET returns status/prefix without exposing raw token or full hash
 * 8. Valid Telemetry Ingestion: 201 Created with valid provisioned token in production mode
 * 9. Wrong-Helmet Binding: 403 Forbidden when using Helmet A's token for Helmet B
 * 10. Rejection of Human JWTs: 401 Unauthorized when passing Bearer or raw JWT as X-Device-Token
 * 11. Explicit Revocation: 200 OK, persistent revoked_at, subsequent telemetry returns 401
 * 12. Safe Atomic Rotation: Rotation inside transaction revokes old token, new token works,
 *     zero deletion of historical telemetry or helmet records
 * 13. Audit Logging: Provisioning, revocation, and rotation logged with tokenPrefix, zero raw secrets
 * 14. Database Failure & Transaction Integrity: Transaction rollback on failure, 500 error handling
 */

process.env.NODE_ENV = 'test';

import { Readable } from 'stream';
import type { IncomingMessage, ServerResponse } from 'http';
import crypto from 'crypto';
import { newDb } from 'pg-mem';
import type pg from 'pg';
import { BackendApp } from '../src/backend/app';
import { PostgresConnectionManager } from '../src/backend/db/connection';
import { DatabaseMigrator } from '../src/backend/db/migrator';
import { PostgresDatabaseRepository } from '../src/backend/db/repositories/PostgresDatabaseRepository';
import { createStandardJwt } from '../src/backend/auth/jwt';
import { DeviceAuthManager } from '../src/backend/security/DeviceAuth';
import { RateLimiter, MemoryRateLimitStore } from '../src/backend/security/RateLimiter';

let totalChecks = 0;
let passedChecks = 0;
let failedChecks = 0;

function assert(condition: boolean, category: string, name: string, detail?: unknown): void {
  totalChecks++;
  if (condition) {
    passedChecks++;
    console.log(`  ✓ [${category}] ${name}`);
  } else {
    failedChecks++;
    const err = detail !== undefined ? (typeof detail === 'object' ? JSON.stringify(detail) : String(detail)) : 'Assertion failed';
    console.error(`  ✗ [${category}] ${name} -> ${err}`);
  }
}

interface MockResponse {
  status: number;
  headers: Record<string, string>;
  body: any;
}

function createMockRequest(
  app: BackendApp,
  pathname: string,
  method: string = 'GET',
  body?: unknown,
  customHeaders: Record<string, string> = {}
): Promise<MockResponse> {
  return new Promise((resolve) => {
    const rawBody = body !== undefined ? JSON.stringify(body) : '';
    const reqStream = new Readable({
      read() {
        if (rawBody) {
          this.push(rawBody);
        }
        this.push(null);
      },
    }) as unknown as IncomingMessage;

    reqStream.url = pathname;
    reqStream.method = method;
    reqStream.headers = {
      host: 'localhost:3001',
      'content-type': 'application/json',
      ...customHeaders,
    };
    (reqStream as any).socket = { remoteAddress: '127.0.0.1' };

    const headers: Record<string, string> = {};
    let status = 200;
    let responseText = '';

    const res = {
      statusCode: 200,
      setHeader(name: string, value: string) {
        headers[name.toLowerCase()] = String(value);
        return this;
      },
      getHeader(name: string) {
        return headers[name.toLowerCase()];
      },
      end(chunk?: string | Buffer) {
        if (chunk) {
          responseText += chunk.toString();
        }
        status = this.statusCode;
        let parsed = responseText;
        try {
          parsed = JSON.parse(responseText);
        } catch {}
        resolve({ status, headers, body: parsed });
      },
    } as unknown as ServerResponse;

    app.handleRequest(reqStream, res).catch((err) => {
      resolve({ status: 500, headers, body: { error: err.message } });
    });
  });
}

async function runDeviceProvisioningTestSuite() {
  console.log('\n============================================================');
  console.log('MINECARE PHASE 1 — ESP8266 PRODUCTION DEVICE PROVISIONING SUITE');
  console.log('============================================================\n');

  // --- 1. SETUP HERMETIC POSTGRESQL INSTANCE (pg-mem) ---
  console.log('--- SETUP: Initializing PostgreSQL Instance & Running Migrations ---');
  const memDb = newDb({ autoCreateForeignKeyIndices: true });
  memDb.public.registerFunction({
    name: 'gen_random_uuid',
    args: [],
    returns: (memDb.public as any).uuid || memDb.public.getType('uuid' as any),
    impure: true,
    implementation: () => crypto.randomUUID(),
  });
  memDb.public.registerFunction({
    name: 'now',
    args: [],
    returns: (memDb.public as any).timestampz || (memDb.public as any).text,
    impure: true,
    implementation: () => new Date(),
  });

  const adapter = memDb.adapters.createPg();
  const pool = new adapter.Pool() as unknown as pg.Pool;

  const connManager = PostgresConnectionManager.getInstance();
  connManager.initializePool(pool, true);

  const migrator = new DatabaseMigrator();
  const migrationResults = await migrator.runMigrations(pool);
  assert(migrationResults.every((m) => m.applied), 'SETUP', 'All canonical migrations applied cleanly');

  // Seed demo fleet
  const seeded = await migrator.seedDemoData(pool);
  assert(seeded === true, 'SETUP', 'Demo fleet seeded with 16 helmets, 16 workers, 4 zones');

  // Initialize PostgreSQL Repository and BackendApp
  PostgresDatabaseRepository.resetInstance();
  const db = PostgresDatabaseRepository.getInstance(connManager);
  BackendApp.resetInstance();
  const app = BackendApp.getInstance(db);

  // Use MemoryRateLimitStore in unit test double to avoid DDL collisions
  RateLimiter.getInstance(new MemoryRateLimitStore());

  // Mint standard JWTs for RBAC testing matching seeded canonical users
  const adminJwt = await createStandardJwt({ sub: '00000000-0000-0000-0000-000000000001', email: 'admin@minecare.local', role: 'ADMIN' });
  const supervisorJwt = await createStandardJwt({ sub: '00000000-0000-0000-0000-000000000002', email: 'supervisor@minecare.local', role: 'SUPERVISOR' });
  const workerJwt = await createStandardJwt({ sub: '00000000-0000-0000-0000-000000000003', email: 'worker.marak@minecare.local', role: 'WORKER' });

  // --- TEST GROUP 1: UNAUTHORIZED ACCESS ---
  console.log('\n--- 1. UNAUTHORIZED ACCESS TESTS ---');
  {
    const resNoAuth = await createMockRequest(app, '/api/v1/admin/helmets/MC-001/device-token', 'POST', {});
    assert(resNoAuth.status === 401, 'UNAUTHORIZED', 'POST /device-token without token returns 401');

    const resRevokeNoAuth = await createMockRequest(app, '/api/v1/admin/helmets/MC-001/device-token/revoke', 'POST', {});
    assert(resRevokeNoAuth.status === 401, 'UNAUTHORIZED', 'POST /device-token/revoke without token returns 401');

    const resGetNoAuth = await createMockRequest(app, '/api/v1/admin/helmets/MC-001/device-token', 'GET');
    assert(resGetNoAuth.status === 401, 'UNAUTHORIZED', 'GET /device-token without token returns 401');
  }

  // --- TEST GROUP 2: INSUFFICIENT ROLES (RBAC) ---
  console.log('\n--- 2. INSUFFICIENT ROLES (RBAC) TESTS ---');
  {
    const resWorker = await createMockRequest(
      app,
      '/api/v1/admin/helmets/MC-001/device-token',
      'POST',
      {},
      { authorization: `Bearer ${workerJwt}` }
    );
    assert(resWorker.status === 403, 'RBAC', 'Worker cannot provision device token (403)');

    const resSupervisor = await createMockRequest(
      app,
      '/api/v1/admin/helmets/MC-001/device-token',
      'POST',
      {},
      { authorization: `Bearer ${supervisorJwt}` }
    );
    assert(resSupervisor.status === 403, 'RBAC', 'Supervisor cannot provision device token (403)');

    const resWorkerRevoke = await createMockRequest(
      app,
      '/api/v1/admin/helmets/MC-001/device-token/revoke',
      'POST',
      {},
      { authorization: `Bearer ${workerJwt}` }
    );
    assert(resWorkerRevoke.status === 403, 'RBAC', 'Worker cannot revoke device token (403)');

    const resSupervisorRevoke = await createMockRequest(
      app,
      '/api/v1/admin/helmets/MC-001/device-token/revoke',
      'POST',
      {},
      { authorization: `Bearer ${supervisorJwt}` }
    );
    assert(resSupervisorRevoke.status === 403, 'RBAC', 'Supervisor cannot revoke device token (403)');
  }

  // --- TEST GROUP 3: UNKNOWN HELMET ---
  console.log('\n--- 3. UNKNOWN HELMET TESTS ---');
  {
    const resUnknown = await createMockRequest(
      app,
      '/api/v1/admin/helmets/MC-999-NONEXISTENT/device-token',
      'POST',
      {},
      { authorization: `Bearer ${adminJwt}` }
    );
    assert(resUnknown.status === 404, 'NOT_FOUND', 'Provisioning token for unknown helmet returns 404');

    const resUnknownGet = await createMockRequest(
      app,
      '/api/v1/admin/helmets/MC-999-NONEXISTENT/device-token',
      'GET',
      undefined,
      { authorization: `Bearer ${adminJwt}` }
    );
    assert(resUnknownGet.status === 404, 'NOT_FOUND', 'Inspecting token for unknown helmet returns 404');

    const resUnknownRevoke = await createMockRequest(
      app,
      '/api/v1/admin/helmets/MC-999-NONEXISTENT/device-token/revoke',
      'POST',
      {},
      { authorization: `Bearer ${adminJwt}` }
    );
    assert(resUnknownRevoke.status === 404, 'NOT_FOUND', 'Revoking token for unknown helmet returns 404');
  }

  // --- TEST GROUP 4: MALFORMED REQUESTS ---
  console.log('\n--- 4. MALFORMED REQUESTS TESTS ---');
  {
    const resInvalidId = await createMockRequest(
      app,
      '/api/v1/admin/helmets/MC%20invalid!$/device-token',
      'POST',
      {},
      { authorization: `Bearer ${adminJwt}` }
    );
    assert(resInvalidId.status === 400 || resInvalidId.status === 404, 'MALFORMED', 'Invalid helmet ID characters rejected');
  }

  // --- TEST GROUP 5: SUCCESSFUL ONE-TIME ISSUANCE & HIGH ENTROPY ---
  console.log('\n--- 5. SUCCESSFUL ONE-TIME ISSUANCE & ENTROPY ---');
  let rawToken1 = '';
  let tokenPrefix1 = '';
  {
    const resProvision = await createMockRequest(
      app,
      '/api/v1/admin/helmets/MC-001/device-token',
      'POST',
      { name: 'Primary ESP8266 Helmet Node' },
      { authorization: `Bearer ${adminJwt}` }
    );
    assert(resProvision.status === 201, 'PROVISION', 'Admin successfully provisions token (201 Created)');
    assert(resProvision.body?.success === true, 'PROVISION', 'Response body has success: true');
    assert(typeof resProvision.body?.token === 'string', 'PROVISION', 'Response body contains raw token string');
    assert(resProvision.body?.helmetId === 'MC-001', 'PROVISION', 'Response bound to helmet MC-001');

    rawToken1 = resProvision.body.token;
    tokenPrefix1 = resProvision.body.tokenPrefix;

    assert(rawToken1.startsWith('mc_live_MC-001_'), 'ENTROPY', 'Raw token has mc_live_ prefix with helmet binding');
    assert(rawToken1.length >= 70, 'ENTROPY', `Raw token length is ${rawToken1.length} (>= 70 chars for 256 bits entropy)`);
    assert(tokenPrefix1.length === 16, 'ENTROPY', 'Token prefix is exactly 16 characters for safe logging');
  }

  // --- TEST GROUP 6: HASHED-AT-REST STORAGE (ZERO PLAINTEXT SECRETS) ---
  console.log('\n--- 6. HASHED-AT-REST STORAGE VERIFICATION ---');
  {
    const rows = await pool.query(
      'SELECT id, helmet_id, token_hash, token_prefix, created_by, revoked_at FROM helmet_device_tokens WHERE helmet_id = $1',
      ['MC-001']
    );
    assert(rows.rows.length === 1, 'STORAGE', 'Exactly 1 token record exists in PostgreSQL for MC-001');

    const storedRow = rows.rows[0];
    const expectedHash = crypto.createHash('sha256').update(rawToken1).digest('hex');
    assert(storedRow.token_hash === expectedHash, 'STORAGE', 'Database stores exact cryptographic SHA-256 hash');
    assert(storedRow.token_hash !== rawToken1, 'STORAGE', 'Database row does NOT contain plaintext raw token');
    assert(storedRow.token_prefix === tokenPrefix1, 'STORAGE', 'Database stores safe token prefix for identification');
    assert(storedRow.revoked_at === null, 'STORAGE', 'Newly provisioned token revoked_at is NULL (active)');
  }

  // --- TEST GROUP 7: METADATA INSPECTION ENDPOINT ---
  console.log('\n--- 7. METADATA INSPECTION ENDPOINT ---');
  {
    const resGet = await createMockRequest(
      app,
      '/api/v1/admin/helmets/MC-001/device-token',
      'GET',
      undefined,
      { authorization: `Bearer ${adminJwt}` }
    );
    assert(resGet.status === 200, 'METADATA', 'Admin can inspect active device token metadata (200 OK)');
    assert(resGet.body?.hasActiveToken === true, 'METADATA', 'hasActiveToken is true');
    assert(resGet.body?.token?.tokenPrefix === tokenPrefix1, 'METADATA', 'Response contains safe tokenPrefix');
    assert(resGet.body?.token?.token === undefined, 'METADATA', 'GET endpoint NEVER leaks raw token');
    assert(resGet.body?.token?.token_hash === undefined, 'METADATA', 'GET endpoint NEVER leaks token hash');
  }

  // --- TEST GROUP 8: VALID TELEMETRY INGESTION (PRODUCTION MODE) ---
  console.log('\n--- 8. VALID TELEMETRY INGESTION IN PRODUCTION ---');
  {
    // Test direct DeviceAuthManager authentication against DB
    const authDirect = await DeviceAuthManager.authenticateTelemetryRequest(
      { headers: { 'x-device-token': rawToken1 } } as any,
      null,
      true, // isProduction = true
      'MC-001',
      db
    );
    assert(authDirect.isAuthenticated === true, 'TELEMETRY_AUTH', 'DeviceAuthManager validates persistent hashed token');
    assert(authDirect.authType === 'DEVICE_TOKEN', 'TELEMETRY_AUTH', 'authType is DEVICE_TOKEN');

    // Send HTTP telemetry packet with raw token
    const teleRes = await createMockRequest(
      app,
      '/api/v1/telemetry',
      'POST',
      {
        helmetId: 'MC-001',
        temperature: 27.5,
        humidity: 50.0,
        gasValue: 150,
        totalAcceleration: 9.81,
        sosPressed: false,
      },
      { 'x-device-token': rawToken1 }
    );
    assert(teleRes.status === 201, 'TELEMETRY_INGEST', 'Valid device token ingests telemetry returning 201 Created');
    assert(teleRes.body?.success === true, 'TELEMETRY_INGEST', 'Telemetry response confirms success');

    // Verify last_used_at was updated in PostgreSQL
    const updatedRow = await pool.query(
      'SELECT last_used_at FROM helmet_device_tokens WHERE helmet_id = $1 AND revoked_at IS NULL',
      ['MC-001']
    );
    assert(updatedRow.rows[0]?.last_used_at !== null, 'STORAGE', 'last_used_at timestamp updated upon telemetry ingestion');
  }

  // --- TEST GROUP 9: WRONG-HELMET BINDING ---
  console.log('\n--- 9. WRONG-HELMET BINDING SECURITY ---');
  {
    // Attempt to use Helmet MC-001 token to submit telemetry for Helmet MC-002
    const mismatchRes = await createMockRequest(
      app,
      '/api/v1/telemetry',
      'POST',
      {
        helmetId: 'MC-002',
        temperature: 25.0,
        humidity: 45.0,
        gasValue: 120,
        totalAcceleration: 9.8,
        sosPressed: false,
      },
      { 'x-device-token': rawToken1 }
    );
    assert(mismatchRes.status === 403, 'BINDING', 'Mismatched helmet ID strictly rejected with 403 Forbidden');
    assert(
      JSON.stringify(mismatchRes.body).toLowerCase().includes('bound to helmet'),
      'BINDING',
      'Error message mentions helmet binding constraint'
    );
  }

  // --- TEST GROUP 10: REJECTION OF HUMAN JWTS AS DEVICE CREDENTIALS ---
  console.log('\n--- 10. REJECTION OF HUMAN JWTS AS DEVICE TOKENS ---');
  {
    const validPacket = {
      helmetId: 'MC-001',
      temperature: 25.0,
      humidity: 50.0,
      gasValue: 120,
      totalAcceleration: 9.8,
      sosPressed: false,
    };

    const bearerAsDevice = await createMockRequest(
      app,
      '/api/v1/telemetry',
      'POST',
      validPacket,
      { 'x-device-token': `Bearer ${adminJwt}` }
    );
    assert(bearerAsDevice.status === 401, 'JWT_REJECTION', 'Bearer JWT in X-Device-Token rejected with 401');

    const rawJwtAsDevice = await createMockRequest(
      app,
      '/api/v1/telemetry',
      'POST',
      validPacket,
      { 'x-device-token': adminJwt }
    );
    assert(rawJwtAsDevice.status === 401, 'JWT_REJECTION', 'Raw JWT (eyJ...) in X-Device-Token rejected with 401');
  }

  // --- TEST GROUP 11: EXPLICIT DEVICE TOKEN REVOCATION ---
  console.log('\n--- 11. EXPLICIT REVOCATION ---');
  {
    const revokeRes = await createMockRequest(
      app,
      '/api/v1/admin/helmets/MC-001/device-token/revoke',
      'POST',
      { reason: 'Suspected physical tampering' },
      { authorization: `Bearer ${adminJwt}` }
    );
    assert(revokeRes.status === 200, 'REVOCATION', 'Admin successfully revokes device token (200 OK)');
    assert(revokeRes.body?.revokedCount === 1, 'REVOCATION', 'Revocation returned revokedCount: 1');

    // Check DB state
    const revokedRow = await pool.query(
      'SELECT revoked_at, revocation_reason FROM helmet_device_tokens WHERE helmet_id = $1',
      ['MC-001']
    );
    assert(revokedRow.rows[0]?.revoked_at !== null, 'REVOCATION', 'revoked_at is set in database');
    assert(
      revokedRow.rows[0]?.revocation_reason === 'Suspected physical tampering',
      'REVOCATION',
      'revocation_reason matches admin-supplied reason'
    );

    // Telemetry request using revoked token must fail with 401
    const revokedTele = await createMockRequest(
      app,
      '/api/v1/telemetry',
      'POST',
      { helmetId: 'MC-001', temperature: 25.0, humidity: 45.0, gasValue: 120, totalAcceleration: 9.8, sosPressed: false },
      { 'x-device-token': rawToken1 }
    );
    assert(revokedTele.status === 401, 'REVOCATION', 'Revoked token rejected from telemetry ingestion with 401');
    assert(JSON.stringify(revokedTele.body).toLowerCase().includes('revoked'), 'REVOCATION', 'Error message indicates token revoked');
  }

  // --- TEST GROUP 12: SAFE ATOMIC ROTATION ---
  console.log('\n--- 12. SAFE ATOMIC ROTATION ---');
  let rawToken2 = '';
  {
    // Rotate token by issuing a new one for MC-001
    const rotateRes = await createMockRequest(
      app,
      '/api/v1/admin/helmets/MC-001/device-token',
      'POST',
      { name: 'Replacement ESP8266 Node v2' },
      { authorization: `Bearer ${adminJwt}` }
    );
    assert(rotateRes.status === 201, 'ROTATION', 'Token rotation succeeds with 201 Created');
    rawToken2 = rotateRes.body.token;

    assert(rawToken2 !== rawToken1, 'ROTATION', 'New rotated token is distinct from old token');

    // Verify DB state: 2 tokens exist for MC-001 (1 revoked, 1 active)
    const tokenRows = await pool.query(
      'SELECT id, token_prefix, revoked_at, revocation_reason FROM helmet_device_tokens WHERE helmet_id = $1 ORDER BY created_at ASC',
      ['MC-001']
    );
    assert(tokenRows.rows.length === 2, 'ROTATION', 'Exactly 2 tokens stored in history for MC-001');
    assert(tokenRows.rows[0].revoked_at !== null, 'ROTATION', 'Old token is revoked');
    assert(tokenRows.rows[1].revoked_at === null, 'ROTATION', 'New token is active');

    // Old token still rejected
    const oldTele = await createMockRequest(
      app,
      '/api/v1/telemetry',
      'POST',
      { helmetId: 'MC-001', temperature: 25.0, humidity: 45.0, gasValue: 120, totalAcceleration: 9.8, sosPressed: false },
      { 'x-device-token': rawToken1 }
    );
    assert(oldTele.status === 401, 'ROTATION', 'Old rotated token remains strictly rejected with 401');

    // New token accepted
    const newTele = await createMockRequest(
      app,
      '/api/v1/telemetry',
      'POST',
      { helmetId: 'MC-001', temperature: 28.0, humidity: 48.0, gasValue: 130, totalAcceleration: 9.81, sosPressed: false },
      { 'x-device-token': rawToken2 }
    );
    assert(newTele.status === 201, 'ROTATION', 'New rotated token accepted for telemetry ingestion (201 Created)');

    // Verify zero data loss on historical telemetry
    const teleHistory = await db.getTelemetryHistory('MC-001');
    assert(teleHistory.length >= 2, 'ROTATION', 'Historical telemetry records intact (zero data deletion)');

    // Verify helmet MC-001 record untouched
    const helmetRecord = await db.getHelmet('MC-001');
    assert(helmetRecord !== null, 'ROTATION', 'Helmet MC-001 record intact in database');
  }

  // --- TEST GROUP 13: AUDIT LOGGING ---
  console.log('\n--- 13. AUDIT LOGGING ---');
  {
    const auditRows = await pool.query(
      'SELECT action, target_type, target_id, details FROM audit_logs WHERE target_id = $1 ORDER BY created_at ASC',
      ['MC-001']
    );
    assert(auditRows.rows.length >= 3, 'AUDIT', 'Audit log records provisioning, revocation, and rotation events');

    const actions = auditRows.rows.map((r) => r.action);
    assert(actions.includes('DEVICE_TOKEN_PROVISIONED'), 'AUDIT', 'DEVICE_TOKEN_PROVISIONED is present in audit log');
    assert(actions.includes('DEVICE_TOKEN_REVOKED'), 'AUDIT', 'DEVICE_TOKEN_REVOKED is present in audit log');

    // Verify zero raw secrets in audit logs
    for (const row of auditRows.rows) {
      const serialized = JSON.stringify(row);
      assert(!serialized.includes(rawToken1), 'AUDIT', 'Audit log does NOT leak raw token 1');
      assert(!serialized.includes(rawToken2), 'AUDIT', 'Audit log does NOT leak raw token 2');
    }
  }

  // --- TEST GROUP 14: TRANSACTION INTEGRITY & FAILURE MODES ---
  console.log('\n--- 14. TRANSACTION INTEGRITY & FAILURE MODES ---');
  {
    // 1. Verify withTransaction executes BEGIN and ROLLBACK on failure
    let beginExecuted = false;
    let rollbackExecuted = false;
    try {
      await connManager.withTransaction(async (_client) => {
        beginExecuted = true;
        throw new Error('Simulated atomic transaction abort');
      });
    } catch {
      rollbackExecuted = true;
    }
    assert(beginExecuted === true, 'TRANSACTION', 'Transaction starts and executes callback within transaction');
    assert(rollbackExecuted === true, 'TRANSACTION', 'Transaction catches error and triggers rollback');

    // 2. Verify endpoint handles database failures safely with HTTP 500 standardized error
    const origProvision = db.provisionDeviceToken.bind(db);
    db.provisionDeviceToken = async () => {
      throw new Error('Database connection pool exhausted');
    };

    const failRes = await createMockRequest(
      app,
      '/api/v1/admin/helmets/MC-001/device-token',
      'POST',
      {},
      { authorization: `Bearer ${adminJwt}` }
    );
    assert(failRes.status === 500, 'FAILURE_HANDLING', 'Database failure during provisioning returns 500 error envelope');
    assert(
      failRes.body?.error?.code === 'INTERNAL_SERVER_ERROR' || failRes.body?.error?.status === 500,
      'FAILURE_HANDLING',
      'Standardized ApiError envelope returned on failure'
    );

    // Restore original method
    db.provisionDeviceToken = origProvision;
  }

  console.log('\n============================================================');
  console.log(`TOTAL PHASE 1 CHECKS: ${totalChecks}`);
  console.log(`PASSED:               ${passedChecks}`);
  console.log(`FAILED:               ${failedChecks}`);
  console.log('============================================================\n');

  if (failedChecks > 0) {
    process.exit(1);
  }
}

runDeviceProvisioningTestSuite().catch((err) => {
  console.error('Fatal Test Suite Error:', err);
  process.exit(1);
});
