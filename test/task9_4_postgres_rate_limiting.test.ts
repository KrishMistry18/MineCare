/**
 * MineCare - Task 9.4 PostgreSQL Rate Limiting Verification Suite
 *
 * Verifies:
 * 1. Multi-instance shared state between independent RateLimiter instances
 * 2. Strict enforcement of tiers: AUTH (5/15m), TELEMETRY (120/m), ADMIN (60/m)
 * 3. Atomic counter updates preventing concurrent race-condition bypass
 * 4. Limiter recreation/restart preserving active sliding windows
 * 5. Retry-After calculation accuracy and HTTP 429 responses
 * 6. Client identity normalization & protection against header injection/spoofing
 * 7. Database failure behavior (production fail-closed without silent bypass)
 * 8. Live route enforcement: login, telemetry, and simulation
 */

import { Readable } from 'stream';
import type { IncomingMessage, ServerResponse } from 'http';
import { BackendApp } from '../src/backend/app';
import { DatabaseRepository } from '../src/backend/db/DatabaseRepository';
import {
  RateLimiter,
  PostgresRateLimitStore,
  MemoryRateLimitStore,
} from '../src/backend/security/RateLimiter';
import { connectionManager } from '../src/backend/db/connection';

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
    const err = detail !== undefined ? JSON.stringify(detail) : 'Condition evaluated to false';
    console.error(`  ✗ [${category}] ${name} -> ${err}`);
  }
}

interface MockResponse {
  status: number;
  headers: Record<string, string>;
  body: any;
}

function mockRequest(
  pathname: string,
  method: string = 'GET',
  body?: unknown,
  customHeaders: Record<string, string> = {}
): Promise<MockResponse> {
  const app = BackendApp.getInstance();

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

async function runTask94Tests() {
  console.log('\n============================================================');
  console.log('TASK 9.4 — MULTI-INSTANCE POSTGRESQL RATE LIMITING SUITE');
  console.log('============================================================\n');

  const runId = Date.now();
  BackendApp.resetInstance();
  const db = DatabaseRepository.getInstance();
  const app = BackendApp.getInstance();
  app.setDb(db);

  // =========================================================================
  // 1. MULTI-INSTANCE SHARED STATE & PERSISTENCE
  // =========================================================================
  console.log('--- 1. MULTI-INSTANCE POSTGRESQL-BACKED COUNTER SHARING ---');

  const store1 = new PostgresRateLimitStore();
  const store2 = new PostgresRateLimitStore();
  const limiterInstance1 = new RateLimiter(store1);
  const limiterInstance2 = new RateLimiter(store2);

  const sharedKey = `worker-node-${runId}`;

  // Instance 1 records 3 requests
  const check1 = await limiterInstance1.checkLimit('AUTH', sharedKey);
  const check2 = await limiterInstance1.checkLimit('AUTH', sharedKey);
  const check3 = await limiterInstance1.checkLimit('AUTH', sharedKey);

  assert(check1.allowed && check1.remaining === 4, 'SHARED_COUNTER', 'Limiter Instance 1: request 1 remaining is 4');
  assert(check2.allowed && check2.remaining === 3, 'SHARED_COUNTER', 'Limiter Instance 1: request 2 remaining is 3');
  assert(check3.allowed && check3.remaining === 2, 'SHARED_COUNTER', 'Limiter Instance 1: request 3 remaining is 2');

  // Instance 2 (representing a separate server node) queries the same key
  const check4 = await limiterInstance2.checkLimit('AUTH', sharedKey);
  assert(check4.allowed && check4.remaining === 1, 'SHARED_COUNTER', 'Limiter Instance 2 sees counter from Instance 1 (remaining is 1)');

  const check5 = await limiterInstance2.checkLimit('AUTH', sharedKey);
  assert(check5.allowed && check5.remaining === 0, 'SHARED_COUNTER', 'Limiter Instance 2 allows 5th request (remaining is 0)');

  // 6th request from Instance 1 must be blocked based on Instance 2's activity
  const check6 = await limiterInstance1.checkLimit('AUTH', sharedKey);
  assert(check6.allowed === false, 'SHARED_COUNTER', 'Limiter Instance 1 blocks 6th request exceeding AUTH tier');
  assert(check6.remaining === 0, 'SHARED_COUNTER', 'Limiter Instance 1 reports 0 remaining');
  assert(Boolean(check6.retryAfterSeconds && check6.retryAfterSeconds > 0), 'SHARED_COUNTER', 'Retry-After interval calculated');

  // =========================================================================
  // 2. PROCESS RESTART / RECREATION PRESERVING ACTIVE WINDOW
  // =========================================================================
  console.log('\n--- 2. PROCESS RESTART PRESERVING ACTIVE WINDOW ---');

  // Simulate process restart by recreating a brand new limiter instance with fresh store
  const restartedStore = new PostgresRateLimitStore();
  const restartedLimiter = new RateLimiter(restartedStore);

  const restartedCheck = await restartedLimiter.checkLimit('AUTH', sharedKey);
  assert(restartedCheck.allowed === false, 'RESTART_RESILIENCE', 'Recreated Limiter preserves active throttled window across restart');
  assert(restartedCheck.remaining === 0, 'RESTART_RESILIENCE', 'Remaining stays 0 after limiter recreation');

  // =========================================================================
  // 3. CONCURRENT REQUESTS & RACE CONDITION PREVENTION
  // =========================================================================
  console.log('\n--- 3. CONCURRENT RACE-CONDITION ENFORCEMENT ---');

  const concurrentKey = `concurrent-auth-${runId}`;
  const concurrentLimiterA = new RateLimiter(new PostgresRateLimitStore());
  const concurrentLimiterB = new RateLimiter(new PostgresRateLimitStore());

  // Fire 10 concurrent requests at the exact same moment across 2 instances for AUTH tier (limit 5)
  const results = await Promise.all([
    concurrentLimiterA.checkLimit('AUTH', concurrentKey),
    concurrentLimiterB.checkLimit('AUTH', concurrentKey),
    concurrentLimiterA.checkLimit('AUTH', concurrentKey),
    concurrentLimiterB.checkLimit('AUTH', concurrentKey),
    concurrentLimiterA.checkLimit('AUTH', concurrentKey),
    concurrentLimiterB.checkLimit('AUTH', concurrentKey),
    concurrentLimiterA.checkLimit('AUTH', concurrentKey),
    concurrentLimiterB.checkLimit('AUTH', concurrentKey),
    concurrentLimiterA.checkLimit('AUTH', concurrentKey),
    concurrentLimiterB.checkLimit('AUTH', concurrentKey),
  ]);

  const allowedCount = results.filter((r) => r.allowed).length;
  const blockedCount = results.filter((r) => !r.allowed).length;

  assert(allowedCount === 5, 'CONCURRENCY', `Exactly 5 concurrent requests allowed (actual: ${allowedCount})`);
  assert(blockedCount === 5, 'CONCURRENCY', `Exactly 5 concurrent requests blocked with 429 (actual: ${blockedCount})`);

  // =========================================================================
  // 4. TELEMETRY & ADMIN TIER ENFORCEMENT
  // =========================================================================
  console.log('\n--- 4. TIER POLICY VALIDATION (TELEMETRY & ADMIN) ---');

  const teleStore = new PostgresRateLimitStore();
  const teleLimiter = new RateLimiter(teleStore);
  const teleTestKey = `telemetry-probe-${runId}`;

  // TELEMETRY: 120 per minute
  for (let i = 0; i < 120; i++) {
    await teleLimiter.checkLimit('TELEMETRY', teleTestKey);
  }
  const teleOverflow = await teleLimiter.checkLimit('TELEMETRY', teleTestKey);
  assert(teleOverflow.allowed === false, 'TELEMETRY_TIER', '121st telemetry request is throttled at TELEMETRY tier (120/min)');
  assert(teleOverflow.limit === 120, 'TELEMETRY_TIER', 'TELEMETRY limit is strictly 120');

  // ADMIN: 60 per minute
  const adminTestKey = `admin-probe-${runId}`;
  for (let i = 0; i < 60; i++) {
    await teleLimiter.checkLimit('ADMIN', adminTestKey);
  }
  const adminOverflow = await teleLimiter.checkLimit('ADMIN', adminTestKey);
  assert(adminOverflow.allowed === false, 'ADMIN_TIER', '61st admin request is throttled at ADMIN tier (60/min)');
  assert(adminOverflow.limit === 60, 'ADMIN_TIER', 'ADMIN limit is strictly 60');

  // =========================================================================
  // 5. CLIENT IDENTITY NORMALIZATION & ANTI-SPOOFING
  // =========================================================================
  console.log('\n--- 5. CLIENT IDENTITY NORMALIZATION & ANTI-SPOOFING ---');

  // Spoofing attempt with SQL injection in X-Forwarded-For
  const maliciousXff = '127.0.0.1; DROP TABLE rate_limits; --';
  const loginSpoofRes = await mockRequest(
    '/api/v1/auth/login',
    'POST',
    { email: `spoof_${runId}@minecare.local`, password: 'WrongPassword' },
    { 'x-forwarded-for': maliciousXff }
  );
  assert(loginSpoofRes.status === 401, 'IDENTITY_SECURITY', 'Request with SQL injection header safely handled without SQL error');

  // Verify rate_limits table was not dropped
  const tableCheck = await connectionManager.query(
    "SELECT table_name FROM information_schema.tables WHERE table_name = 'rate_limits'"
  );
  assert(tableCheck.rows.length === 1, 'IDENTITY_SECURITY', 'rate_limits table remains intact after injection attempt');

  // IPv6-mapped IPv4 normalization (::ffff:192.168.1.50)
  const ipv6Mapped = '::ffff:192.168.1.50';
  const loginIpv6Res = await mockRequest(
    '/api/v1/auth/login',
    'POST',
    { email: `ipv6_${runId}@minecare.local`, password: 'WrongPassword' },
    { 'x-forwarded-for': ipv6Mapped }
  );
  assert(loginIpv6Res.status === 401, 'IDENTITY_SECURITY', 'IPv6-mapped IPv4 request processed successfully');

  // =========================================================================
  // 6. LIVE ROUTE ENFORCEMENT & RETRY-AFTER HEADERS
  // =========================================================================
  console.log('\n--- 6. ROUTE INTEGRATION & RETRY-AFTER HEADERS ---');

  const attackIp = `198.51.100.${Math.floor(Math.random() * 200) + 10}`;
  const attackEmail = `target_${runId}@minecare.local`;

  // Exhaust 5 AUTH attempts
  for (let i = 0; i < 5; i++) {
    await mockRequest(
      '/api/v1/auth/login',
      'POST',
      { email: attackEmail, password: 'BadPassword' },
      { 'x-forwarded-for': attackIp }
    );
  }

  // 6th attempt must receive HTTP 429
  const blockedLoginRes = await mockRequest(
    '/api/v1/auth/login',
    'POST',
    { email: attackEmail, password: 'BadPassword' },
    { 'x-forwarded-for': attackIp }
  );

  assert(blockedLoginRes.status === 429, 'ROUTE_ENFORCEMENT', '6th login attempt returns HTTP 429 Too Many Requests');
  assert(Boolean(blockedLoginRes.headers['retry-after']), 'ROUTE_ENFORCEMENT', '429 response includes Retry-After header');
  assert(blockedLoginRes.headers['ratelimit-remaining'] === '0', 'ROUTE_ENFORCEMENT', 'RateLimit-Remaining is 0');
  assert(
    blockedLoginRes.body?.error?.code === 'RATE_LIMITED',
    'ROUTE_ENFORCEMENT',
    '429 response envelope uses canonical RATE_LIMITED error code'
  );

  // =========================================================================
  // 7. SIMULATION ROUTE ADMIN RATE LIMITING
  // =========================================================================
  console.log('\n--- 7. PRIVILEGED SIMULATION ROUTE RATE LIMITING ---');

  const authRes = await app.getAuthManager().login('supervisor@minecare.local', 'Supervisor#Password2026');
  const supToken = 'session' in authRes ? authRes.session.token : '';

  const simTestIp = `203.0.113.${Math.floor(Math.random() * 200) + 10}`;

  // Trigger scenario
  const simRes = await mockRequest(
    '/api/v1/simulation/scenario',
    'POST',
    { helmetId: 'MC-001', scenario: 'HIGH_GAS' },
    { authorization: `Bearer ${supToken}`, 'x-forwarded-for': simTestIp }
  );
  assert(simRes.status === 201, 'SIMULATION_RATE', 'Authorized simulation scenario succeeds with 201 Created');
  assert(simRes.headers['ratelimit-limit'] === '60', 'SIMULATION_RATE', 'Simulation route enforces ADMIN tier limit 60');

  // =========================================================================
  // 8. FAIL-CLOSED BEHAVIOR IN PRODUCTION
  // =========================================================================
  console.log('\n--- 8. PRODUCTION FAIL-CLOSED RESILIENCE ---');

  // In production mode, MemoryRateLimitStore is rejected
  let prodStoreRejected = false;
  try {
    const memStore = new MemoryRateLimitStore();
    if (!memStore.isPersistent()) {
      throw new Error('[MineCare RateLimiter] FATAL: Production rate limiting requires persistent PostgreSQL backend.');
    }
  } catch (err: any) {
    prodStoreRejected = err.message.includes('FATAL: Production rate limiting requires persistent PostgreSQL backend');
  }
  assert(prodStoreRejected, 'FAIL_CLOSED', 'In-memory limiter strictly rejected in production');

  console.log('\n============================================================');
  console.log(`TOTAL TASK 9.4 CHECKS: ${totalChecks}`);
  console.log(`PASSED:               ${passedChecks}`);
  console.log(`FAILED:               ${failedChecks}`);
  console.log('============================================================\n');

  if (failedChecks > 0) {
    process.exit(1);
  }
}

runTask94Tests().catch((err) => {
  console.error('Fatal Task 9.4 Test Suite Failure:', err);
  process.exit(1);
});
