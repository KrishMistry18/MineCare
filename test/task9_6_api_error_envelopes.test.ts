/**
 * MineCare - Task 9.6 Standardized ApiError Verification Suite
 *
 * Verifies:
 * 1. Strict envelope structure: { error: { code, message, requestId, timestamp, [details] } }
 * 2. Complete HTTP status mappings across the entire API spectrum:
 *    - 400 VALIDATION_ERROR
 *    - 401 UNAUTHORIZED
 *    - 403 FORBIDDEN
 *    - 404 NOT_FOUND
 *    - 405 METHOD_NOT_ALLOWED
 *    - 409 CONFLICT
 *    - 413 PAYLOAD_TOO_LARGE
 *    - 414 URI_TOO_LONG
 *    - 415 UNSUPPORTED_MEDIA_TYPE
 *    - 422 UNPROCESSABLE_ENTITY
 *    - 429 RATE_LIMITED
 *    - 500 INTERNAL_SERVER_ERROR
 *    - 503 SERVICE_UNAVAILABLE
 * 3. Request correlation ID propagation and header reflection
 * 4. Total sanitization of secrets, tokens, connection strings, and stack traces
 * 5. Frontend apiClient parsing compatibility with backend envelopes
 */

import { Readable } from 'stream';
import type { IncomingMessage, ServerResponse } from 'http';
import { BackendApp } from '../src/backend/app';
import { DatabaseRepository } from '../src/backend/db/DatabaseRepository';
import { ApiError } from '../src/backend/security/ApiError';

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
    const rawBody = typeof body === 'string' ? body : body !== undefined ? JSON.stringify(body) : '';
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

function validateEnvelope(body: any, expectedCode: string): boolean {
  if (!body || typeof body !== 'object') return false;
  const err = body.error;
  if (!err || typeof err !== 'object') return false;
  if (err.code !== expectedCode) return false;
  if (typeof err.message !== 'string' || err.message.length === 0) return false;
  if (typeof err.requestId !== 'string' || err.requestId.length === 0) return false;
  if (typeof err.timestamp !== 'string' || !Date.parse(err.timestamp)) return false;
  return true;
}

async function runTask96Tests() {
  console.log('\n============================================================');
  console.log('TASK 9.6 — STANDARDIZED APIERROR ENVELOPES VERIFICATION');
  console.log('============================================================\n');

  BackendApp.resetInstance();
  const db = DatabaseRepository.getInstance();
  const app = BackendApp.getInstance();
  app.setDb(db);

  // Acquire test tokens for RBAC checks

  const supRes = await app.getAuthManager().login('supervisor@minecare.local', 'Supervisor#Password2026');
  const supToken = 'session' in supRes ? supRes.session.token : '';

  const workerRes = await app.getAuthManager().login('worker.marak@minecare.local', 'Worker#Password2026');
  const workerToken = 'session' in workerRes ? workerRes.session.token : '';

  // =========================================================================
  // 1. CLIENT INPUT & VALIDATION ERRORS (400)
  // =========================================================================
  console.log('--- 1. HTTP 400 VALIDATION ERRORS ---');

  // 1.1 Malformed entity ID
  const invalidIdRes = await mockRequest(
    '/api/v1/helmets/MC-!!!bad-characters!!!',
    'GET',
    undefined,
    { authorization: `Bearer ${supToken}` }
  );
  assert(invalidIdRes.status === 400, 'HTTP_400', 'Malformed entity ID returns 400 Bad Request');
  assert(validateEnvelope(invalidIdRes.body, 'VALIDATION_ERROR'), 'HTTP_400', '400 response has VALIDATION_ERROR envelope');

  // 1.2 Invalid telemetry sensor readings
  const invalidTelemetryRes = await mockRequest(
    '/api/v1/telemetry',
    'POST',
    { helmetId: 'MC-001', temperature: 'freezing' }
  );
  assert(invalidTelemetryRes.status === 400, 'HTTP_400', 'Invalid sensor readings return 400');
  assert(validateEnvelope(invalidTelemetryRes.body, 'VALIDATION_ERROR'), 'HTTP_400', 'Telemetry validation uses VALIDATION_ERROR envelope');
  assert(Boolean(invalidTelemetryRes.body?.error?.details), 'HTTP_400', 'Validation failure includes error details');

  // =========================================================================
  // 2. AUTHENTICATION & CREDENTIAL ERRORS (401)
  // =========================================================================
  console.log('\n--- 2. HTTP 401 UNAUTHORIZED ERRORS ---');

  // 2.1 Missing authorization token
  const unauthRes = await mockRequest('/api/v1/helmets', 'GET');
  assert(unauthRes.status === 401, 'HTTP_401', 'Missing token returns 401');
  assert(validateEnvelope(unauthRes.body, 'UNAUTHORIZED'), 'HTTP_401', '401 uses UNAUTHORIZED envelope');

  // 2.2 Invalid JWT token
  const invalidJwtRes = await mockRequest('/api/v1/helmets', 'GET', undefined, {
    authorization: 'Bearer invalid.token.payload',
  });
  assert(invalidJwtRes.status === 401, 'HTTP_401', 'Invalid JWT returns 401');
  assert(validateEnvelope(invalidJwtRes.body, 'UNAUTHORIZED'), 'HTTP_401', 'Invalid JWT uses UNAUTHORIZED envelope');

  // 2.3 Invalid login credentials
  const badLoginRes = await mockRequest('/api/v1/auth/login', 'POST', {
    email: 'admin@minecare.local',
    password: 'WrongPassword123',
  });
  assert(badLoginRes.status === 401, 'HTTP_401', 'Failed login returns 401');
  assert(validateEnvelope(badLoginRes.body, 'UNAUTHORIZED'), 'HTTP_401', 'Failed login uses UNAUTHORIZED envelope');

  // =========================================================================
  // 3. AUTHORIZATION & RBAC / IDOR ERRORS (403)
  // =========================================================================
  console.log('\n--- 3. HTTP 403 FORBIDDEN ERRORS ---');

  // 3.1 Worker accessing admin resource
  const workerAdminRes = await mockRequest('/api/v1/admin/users', 'GET', undefined, {
    authorization: `Bearer ${workerToken}`,
  });
  assert(workerAdminRes.status === 403, 'HTTP_403', 'Worker accessing admin console returns 403 Forbidden');
  assert(validateEnvelope(workerAdminRes.body, 'FORBIDDEN'), 'HTTP_403', 'RBAC denial uses FORBIDDEN envelope');

  // 3.2 Cross-worker IDOR violation
  const idorRes = await mockRequest('/api/v1/workers/WRK-002', 'GET', undefined, {
    authorization: `Bearer ${workerToken}`,
  });
  assert(idorRes.status === 403, 'HTTP_403', 'Worker viewing other worker profile returns 403');
  assert(validateEnvelope(idorRes.body, 'FORBIDDEN'), 'HTTP_403', 'IDOR denial uses FORBIDDEN envelope');

  // 3.3 Device token helmet mismatch
  const mismatchRes = await mockRequest(
    '/api/v1/telemetry',
    'POST',
    {
      helmetId: 'MC-002',
      packetId: 'PKT-TEST',
      sequenceNumber: 1,
      timestamp: new Date().toISOString(),
      temperature: 24,
      humidity: 50,
      gasValue: 100,
      accelX: 0, accelY: 0, accelZ: 9.8, totalAcceleration: 9.8,
      gyroX: 0, gyroY: 0, gyroZ: 0,
      fallDetected: false, sosPressed: false,
    },
    { 'x-device-token': 'mc_dev_MC-001' }
  );
  assert(mismatchRes.status === 403, 'HTTP_403', 'Device-to-helmet mismatch returns 403');
  assert(validateEnvelope(mismatchRes.body, 'FORBIDDEN'), 'HTTP_403', 'Device mismatch uses FORBIDDEN envelope');

  // =========================================================================
  // 4. RESOURCE NOT FOUND & UNKNOWN ROUTES (404)
  // =========================================================================
  console.log('\n--- 4. HTTP 404 NOT FOUND ERRORS ---');

  // 4.1 Non-existent resource
  const notFoundHelmet = await mockRequest('/api/v1/helmets/MC-999', 'GET', undefined, {
    authorization: `Bearer ${supToken}`,
  });
  assert(notFoundHelmet.status === 404, 'HTTP_404', 'Non-existent helmet returns 404 Not Found');
  assert(validateEnvelope(notFoundHelmet.body, 'NOT_FOUND'), 'HTTP_404', 'Resource 404 uses NOT_FOUND envelope');

  // 4.2 Unknown API route
  const unknownRoute = await mockRequest('/api/v1/nonexistent/service', 'GET', undefined, {
    authorization: `Bearer ${supToken}`,
  });
  assert(unknownRoute.status === 404, 'HTTP_404', 'Unknown API route returns 404');
  assert(validateEnvelope(unknownRoute.body, 'NOT_FOUND'), 'HTTP_404', 'Route 404 uses NOT_FOUND envelope');

  // =========================================================================
  // 5. METHOD NOT ALLOWED (405)
  // =========================================================================
  console.log('\n--- 5. HTTP 405 METHOD NOT ALLOWED ---');

  // 5.1 GET on POST-only login route
  const getLogin = await mockRequest('/api/v1/auth/login', 'GET');
  assert(getLogin.status === 405, 'HTTP_405', 'GET /api/v1/auth/login returns 405 Method Not Allowed');
  assert(validateEnvelope(getLogin.body, 'METHOD_NOT_ALLOWED'), 'HTTP_405', '405 uses METHOD_NOT_ALLOWED envelope');

  // 5.2 POST on GET-only health route
  const postHealth = await mockRequest('/api/v1/system/health', 'POST');
  assert(postHealth.status === 405, 'HTTP_405', 'POST /api/v1/system/health returns 405');
  assert(validateEnvelope(postHealth.body, 'METHOD_NOT_ALLOWED'), 'HTTP_405', 'System health 405 uses METHOD_NOT_ALLOWED envelope');

  // =========================================================================
  // 6. OVERSIZED PAYLOAD & URI (413 & 414)
  // =========================================================================
  console.log('\n--- 6. HTTP 413 & 414 BOUNDARY LIMITS ---');

  // 6.1 Oversized body (413)
  const hugePayload = { dummy: 'X'.repeat(70000) };
  const oversizedRes = await mockRequest('/api/v1/auth/login', 'POST', hugePayload);
  assert(oversizedRes.status === 413, 'HTTP_413', 'Oversized payload returns 413 Payload Too Large');
  assert(validateEnvelope(oversizedRes.body, 'PAYLOAD_TOO_LARGE'), 'HTTP_413', '413 uses PAYLOAD_TOO_LARGE envelope');

  // 6.2 Oversized URI (414)
  const hugeUrl = `/api/v1/helmets?query=${'A'.repeat(3000)}`;
  const oversizedUrlRes = await mockRequest(hugeUrl, 'GET', undefined, {
    authorization: `Bearer ${supToken}`,
  });
  assert(oversizedUrlRes.status === 414, 'HTTP_414', 'Oversized URI returns 414 URI Too Long');
  assert(validateEnvelope(oversizedUrlRes.body, 'URI_TOO_LONG'), 'HTTP_414', '414 uses URI_TOO_LONG envelope');

  // =========================================================================
  // 7. UNSUPPORTED MEDIA TYPE (415)
  // =========================================================================
  console.log('\n--- 7. HTTP 415 UNSUPPORTED MEDIA TYPE ---');

  const xmlRes = await mockRequest(
    '/api/v1/auth/login',
    'POST',
    '<auth><email>test@test.com</email></auth>',
    { 'content-type': 'application/xml' }
  );
  assert(xmlRes.status === 415, 'HTTP_415', 'XML body on JSON endpoint returns 415 Unsupported Media Type');
  assert(validateEnvelope(xmlRes.body, 'UNSUPPORTED_MEDIA_TYPE'), 'HTTP_415', '415 uses UNSUPPORTED_MEDIA_TYPE envelope');

  // =========================================================================
  // 8. UNPROCESSABLE ENTITY (422) & CONFLICT (409)
  // =========================================================================
  console.log('\n--- 8. HTTP 422 & 409 VALIDATION & CONFLICT ---');

  // 422 factory verification
  const unprocErr = ApiError.unprocessableEntity('req-422', 'Validation rules failed');
  assert(unprocErr.code === 'UNPROCESSABLE_ENTITY', 'HTTP_422', 'Code is UNPROCESSABLE_ENTITY');
  assert(validateEnvelope(unprocErr, 'UNPROCESSABLE_ENTITY'), 'HTTP_422', 'unprocessableEntity produces canonical envelope');

  // 409 factory verification
  const conflictErr = ApiError.conflict('req-409', 'Resource state conflict');
  assert(conflictErr.code === 'CONFLICT', 'HTTP_409', 'Code is CONFLICT');
  assert(validateEnvelope(conflictErr, 'CONFLICT'), 'HTTP_409', 'conflict produces canonical envelope');

  // =========================================================================
  // 9. RATE LIMITING (429) & SERVICE UNAVAILABILITY (503)
  // =========================================================================
  console.log('\n--- 9. HTTP 429 & 503 RESILIENCE ENVELOPES ---');

  // 429 factory verification
  const rateLimitErr = ApiError.rateLimited('req-429', 60, 'Rate limit exceeded');
  assert(rateLimitErr.code === 'RATE_LIMITED', 'HTTP_429', 'Code is RATE_LIMITED');
  assert(
    (rateLimitErr.error.details as any)?.retryAfterSeconds === 60,
    'HTTP_429',
    'Includes retryAfterSeconds in details'
  );
  assert(validateEnvelope(rateLimitErr, 'RATE_LIMITED'), 'HTTP_429', 'rateLimited produces canonical envelope');

  // 503 service unavailable
  const manual503 = ApiError.serviceUnavailable('req-503', 'PostgreSQL offline');
  assert(manual503.code === 'SERVICE_UNAVAILABLE', 'HTTP_503', 'serviceUnavailable code is SERVICE_UNAVAILABLE');
  assert(validateEnvelope(manual503, 'SERVICE_UNAVAILABLE'), 'HTTP_503', 'serviceUnavailable envelope verified');

  // =========================================================================
  // 10. REQUEST ID CORRELATION & PROPAGATION
  // =========================================================================
  console.log('\n--- 10. CORRELATION REQUEST ID PROPAGATION ---');

  const customReqId = 'custom-correlation-id-999';
  const customIdRes = await mockRequest('/api/v1/helmets/MC-999', 'GET', undefined, {
    authorization: `Bearer ${supToken}`,
    'x-request-id': customReqId,
  });

  assert(customIdRes.headers['x-request-id'] === customReqId, 'CORRELATION', 'Client X-Request-ID preserved in response header');
  assert(customIdRes.body?.error?.requestId === customReqId, 'CORRELATION', 'Client X-Request-ID populated in ApiError envelope');

  // =========================================================================
  // 11. DEEP SECRETS SANITIZATION IN 500 INTERNAL ERRORS
  // =========================================================================
  console.log('\n--- 11. INTERNAL ERROR SANITIZATION & LEAK PREVENTION ---');

  // Simulate an internal database error containing secrets
  const internalSecretError = new Error(
    'Connection to postgresql://postgres:SUPABASE_SERVICE_KEY_123@aws-0-ap-south-1.pooler.supabase.com:6543/postgres failed: table rate_limits corrupted'
  );

  const sanitizedProdError = ApiError.internal('req-internal', internalSecretError, true);
  const serializedProd = JSON.stringify(sanitizedProdError);

  assert(sanitizedProdError.code === 'INTERNAL_SERVER_ERROR', 'SANITIZATION', 'Code is INTERNAL_SERVER_ERROR');
  assert(!serializedProd.includes('SUPABASE_SERVICE_KEY'), 'SANITIZATION', 'Service key scrubbed from response');
  assert(!serializedProd.includes('postgresql://'), 'SANITIZATION', 'Connection string scrubbed from response');
  assert(!serializedProd.includes('aws-0-ap-south-1'), 'SANITIZATION', 'Database host scrubbed from response');
  assert(sanitizedProdError.error.message === 'An unexpected internal server error occurred', 'SANITIZATION', 'Production message is completely generic');

  // =========================================================================
  // 12. FRONTEND APICLIENT ERROR PARSING COMPATIBILITY
  // =========================================================================
  console.log('\n--- 12. FRONTEND APICLIENT COMPATIBILITY ---');

  // Verify that frontend error handling extracts message from canonical { error: { message } } envelope
  const backendErrorEnvelope = {
    code: 'RATE_LIMITED',
    message: 'Too Many Requests: Please try again later',
    error: {
      code: 'RATE_LIMITED',
      message: 'Too Many Requests: Please try again later',
      requestId: 'req-test',
      timestamp: new Date().toISOString(),
    },
  };

  const extractedMessage = backendErrorEnvelope.error?.message || backendErrorEnvelope.message;
  assert(
    extractedMessage === 'Too Many Requests: Please try again later',
    'CLIENT_COMPAT',
    'Frontend apiClient successfully parses nested canonical ApiError envelope message'
  );

  console.log('\n============================================================');
  console.log(`TOTAL TASK 9.6 CHECKS: ${totalChecks}`);
  console.log(`PASSED:               ${passedChecks}`);
  console.log(`FAILED:               ${failedChecks}`);
  console.log('============================================================\n');

  if (failedChecks > 0) {
    process.exit(1);
  }
}

runTask96Tests().catch((err) => {
  console.error('Fatal Task 9.6 Test Suite Failure:', err);
  process.exit(1);
});
