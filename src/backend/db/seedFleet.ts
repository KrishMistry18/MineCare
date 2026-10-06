/**
 * MineCare - CLI Fleet & Auth Data Seeder
 *
 * Usage: npm run db:seed [--force]
 *
 * Strictly executes seeding against the target PostgreSQL database configured
 * in .env (DATABASE_URL). Never silently falls back to in-memory doubles.
 */

import { migrator } from './migrator';
import { seedAuthUsers } from './seedAuthUsers';
import { connectionManager } from './connection';
import { getBackendConfig, getSafeDatabaseMetadata } from '../config/env';

async function main() {
  const config = getBackendConfig();
  const dbMeta = getSafeDatabaseMetadata(config.databaseUrl);
  const force = process.argv.includes('--force') || process.env.FORCE_SEED === 'true';

  console.log('============================================================');
  console.log(`[MineCare CLI] Seeding Fleet & Auth Data (${config.nodeEnv.toUpperCase()})`);
  console.log('============================================================');

  // Strict Fail-Fast Check: A real DATABASE_URL is mandatory for CLI seeding
  if (!config.databaseUrl || !dbMeta.configured) {
    console.error('[MineCare CLI] FATAL CONFIGURATION ERROR:');
    console.error('  DATABASE_URL is not configured or is invalid in .env.');
    console.error('  Cannot seed relational fleet data without an authoritative PostgreSQL database.');
    console.error('  Silent in-memory test fallback is strictly prohibited.');
    console.error('\nTo resolve this:');
    console.error('  1. Open .env in your project root.');
    console.error('  2. Set DATABASE_URL=postgresql://postgres.[ref]:[password]@[host]:[port]/postgres');
    console.error('  3. Re-run: npm run db:seed');
    console.error('============================================================');
    process.exit(1);
  }

  console.log('Target Database Details (Credentials Redacted):');
  console.log(`  Host:            ${dbMeta.host}`);
  console.log(`  Port:            ${dbMeta.port}`);
  console.log(`  Database:        ${dbMeta.database}`);
  console.log(`  Service:         ${dbMeta.isSupabase ? 'Supabase Managed PostgreSQL' : 'Self-hosted PostgreSQL'}`);
  console.log(`  Connection Mode: ${dbMeta.connectionMode}`);
  console.log('------------------------------------------------------------');

  if (config.isProduction && !force) {
    console.log('[MineCare CLI] Production safety check: Automatic seeding is skipped in production.');
    console.log('To force seeding over empty tables, run: npm run db:seed -- --force');
    process.exit(0);
  }

  try {
    const isHealthy = await connectionManager.testConnection();
    if (!isHealthy || connectionManager.isPgMem()) {
      console.error(`[MineCare CLI] FATAL: Unable to reach PostgreSQL database at '${dbMeta.host}'.`);
      console.error('Please verify network connectivity, firewall rules, and credentials.');
      process.exit(1);
    }

    // 1. Seed relational fleet data (zones, workers, helmets, assignments)
    const seeded = await migrator.seedDemoData(undefined, force);
    if (seeded) {
      console.log('  ✓ [Relational Data] 4 zones, 16 workers, 16 helmets seeded.');
    } else {
      console.log('  ℹ [Relational Data] Fleet already populated. Skipped.');
    }

    // 2. Seed Supabase Auth users via GoTrue Admin API
    if (config.supabaseUrl && config.supabaseServiceRoleKey) {
      await seedAuthUsers();
    } else {
      console.warn('  ⚠ [Auth Users] SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY missing in .env.');
      console.warn('    Skipping GoTrue demo user creation. Relational data was seeded.');
    }

    console.log('============================================================');
    console.log('[MineCare CLI] Seeding Finished Successfully.');
    console.log('============================================================');

    await connectionManager.closePool();
  } catch (err) {
    console.error('[MineCare CLI] Seeding failed with error:', err);
    await connectionManager.closePool();
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('Fatal CLI Error:', err);
  process.exit(1);
});
