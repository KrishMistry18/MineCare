/**
 * MineCare - CLI Database Migration Runner
 *
 * Usage: npm run db:migrate
 *
 * Strictly executes migrations against the target PostgreSQL database configured
 * in .env (DATABASE_URL). Never silently falls back to in-memory doubles.
 */

import { migrator } from './migrator';
import { connectionManager } from './connection';
import { getBackendConfig, getSafeDatabaseMetadata } from '../config/env';

async function main() {
  const config = getBackendConfig();
  const dbMeta = getSafeDatabaseMetadata(config.databaseUrl);

  console.log('============================================================');
  console.log(`[MineCare CLI] Running Database Migrations (${config.nodeEnv.toUpperCase()})`);
  console.log('============================================================');

  // Strict Fail-Fast Check: A real DATABASE_URL is mandatory for CLI migrations
  if (!config.databaseUrl || !dbMeta.configured) {
    console.error('[MineCare CLI] FATAL CONFIGURATION ERROR:');
    console.error('  DATABASE_URL is not configured or is invalid in .env.');
    console.error('  CLI migrations cannot execute without an authoritative PostgreSQL database.');
    console.error('  Silent in-memory test fallback is strictly prohibited.');
    console.error('\nTo resolve this:');
    console.error('  1. Open .env in your project root.');
    console.error('  2. Set DATABASE_URL=postgresql://postgres.[ref]:[password]@[host]:[port]/postgres');
    console.error('  3. Re-run: npm run db:migrate');
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

  try {
    const isHealthy = await connectionManager.testConnection();
    if (!isHealthy || connectionManager.isPgMem()) {
      console.error(`[MineCare CLI] FATAL: Unable to reach PostgreSQL database at '${dbMeta.host}'.`);
      console.error('Please verify network connectivity, firewall rules, and credentials.');
      process.exit(1);
    }

    const results = await migrator.runMigrations();
    const applied = results.filter((r) => r.applied).length;
    const skipped = results.filter((r) => !r.applied && !r.error).length;
    const failed = results.filter((r) => r.error).length;

    console.log('------------------------------------------------------------');
    console.log('[MineCare CLI] Migration Run Complete:');
    console.log(`  Applied: ${applied}`);
    console.log(`  Skipped: ${skipped}`);
    console.log(`  Failed:  ${failed}`);
    console.log('============================================================');

    await connectionManager.closePool();

    if (failed > 0) {
      process.exit(1);
    }
  } catch (err) {
    console.error('[MineCare CLI] Migration failed with error:', err);
    await connectionManager.closePool();
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('Fatal CLI Error:', err);
  process.exit(1);
});
