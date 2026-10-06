/**
 * MineCare - Production Supabase Auth User Provisioning
 *
 * Uses the authoritative Supabase Admin API (GoTrue) to provision canonical demo users
 * with real bcrypt passwords, confirmed emails, and metadata, then links their
 * auth_user_id to public.profiles.
 *
 * Safe for live Supabase Cloud projects: does NOT bypass GoTrue or corrupt auth tables.
 */

import { createClient } from '@supabase/supabase-js';
import { getBackendConfig, loadEnvFiles } from '../config/env';
import { connectionManager } from './connection';

loadEnvFiles();

export const CANONICAL_DEMO_USERS = [
  {
    email: 'admin@minecare.local',
    password: process.env.DEMO_ADMIN_PASSWORD || 'Admin#Password2026',
    role: 'ADMIN' as const,
    name: 'Admin Operator',
    workerId: null,
  },
  {
    email: 'supervisor@minecare.local',
    password: process.env.DEMO_SUPERVISOR_PASSWORD || 'Supervisor#Password2026',
    role: 'SUPERVISOR' as const,
    name: 'Chief Supervisor',
    workerId: null,
  },
  {
    email: 'miner@minecare.local',
    password: process.env.DEMO_MINER_PASSWORD || 'Worker#Password2026',
    role: 'WORKER' as const,
    name: 'R. Marak',
    workerId: 'WRK-001',
  },
  {
    email: 'worker.marak@minecare.local',
    password: process.env.DEMO_WORKER_PASSWORD || 'Worker#Password2026',
    role: 'WORKER' as const,
    name: 'R. Marak',
    workerId: 'WRK-001',
  },
  {
    email: 'worker.kujur@minecare.local',
    password: process.env.DEMO_WORKER_PASSWORD || 'Worker#Password2026',
    role: 'WORKER' as const,
    name: 'S. Kujur',
    workerId: 'WRK-002',
  },
];

export async function seedAuthUsers(): Promise<boolean> {
  const config = getBackendConfig();

  if (!config.supabaseUrl || !config.supabaseServiceRoleKey) {
    console.log('[MineCare Auth Seeder] No Supabase credentials configured. Skipping remote auth provisioning.');
    return false;
  }

  const supabase = createClient(config.supabaseUrl, config.supabaseServiceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const pool = connectionManager.getPool();

  console.log('[MineCare Auth Seeder] Provisioning canonical users in Supabase Auth...');

  for (const userDef of CANONICAL_DEMO_USERS) {
    let authUserId: string | null = null;

    // 1. Check if user already exists in Supabase GoTrue
    try {
      const { data: listData, error: listError } = await supabase.auth.admin.listUsers();
      if (!listError && listData?.users) {
        const existing = listData.users.find((u) => u.email?.toLowerCase() === userDef.email.toLowerCase());
        if (existing) {
          authUserId = existing.id;
          const { error: updateErr } = await supabase.auth.admin.updateUserById(existing.id, {
            password: userDef.password,
            email_confirm: true,
            user_metadata: { role: userDef.role, name: userDef.name },
          });
          if (updateErr) {
            console.error(`[MineCare Auth Seeder] Failed to update ${userDef.email}:`, updateErr.message);
          }
        }
      }
    } catch (err) {
      console.warn(`[MineCare Auth Seeder] Could not list users for ${userDef.email}:`, err);
    }

    // 2. If not existing, create user via GoTrue Admin API
    if (!authUserId) {
      const { data: createData, error: createError } = await supabase.auth.admin.createUser({
        email: userDef.email,
        password: userDef.password,
        email_confirm: true,
        user_metadata: { role: userDef.role, name: userDef.name },
      });

      if (createError || !createData.user) {
        console.error(`[MineCare Auth Seeder] Failed to create ${userDef.email} in Supabase Auth:`, createError?.message);
        continue;
      }
      authUserId = createData.user.id;
    }

    // 3. Upsert profile in public.profiles linked to real authUserId
    try {
      await pool.query(
        `INSERT INTO profiles (auth_user_id, name, email, role, worker_id, active, updated_at)
         VALUES ($1, $2, $3, $4, $5, TRUE, NOW())
         ON CONFLICT (email) DO UPDATE SET
           auth_user_id = EXCLUDED.auth_user_id,
           name = EXCLUDED.name,
           role = EXCLUDED.role,
           worker_id = EXCLUDED.worker_id,
           active = TRUE,
           updated_at = NOW();`,
        [authUserId, userDef.name, userDef.email, userDef.role, userDef.workerId]
      );
      console.log(`  ✓ [Auth User Provisioned] ${userDef.email} -> auth_user_id: ${authUserId}`);
    } catch (dbErr) {
      console.error(`[MineCare Auth Seeder] Failed to link profile for ${userDef.email}:`, dbErr);
    }
  }

  return true;
}

if (process.argv[1] && process.argv[1].includes('seedAuthUsers')) {
  seedAuthUsers()
    .then(() => {
      console.log('[MineCare Auth Seeder] Completed successfully.');
      process.exit(0);
    })
    .catch((err) => {
      console.error('[MineCare Auth Seeder] Error:', err);
      process.exit(1);
    });
}

