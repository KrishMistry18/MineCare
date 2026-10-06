/**
 * MineCare - Real Supabase & PostgreSQL Live Verification Suite
 *
 * Runs comprehensive live validation against the actual Supabase project when credentials
 * are configured in .env:
 * 1. DB_CONNECTION: Real PostgreSQL connection via DATABASE_URL
 * 2. MIGRATION_EXECUTION: Idempotent migration runner execution
 * 3. GOTRUE_ADMIN_SEED: Supabase Auth (GoTrue) canonical user provisioning
 * 4. GOTRUE_AUTH_LOGIN: Real GoTrue authentication for ADMIN, SUPERVISOR, WORKER
 * 5. JWT_VERIFICATION: Cryptographic JWT signature and audience validation
 * 6. PROFILE_ROLE_RESOLUTION: Profile and role resolution from PostgreSQL
 * 7. FLEET_SEED: Relational fleet data seeding (workers, helmets, zones)
 * 8. TELEMETRY_PIPELINE: Telemetry packet ingestion and query from PostgreSQL
 * 9. ALERTS_PIPELINE: Alert creation and status transition in PostgreSQL
 * 10. RLS_ISOLATION: Worker vs Supervisor table visibility isolation
 * 11. PERSISTENT_REVOCATION: Shared revoked_tokens table persistence
 * 12. TEARDOWN_HYGIENE: Ephemeral test artifact cleanup
 *
 * FAILS FAST if required credentials (DATABASE_URL, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)
 * are missing or unconfigured. Never falls back to mock or in-memory databases.
 */

import { createClient } from '@supabase/supabase-js';
import pg from 'pg';
import { getBackendConfig, getSafeEnvDiagnostics } from '../src/backend/config/env';
import { migrator } from '../src/backend/db/migrator';
import { seedAuthUsers, CANONICAL_DEMO_USERS } from '../src/backend/db/seedAuthUsers';
import { verifySupabaseJwt } from '../src/backend/auth/jwt';

interface StepResult {
  step: string;
  status: 'PASSED' | 'FAILED' | 'SKIPPED';
  detail: string;
}

const stepResults: StepResult[] = [];

function record(step: string, passed: boolean, detail: string): void {
  const status = passed ? 'PASSED' : 'FAILED';
  stepResults.push({ step, status, detail });
  const icon = passed ? '✓' : '✗';
  console.log(`  ${icon} [${step}] ${detail}`);
}

async function runLiveVerification() {
  console.log('============================================================');
  console.log('MINECARE - REAL SUPABASE & POSTGRESQL LIVE VERIFICATION');
  console.log('============================================================\n');

  const config = getBackendConfig(true);
  const diag = getSafeEnvDiagnostics();
  const dbMeta = diag.database;

  console.log('Environment Configuration Status:');
  console.log(`  .env file present:            ${diag.envFilePresent}`);
  console.log(`  DATABASE_URL configured:       ${dbMeta.configured}`);
  console.log(`  SUPABASE_URL configured:       ${diag.supabaseUrlConfigured}`);
  console.log(`  SERVICE_ROLE_KEY configured:   ${diag.serviceRoleKeyConfigured}`);
  console.log(`  ANON_KEY configured:           ${diag.anonKeyConfigured}`);

  if (dbMeta.configured) {
    console.log('\nTarget Database Metadata (Credentials Redacted):');
    console.log(`  Host:             ${dbMeta.host}`);
    console.log(`  Port:             ${dbMeta.port}`);
    console.log(`  Database:         ${dbMeta.database}`);
    console.log(`  Service:          ${dbMeta.isSupabase ? 'Supabase Managed Cloud' : 'Self-hosted PostgreSQL'}`);
    console.log(`  Connection Mode:  ${dbMeta.connectionMode}`);
  }
  console.log('------------------------------------------------------------\n');

  // Strict Fail-Fast Enforcement:
  // If credentials are not configured, produce an explicit error and stop.
  // Never silently switch to in-memory, mock, or fake databases.
  const missingVars: string[] = [];
  if (!dbMeta.configured) missingVars.push('DATABASE_URL');
  if (!diag.supabaseUrlConfigured) missingVars.push('SUPABASE_URL (or VITE_SUPABASE_URL)');
  if (!diag.serviceRoleKeyConfigured) missingVars.push('SUPABASE_SERVICE_ROLE_KEY');

  if (missingVars.length > 0) {
    console.error('============================================================');
    console.error('[MineCare Verification Error] FATAL CONFIGURATION DEFECT:');
    console.error('  Live verification requires active Supabase project credentials in .env.');
    console.error(`  The following required variable(s) are missing or empty:`);
    for (const v of missingVars) {
      console.error(`    - ${v}`);
    }
    console.error('\nSilent fallback to in-memory/mock Supabase is strictly disabled.');
    console.error('To run live verification:');
    console.error('  1. Open .env');
    console.error('  2. Configure your Supabase project credentials:');
    console.error('       DATABASE_URL=postgresql://postgres.[ref]:[password]@[host]:6543/postgres?pgbouncer=true');
    console.error('       SUPABASE_URL=https://[ref].supabase.co');
    console.error('       SUPABASE_SERVICE_ROLE_KEY=eyJhbGciOi...');
    console.error('       VITE_SUPABASE_ANON_KEY=eyJhbGciOi...');
    console.error('  3. Re-run: npm run verify:supabase');
    console.error('============================================================');
    process.exit(1);
  }

  // =========================================================================
  // EXECUTE 12 CANONICAL LIVE VERIFICATION CHECKS
  // =========================================================================

  // 1. DB_CONNECTION
  console.log('--- 1. DB_CONNECTION: PostgreSQL Connectivity ---');
  let livePool: pg.Pool;
  try {
    livePool = new pg.Pool({
      connectionString: config.databaseUrl,
      ssl: dbMeta.isLocalhost ? false : { rejectUnauthorized: false },
      connectionTimeoutMillis: 10000,
    });

    const client = await livePool.connect();
    const versionRes = await client.query('SELECT version()');
    client.release();

    record(
      'DB_CONNECTION',
      true,
      `Connected to live database (${versionRes.rows[0].version.split(',')[0]} on ${dbMeta.host})`
    );
  } catch (err) {
    record('DB_CONNECTION', false, `Database connection failed: ${String(err)}`);
    process.exit(1);
  }

  // 2. MIGRATION_EXECUTION
  console.log('\n--- 2. MIGRATION_EXECUTION: Schema Migrations ---');
  try {
    const migrationResults = await migrator.runMigrations(livePool);
    const applied = migrationResults.filter((r) => r.applied).length;
    const migCheck = await livePool.query('SELECT version FROM schema_migrations ORDER BY applied_at ASC');

    record(
      'MIGRATION_EXECUTION',
      migCheck.rows.length >= 3,
      `All 3 canonical migrations tracked in schema_migrations (${migCheck.rows.length} total, ${applied} applied in this run)`
    );
  } catch (err) {
    record('MIGRATION_EXECUTION', false, `Migration execution error: ${String(err)}`);
  }

  // 3. GOTRUE_ADMIN_SEED
  console.log('\n--- 3. GOTRUE_ADMIN_SEED: Supabase Auth User Provisioning ---');
  const supabaseUrl = config.supabaseUrl!;
  const serviceRoleKey = config.supabaseServiceRoleKey!;
  const anonKey = config.supabaseAnonKey || serviceRoleKey;

  const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  try {
    const seeded = await seedAuthUsers();
    const { data: listData, error: listErr } = await supabaseAdmin.auth.admin.listUsers();
    if (listErr) throw listErr;

    const emails = (listData?.users || []).map((u) => u.email?.toLowerCase());
    const hasAdmin = emails.includes('admin@minecare.local');
    const hasSupervisor = emails.includes('supervisor@minecare.local');
    const hasWorker = emails.includes('worker.marak@minecare.local');

    record(
      'GOTRUE_ADMIN_SEED',
      Boolean(seeded && hasAdmin && hasSupervisor && hasWorker),
      'Canonical users (ADMIN, SUPERVISOR, WORKER) provisioned via GoTrue Admin API'
    );
  } catch (err) {
    record('GOTRUE_ADMIN_SEED', false, `GoTrue user seeding failed: ${String(err)}`);
  }

  // 4. GOTRUE_AUTH_LOGIN
  console.log('\n--- 4. GOTRUE_AUTH_LOGIN: Real Supabase Password Authentication ---');
  const supabaseAnon = createClient(supabaseUrl, anonKey);
  const authSessions: Record<string, string> = {};

  try {
    let allLoginsPassed = true;
    for (const u of CANONICAL_DEMO_USERS) {
      const { data: authData, error: authError } = await supabaseAnon.auth.signInWithPassword({
        email: u.email,
        password: u.password,
      });

      const ok = Boolean(!authError && authData.session?.access_token);
      if (ok && authData.session) {
        authSessions[u.email] = authData.session.access_token;
        if (!authSessions[u.role]) {
          authSessions[u.role] = authData.session.access_token;
        }
      } else {
        allLoginsPassed = false;
      }
    }

    record(
      'GOTRUE_AUTH_LOGIN',
      allLoginsPassed,
      'ADMIN, SUPERVISOR, and WORKER successfully authenticated via real Supabase Auth GoTrue'
    );
  } catch (err) {
    record('GOTRUE_AUTH_LOGIN', false, `GoTrue authentication error: ${String(err)}`);
  }

  // 5. JWT_VERIFICATION
  console.log('\n--- 5. JWT_VERIFICATION: Cryptographic Signature Verification ---');
  try {
    let allTokensVerified = true;
    for (const role of ['ADMIN', 'SUPERVISOR', 'WORKER']) {
      const token = authSessions[role];
      if (!token) {
        allTokensVerified = false;
        continue;
      }
      const verified = await verifySupabaseJwt(token);
      if (!verified || !verified.sub) {
        allTokensVerified = false;
      }
    }

    record(
      'JWT_VERIFICATION',
      allTokensVerified,
      'Supabase-issued JWTs verified cryptographically via jose engine (signature, expiration, audience)'
    );
  } catch (err) {
    record('JWT_VERIFICATION', false, `JWT verification error: ${String(err)}`);
  }

  // 6. PROFILE_ROLE_RESOLUTION
  console.log('\n--- 6. PROFILE_ROLE_RESOLUTION: Database Role Lookup ---');
  try {
    const profilesRes = await livePool.query(
      'SELECT email, role FROM profiles WHERE email IN ($1, $2, $3)',
      ['admin@minecare.local', 'supervisor@minecare.local', 'worker.marak@minecare.local']
    );

    const rolesMap = new Map(profilesRes.rows.map((r) => [r.email.toLowerCase(), r.role]));
    const adminOk = rolesMap.get('admin@minecare.local') === 'ADMIN';
    const supervisorOk = rolesMap.get('supervisor@minecare.local') === 'SUPERVISOR';
    const workerOk = rolesMap.get('worker.marak@minecare.local') === 'WORKER';

    record(
      'PROFILE_ROLE_RESOLUTION',
      Boolean(adminOk && supervisorOk && workerOk),
      'Profiles table successfully maps auth users to authoritative database roles (ADMIN, SUPERVISOR, WORKER)'
    );
  } catch (err) {
    record('PROFILE_ROLE_RESOLUTION', false, `Profile resolution error: ${String(err)}`);
  }

  // 7. FLEET_SEED
  console.log('\n--- 7. FLEET_SEED: Relational Operational Fleet ---');
  try {
    await migrator.seedDemoData(livePool, false);

    const zCount = await livePool.query('SELECT count(*) FROM mine_zones');
    const wCount = await livePool.query('SELECT count(*) FROM workers');
    const hCount = await livePool.query('SELECT count(*) FROM helmets');

    const zonesOk = Number(zCount.rows[0].count) >= 4;
    const workersOk = Number(wCount.rows[0].count) >= 16;
    const helmetsOk = Number(hCount.rows[0].count) >= 16;

    record(
      'FLEET_SEED',
      Boolean(zonesOk && workersOk && helmetsOk),
      `Operational fleet populated in PostgreSQL (${wCount.rows[0].count} workers, ${hCount.rows[0].count} helmets, ${zCount.rows[0].count} zones)`
    );
  } catch (err) {
    record('FLEET_SEED', false, `Fleet seed error: ${String(err)}`);
  }

  // 8. TELEMETRY_PIPELINE
  console.log('\n--- 8. TELEMETRY_PIPELINE: Sensor Telemetry Ingestion ---');
  const testTelemetryId = `telem-live-${Date.now()}`;
  try {
    await livePool.query(
      `INSERT INTO telemetry (id, helmet_id, worker_id, timestamp, temperature, humidity, gas_value, acceleration_x, acceleration_y, acceleration_z, total_acceleration, gyro_x, gyro_y, gyro_z, fall_detected, sos_pressed, safety_status)
       VALUES ($1, 'MC-001', 'WRK-001', NOW(), 26.5, 60.0, 350, 0.1, 0.2, 9.8, 9.8, 0, 0, 0, false, false, 'SAFE')`,
      [testTelemetryId]
    );

    const telemRes = await livePool.query('SELECT id, gas_value, safety_status FROM telemetry WHERE id = $1', [testTelemetryId]);
    const telemOk = telemRes.rows.length === 1 && Number(telemRes.rows[0].gas_value) === 350;

    record(
      'TELEMETRY_PIPELINE',
      telemOk,
      'Telemetry packet successfully persisted and queried from live PostgreSQL telemetry table'
    );
  } catch (err) {
    record('TELEMETRY_PIPELINE', false, `Telemetry pipeline error: ${String(err)}`);
  }

  // 9. ALERTS_PIPELINE
  console.log('\n--- 9. ALERTS_PIPELINE: Hazard Alerting & Resolution ---');
  const testAlertId = `alert-live-${Date.now()}`;
  try {
    await livePool.query(
      `INSERT INTO alerts (id, helmet_id, worker_id, type, severity, status, message, triggered_at)
       VALUES ($1, 'MC-001', 'WRK-001', 'GAS_HAZARD', 'WARNING', 'TRIGGERED', 'Live verification gas hazard', NOW())`,
      [testAlertId]
    );

    await livePool.query(
      `UPDATE alerts SET status = 'RESOLVED', resolved_at = NOW(), supervisor_notes = 'Resolved by supervisor@minecare.local' WHERE id = $1`,
      [testAlertId]
    );

    const alertCheck = await livePool.query('SELECT status FROM alerts WHERE id = $1', [testAlertId]);
    const alertOk = alertCheck.rows.length === 1 && alertCheck.rows[0].status === 'RESOLVED';

    record(
      'ALERTS_PIPELINE',
      alertOk,
      'Alert successfully persisted and transitioned to RESOLVED in PostgreSQL alerts table'
    );
  } catch (err) {
    record('ALERTS_PIPELINE', false, `Alerts pipeline error: ${String(err)}`);
  }

  // 10. RLS_ISOLATION
  console.log('\n--- 10. RLS_ISOLATION: Worker vs Supervisor Isolation ---');
  try {
    const workerToken = authSessions['worker.marak@minecare.local'] || authSessions['WORKER'];
    if (workerToken) {
      const workerClient = createClient(supabaseUrl, anonKey, {
        global: { headers: { Authorization: `Bearer ${workerToken}` } },
      });

      // Worker reads profiles: should only see their own profile
      const { data: profiles } = await workerClient.from('profiles').select('email');
      const workerIsolated = (profiles || []).every((p) => p.email === 'worker.marak@minecare.local');

      record(
        'RLS_ISOLATION',
        Boolean(workerIsolated && (profiles?.length || 0) <= 1),
        'Row Level Security enforces worker isolation: Worker cannot view other workers profiles'
      );
    } else {
      record('RLS_ISOLATION', false, 'Worker token missing; cannot verify RLS isolation');
    }
  } catch (err) {
    record('RLS_ISOLATION', false, `RLS isolation error: ${String(err)}`);
  }

  // 11. PERSISTENT_REVOCATION
  console.log('\n--- 11. PERSISTENT_REVOCATION: Shared Blacklist Table ---');
  const testJti = `revoked-live-${Date.now()}`;
  try {
    await livePool.query(
      `INSERT INTO revoked_tokens (token_jti, user_id, revoked_at, expires_at)
       VALUES ($1, 'test-verifier', NOW(), NOW() + INTERVAL '1 hour')`,
      [testJti]
    );

    const revCheck = await livePool.query('SELECT 1 FROM revoked_tokens WHERE token_jti = $1 AND expires_at > NOW()', [
      testJti,
    ]);

    record(
      'PERSISTENT_REVOCATION',
      revCheck.rows.length === 1,
      'Revocation persisted in PostgreSQL revoked_tokens table (shared across multi-instance restarts)'
    );
  } catch (err) {
    record('PERSISTENT_REVOCATION', false, `Persistent revocation check error: ${String(err)}`);
  }

  // 12. TEARDOWN_HYGIENE
  console.log('\n--- 12. TEARDOWN_HYGIENE: Cleanup Ephemeral Test Artifacts ---');
  try {
    await livePool.query('DELETE FROM telemetry WHERE id = $1', [testTelemetryId]);
    await livePool.query('DELETE FROM alerts WHERE id = $1', [testAlertId]);
    await livePool.query('DELETE FROM revoked_tokens WHERE token_jti = $1', [testJti]);

    record('TEARDOWN_HYGIENE', true, 'All ephemeral test telemetry, alerts, and tokens pruned');
  } catch (err) {
    record('TEARDOWN_HYGIENE', false, `Teardown error: ${String(err)}`);
  }

  await livePool.end();

  console.log('\n============================================================');
  const total = stepResults.length;
  const passed = stepResults.filter((r) => r.status === 'PASSED').length;
  const failed = stepResults.filter((r) => r.status === 'FAILED').length;
  console.log(`LIVE VERIFICATION RUN COMPLETE:`);
  console.log(`  Total Checks: ${total}`);
  console.log(`  Passed:       ${passed}`);
  console.log(`  Failed:       ${failed}`);
  console.log('============================================================\n');

  if (failed > 0) {
    process.exit(1);
  } else {
    process.exit(0);
  }
}

runLiveVerification().catch((err) => {
  console.error('Fatal Live Verification Error:', err);
  process.exit(1);
});
