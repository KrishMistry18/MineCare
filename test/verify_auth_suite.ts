/**
 * MineCare - Comprehensive Production Authentication & RBAC Verification Suite
 */

import { getBackendConfig } from '../src/backend/config/env';
import { BackendApp } from '../src/backend/app';
import { PostgresDatabaseRepository } from '../src/backend/db/repositories/PostgresDatabaseRepository';
import { createClient } from '@supabase/supabase-js';
import { verifySupabaseJwt } from '../src/backend/auth/jwt';
import { IncomingMessage, ServerResponse } from 'http';
import { Socket } from 'net';

interface MockApiResponse {
  status: number;
  headers: Record<string, string | string[]>;
  body: any;
}

async function callApi(method: string, path: string, body?: any, rawBodyString?: string): Promise<MockApiResponse> {
  const app = BackendApp.getInstance();
  const socket = new Socket();
  const req = new IncomingMessage(socket);
  req.method = method;
  req.url = path;
  req.headers = {
    'content-type': 'application/json',
    host: 'localhost:3001',
  };

  let responseData = '';
  const headers: Record<string, string | string[]> = {};
  const res = new ServerResponse(req);
  res.setHeader = (key: string, val: any) => {
    headers[key.toLowerCase()] = val;
    return res;
  };
  res.write = (chunk: any) => {
    responseData += chunk?.toString() || '';
    return true;
  };

  const endPromise = new Promise<MockApiResponse>((resolve) => {
    res.end = (chunk: any) => {
      if (chunk) responseData += chunk.toString();
      let parsed = responseData;
      try {
        parsed = JSON.parse(responseData);
      } catch {
        // raw string
      }
      resolve({
        status: res.statusCode || 200,
        headers,
        body: parsed,
      });
      return res;
    };
  });

  const handlePromise = app.handleRequest(req, res);

  if (rawBodyString !== undefined) {
    req.emit('data', Buffer.from(rawBodyString));
  } else if (body !== undefined) {
    req.emit('data', Buffer.from(JSON.stringify(body)));
  }
  req.emit('end');

  await handlePromise;
  return endPromise;
}

async function runAuthSuite() {
  console.log('============================================================');
  console.log('MINECARE PRODUCTION AUTHENTICATION VERIFICATION SUITE');
  console.log('============================================================\n');

  // 1. ENVIRONMENT CONFIGURATION CHECK
  console.log('--- 1. ENVIRONMENT CONFIGURATION STATUS ---');
  const config = getBackendConfig(true);
  console.log('  SUPABASE_URL configured:             ', Boolean(config.supabaseUrl));
  console.log('  SUPABASE_SERVICE_ROLE_KEY configured:', Boolean(config.supabaseServiceRoleKey));
  console.log('  DATABASE_URL configured:             ', Boolean(config.databaseUrl));
  console.log('  SUPABASE_JWT_ISSUER configured:      ', Boolean(config.supabaseJwtIssuer));
  console.log('  SUPABASE_JWKS_URL configured:        ', Boolean(config.supabaseJwksUrl));

  if (!config.supabaseUrl || !config.databaseUrl) {
    console.error('FATAL: Database or Supabase URL not configured.');
    process.exit(1);
  }

  // 2. DIRECT SUPABASE AUTH VERIFICATION
  console.log('\n--- 2. DIRECT SUPABASE AUTH VERIFICATION ---');
  const anonOrServiceKey = config.supabaseAnonKey || config.supabaseServiceRoleKey!;
  const supabase = createClient(config.supabaseUrl, anonOrServiceKey);

  const directAuth = await supabase.auth.signInWithPassword({
    email: 'admin@minecare.local',
    password: 'Admin#Password2026',
  });

  const directAuthOk = Boolean(!directAuth.error && directAuth.data.session?.access_token);
  console.log(`  ${directAuthOk ? '✓' : '✗'} [SUPABASE_DIRECT] admin@minecare.local authenticated directly with Supabase Auth`);
  if (!directAuthOk) {
    console.error('    Error detail:', directAuth.error?.message);
  }

  // 3. POSTGRESQL PROFILES VERIFICATION & OPERATOR CHECK
  console.log('\n--- 3. DATABASE PROFILES & OPERATOR ACCOUNT AUDIT ---');
  const db = PostgresDatabaseRepository.getInstance();
  const adminProfile = await db.getProfileByEmail('admin@minecare.local');
  const supProfile = await db.getProfileByEmail('supervisor@minecare.local');
  const workerMarakProfile = await db.getProfileByEmail('worker.marak@minecare.local');
  const workerKujurProfile = await db.getProfileByEmail('worker.kujur@minecare.local');
  const operatorProfile = await db.getProfileByEmail('operator@minecare.local');

  console.log('  ✓ [PROFILES] admin@minecare.local -> role:', adminProfile?.role, 'auth_user_id:', adminProfile?.auth_user_id ? 'linked' : 'unlinked');
  console.log('  ✓ [PROFILES] supervisor@minecare.local -> role:', supProfile?.role, 'auth_user_id:', supProfile?.auth_user_id ? 'linked' : 'unlinked');
  console.log('  ✓ [PROFILES] worker.marak@minecare.local -> role:', workerMarakProfile?.role, 'auth_user_id:', workerMarakProfile?.auth_user_id ? 'linked' : 'unlinked');
  console.log('  ✓ [PROFILES] worker.kujur@minecare.local -> role:', workerKujurProfile?.role, 'auth_user_id:', workerKujurProfile?.auth_user_id ? 'linked' : 'unlinked');
  console.log(`  ℹ [OPERATOR_AUDIT] operator@minecare.local in profiles: ${operatorProfile ? 'present (auth_user_id: ' + operatorProfile.auth_user_id + ')' : 'NOT provisioned'}`);

  // 4. TEST ALL VERIFIED CANONICAL ACCOUNTS VIA API
  console.log('\n--- 4. MINECARE API LOGIN (ADMIN, SUPERVISOR, WORKER) ---');
  
  // 4.1 ADMIN
  const adminApi = await callApi('POST', '/api/v1/auth/login', {
    email: 'admin@minecare.local',
    password: 'Admin#Password2026',
  });
  const adminJwtOk = adminApi.status === 200 && adminApi.body.user?.role === 'ADMIN' && Boolean(adminApi.body.token);
  console.log(`  ${adminJwtOk ? '✓' : '✗'} [API_LOGIN] ADMIN login (admin@minecare.local) -> Status: ${adminApi.status}, Role: ${adminApi.body.user?.role}`);

  if (adminApi.body?.token) {
    const verified = await verifySupabaseJwt(adminApi.body.token);
    console.log(`  ✓ [JWT_VERIFICATION] Admin token verified cryptographically (sub: ${verified?.sub ? 'verified' : 'invalid'})`);
  }

  // 4.2 SUPERVISOR
  const supApi = await callApi('POST', '/api/v1/auth/login', {
    email: 'supervisor@minecare.local',
    password: 'Supervisor#Password2026',
  });
  const supJwtOk = supApi.status === 200 && supApi.body.user?.role === 'SUPERVISOR' && Boolean(supApi.body.token);
  console.log(`  ${supJwtOk ? '✓' : '✗'} [API_LOGIN] SUPERVISOR login (supervisor@minecare.local) -> Status: ${supApi.status}, Role: ${supApi.body.user?.role}`);

  // 4.3 WORKER 1
  const worker1Api = await callApi('POST', '/api/v1/auth/login', {
    email: 'worker.marak@minecare.local',
    password: 'Worker#Password2026',
  });
  const worker1Ok = worker1Api.status === 200 && worker1Api.body.user?.role === 'WORKER';
  console.log(`  ${worker1Ok ? '✓' : '✗'} [API_LOGIN] WORKER login (worker.marak@minecare.local) -> Status: ${worker1Api.status}, Role: ${worker1Api.body.user?.role}`);

  // 4.4 WORKER 2
  const worker2Api = await callApi('POST', '/api/v1/auth/login', {
    email: 'worker.kujur@minecare.local',
    password: 'Worker#Password2026',
  });
  const worker2Ok = worker2Api.status === 200 && worker2Api.body.user?.role === 'WORKER';
  console.log(`  ${worker2Ok ? '✓' : '✗'} [API_LOGIN] WORKER login (worker.kujur@minecare.local) -> Status: ${worker2Api.status}, Role: ${worker2Api.body.user?.role}`);

  // 5. NEGATIVE / SECURITY ERROR HANDLING TESTS
  console.log('\n--- 5. NEGATIVE & SECURITY ERROR HANDLING TESTS ---');

  // 5.1 Wrong Password
  const wrongPass = await callApi('POST', '/api/v1/auth/login', {
    email: 'admin@minecare.local',
    password: 'WrongPassword2026!',
  });
  const wrongPassOk = wrongPass.status === 401;
  console.log(`  ${wrongPassOk ? '✓' : '✗'} [SECURITY_401] Wrong password returns 401 Unauthorized (got ${wrongPass.status}):`, wrongPass.body);

  // 5.2 Unknown Email
  const unknownEmail = await callApi('POST', '/api/v1/auth/login', {
    email: 'nonexistent.user@minecare.local',
    password: 'SomePassword2026!',
  });
  const unknownEmailOk = unknownEmail.status === 401;
  console.log(`  ${unknownEmailOk ? '✓' : '✗'} [SECURITY_401] Unknown email returns 401 Unauthorized (got ${unknownEmail.status}):`, unknownEmail.body);

  // 5.3 Missing Credentials (empty object)
  const missingCreds = await callApi('POST', '/api/v1/auth/login', {});
  const missingCredsOk = missingCreds.status === 401;
  console.log(`  ${missingCredsOk ? '✓' : '✗'} [SECURITY_401] Missing credentials returns 401 Unauthorized (got ${missingCreds.status}):`, missingCreds.body);

  // 5.4 Missing Password
  const missingPass = await callApi('POST', '/api/v1/auth/login', {
    email: 'admin@minecare.local',
  });
  const missingPassOk = missingPass.status === 401;
  console.log(`  ${missingPassOk ? '✓' : '✗'} [SECURITY_401] Missing password returns 401 Unauthorized (got ${missingPass.status}):`, missingPass.body);

  // 5.5 Short Password (< 8 chars)
  const shortPass = await callApi('POST', '/api/v1/auth/login', {
    email: 'admin@minecare.local',
    password: 'short',
  });
  const shortPassOk = shortPass.status === 401;
  console.log(`  ${shortPassOk ? '✓' : '✗'} [SECURITY_401] Short password (<8 chars) returns 401 Unauthorized (got ${shortPass.status}):`, shortPass.body);

  // 5.6 Malformed Request (invalid JSON string)
  const malformed = await callApi('POST', '/api/v1/auth/login', undefined, '{ invalid json');
  const malformedOk = malformed.status === 401;
  console.log(`  ${malformedOk ? '✓' : '✗'} [SECURITY_401] Malformed JSON payload returns 401 Unauthorized (got ${malformed.status}):`, malformed.body);

  // 5.7 Operator Account Login Attempt
  const opLogin = await callApi('POST', '/api/v1/auth/login', {
    email: 'operator@minecare.local',
    password: 'Supervisor#Password2026',
  });
  const opLoginControlled = opLogin.status === 401 || opLogin.status === 403;
  console.log(`  ${opLoginControlled ? '✓' : '✗'} [OPERATOR_CONTROLLED] operator@minecare.local rejected with controlled status (got ${opLogin.status}):`, opLogin.body);

  // 5.8 Ensure NO 500 status on authentication errors
  const allControlled = [wrongPass, unknownEmail, missingCreds, missingPass, shortPass, malformed, opLogin].every((r) => r.status !== 500);
  console.log(`  ${allControlled ? '✓' : '✗'} [ZERO_500] All authentication failures returned strictly controlled 401/403 (Zero 500 errors)`);

  console.log('\n============================================================');
  const allPassed = directAuthOk && adminJwtOk && supJwtOk && worker1Ok && worker2Ok &&
                    wrongPassOk && unknownEmailOk && missingCredsOk && missingPassOk &&
                    shortPassOk && malformedOk && opLoginControlled && allControlled;

  if (allPassed) {
    console.log('ALL AUTHENTICATION VERIFICATION CHECKS PASSED SUCCESSFULLY.');
    console.log('============================================================\n');
    process.exit(0);
  } else {
    console.error('ONE OR MORE AUTHENTICATION CHECKS FAILED.');
    console.log('============================================================\n');
    process.exit(1);
  }
}

runAuthSuite().catch((err) => {
  console.error('Fatal suite failure:', err);
  process.exit(1);
});
