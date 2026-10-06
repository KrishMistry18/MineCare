/**
 * MineCare - Production Demo Accounts Server-Side Verification Test
 *
 * Validates GoTrue authentication and RBAC authorization for:
 * 1. ADMIN (admin@minecare.local) -> ADMIN
 * 2. SUPERVISOR (supervisor@minecare.local) -> SUPERVISOR
 * 3. MINER (miner@minecare.local) -> WORKER (linked to worker record)
 *
 * NOTE: Never prints credentials to logs.
 */

import { createClient } from '@supabase/supabase-js';
import { getBackendConfig } from '../src/backend/config/env';
import { verifySupabaseJwt } from '../src/backend/auth/jwt';
import { PostgresDatabaseRepository } from '../src/backend/db/repositories/PostgresDatabaseRepository';
import { connectionManager } from '../src/backend/db/connection';

interface DemoTarget {
  email: string;
  passwordEnvVar: string;
  expectedRole: 'ADMIN' | 'SUPERVISOR' | 'WORKER';
  expectedWorkerId?: string;
}

const TARGETS: DemoTarget[] = [
  {
    email: 'admin@minecare.local',
    passwordEnvVar: 'DEMO_ADMIN_PASSWORD',
    expectedRole: 'ADMIN',
  },
  {
    email: 'supervisor@minecare.local',
    passwordEnvVar: 'DEMO_SUPERVISOR_PASSWORD',
    expectedRole: 'SUPERVISOR',
  },
  {
    email: 'miner@minecare.local',
    passwordEnvVar: 'DEMO_MINER_PASSWORD',
    expectedRole: 'WORKER',
    expectedWorkerId: 'WRK-001',
  },
];

async function runVerification() {
  console.log('============================================================');
  console.log('MINECARE PRODUCTION DEMO ACCOUNTS SERVER-SIDE LOGIN TEST');
  console.log('============================================================');

  const config = getBackendConfig();
  if (!config.supabaseUrl || !config.supabaseServiceRoleKey) {
    console.error('FAIL: Missing Supabase credentials in configuration.');
    process.exit(1);
  }

  const anonKey = config.supabaseAnonKey || config.supabaseServiceRoleKey;
  const supabaseAnon = createClient(config.supabaseUrl, anonKey);
  const repo = PostgresDatabaseRepository.getInstance();
  const pool = connectionManager.getPool();

  let allPassed = true;

  for (const target of TARGETS) {
    const password = process.env[target.passwordEnvVar];
    if (!password) {
      console.error(`FAIL: Environment variable ${target.passwordEnvVar} is not set.`);
      allPassed = false;
      continue;
    }

    console.log(`\nVerifying account: ${target.email} (${target.expectedRole})...`);

    // 1. Supabase GoTrue Auth Sign-In
    const { data: authData, error: authErr } = await supabaseAnon.auth.signInWithPassword({
      email: target.email,
      password,
    });

    if (authErr || !authData.session?.access_token || !authData.user) {
      console.error(`  ✕ Authentication failed: ${authErr?.message || 'No session returned'}`);
      allPassed = false;
      continue;
    }
    console.log(`  ✓ GoTrue Authentication: SUCCESS (User ID: ${authData.user.id})`);

    // 2. JWT Verification
    const verified = await verifySupabaseJwt(authData.session.access_token);
    if (!verified || !verified.sub || verified.sub !== authData.user.id) {
      console.error('  ✕ JWT Verification: FAILED (Invalid signature or sub mismatch)');
      allPassed = false;
      continue;
    }
    console.log('  ✓ JWT Cryptographic Signature & Claims: VERIFIED');

    // 3. Database Profile Resolution
    const profile = await repo.getProfileByAuthId(verified.sub);
    if (!profile) {
      console.error('  ✕ Profile Resolution: FAILED (No profile found for auth_user_id)');
      allPassed = false;
      continue;
    }
    console.log(`  ✓ Profile Resolved in Database: ${profile.name} (${profile.email})`);

    // 4. Role Authorization Check
    if (profile.role !== target.expectedRole) {
      console.error(`  ✕ Role Authorization: MISMATCH (Expected: ${target.expectedRole}, Got: ${profile.role})`);
      allPassed = false;
      continue;
    }
    console.log(`  ✓ Role Authorization: MATCH (${profile.role})`);

    // 5. Worker Linkage Check (for WORKER role)
    if (target.expectedRole === 'WORKER') {
      if (!profile.worker_id) {
        console.error('  ✕ Worker Linkage: FAILED (worker_id is null on WORKER profile)');
        allPassed = false;
        continue;
      }
      if (target.expectedWorkerId && profile.worker_id !== target.expectedWorkerId) {
        console.error(`  ✕ Worker Linkage: MISMATCH (Expected: ${target.expectedWorkerId}, Got: ${profile.worker_id})`);
        allPassed = false;
        continue;
      }

      // Check linked worker in database
      const workerRes = await pool.query('SELECT id, worker_code, name, role, status FROM workers WHERE id = $1', [profile.worker_id]);
      if (workerRes.rows.length === 0) {
        console.error(`  ✕ Worker Record: FAILED (Worker ID ${profile.worker_id} not found in workers table)`);
        allPassed = false;
        continue;
      }
      console.log(`  ✓ Worker Record Linked: ${workerRes.rows[0].worker_code} - ${workerRes.rows[0].name} (${workerRes.rows[0].role})`);
    }

    // 6. Active status check
    if (!profile.active) {
      console.error('  ✕ Account Status: INACTIVE');
      allPassed = false;
      continue;
    }
    console.log('  ✓ Account Status: ACTIVE');
  }

  await pool.end();

  console.log('\n============================================================');
  if (allPassed) {
    console.log('ALL DEMO CREDENTIALS SUCCESSFULLY AUTHENTICATED & AUTHORIZED!');
    console.log('============================================================');
    process.exit(0);
  } else {
    console.error('SOME DEMO CREDENTIAL CHECKS FAILED.');
    console.log('============================================================');
    process.exit(1);
  }
}

runVerification().catch((err) => {
  console.error('Fatal verification error:', err);
  process.exit(1);
});
