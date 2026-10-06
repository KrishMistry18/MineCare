/**
 * MineCare - Database Migration & Seed Manager
 *
 * Runs all canonical SQL migrations from supabase/migrations/ in strict sequential order.
 * Tracks applied migrations in the schema_migrations table.
 * Manages separate demo/development seed data without overwriting production records.
 */

import fs from 'fs';
import path from 'path';
import type pg from 'pg';
import { connectionManager } from './connection';

export interface MigrationResult {
  version: string;
  applied: boolean;
  error?: string;
}

export class DatabaseMigrator {
  private migrationsDir: string;
  private seedFile: string;

  constructor(customMigrationsDir?: string, customSeedFile?: string) {
    const baseDir = process.cwd();
    this.migrationsDir = customMigrationsDir || path.resolve(baseDir, 'supabase', 'migrations');
    this.seedFile = customSeedFile || path.resolve(baseDir, 'database', 'seed.sql');
  }

  /**
   * Initializes schema_migrations tracking table
   */
  private async ensureMigrationTable(client: pg.PoolClient | pg.Pool): Promise<void> {
    try {
      await client.query(`
        CREATE TABLE IF NOT EXISTS public.schema_migrations (
          version TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );
      `);
    } catch {
      // table might already exist
    }
  }

  /**
   * Run all pending migrations in alphabetical/timestamp order
   */
  public async runMigrations(customPool?: pg.Pool): Promise<MigrationResult[]> {
    const pool = customPool || connectionManager.getPool();
    const results: MigrationResult[] = [];

    await this.ensureMigrationTable(pool);

    // In isolated test doubles (pg-mem) that lack Supabase GoTrue, provision test stub
    if (connectionManager.isPgMem()) {
      try {
        await pool.query(`
          CREATE SCHEMA IF NOT EXISTS auth;
          CREATE TABLE IF NOT EXISTS auth.users (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            email TEXT UNIQUE,
            created_at TIMESTAMPTZ DEFAULT NOW(),
            updated_at TIMESTAMPTZ DEFAULT NOW()
          );
        `);
      } catch {
        // ignore
      }
    }

    const appliedRows = await pool.query<{ version: string }>('SELECT version FROM public.schema_migrations');
    const appliedSet = new Set(appliedRows.rows.map((r) => r.version));

    if (!fs.existsSync(this.migrationsDir)) {
      console.warn(`[MineCare Migrator] Migrations directory '${this.migrationsDir}' not found.`);
      return results;
    }

    const files = fs
      .readdirSync(this.migrationsDir)
      .filter((f) => f.endsWith('.sql'))
      .sort();

    for (const file of files) {
      const version = file.split('_')[0];
      if (appliedSet.has(version)) {
        results.push({ version, applied: false });
        continue;
      }

      const filePath = path.join(this.migrationsDir, file);
      const sqlContent = fs.readFileSync(filePath, 'utf-8');

      // In pg-mem (in-process test double), strip DDL statements that pg-mem's parser does not support:
      // ALTER PUBLICATION, ENABLE ROW LEVEL SECURITY, and CREATE/DROP POLICY
      let sanitizedSql = sqlContent;
      const isPgMem = connectionManager.isPgMem();

      if (isPgMem) {
        // Remove ALTER PUBLICATION lines
        sanitizedSql = sanitizedSql
          .replace(/ALTER\s+PUBLICATION\s+[^;]+;/gi, '-- skipped publication for pg-mem')
          // Remove ENABLE ROW LEVEL SECURITY
          .replace(/ALTER\s+TABLE\s+[^;]+ENABLE\s+ROW\s+LEVEL\s+SECURITY;/gi, '-- skipped rls for pg-mem')
          // Remove CREATE OR REPLACE FUNCTION auth.* or public.*
          .replace(/CREATE\s+OR\s+REPLACE\s+FUNCTION\s+(?:auth|public)\.[^$]+\$\$[^$]+\$\$\s*LANGUAGE\s+sql[^;]*;/gis, '-- skipped function for pg-mem')
          // Remove CREATE POLICY ... ;
          .replace(/CREATE\s+POLICY\s+"[^"]+"\s+ON\s+[^;]+;/gis, '-- skipped policy for pg-mem')
          // Remove DROP POLICY ... ;
          .replace(/DROP\s+POLICY\s+IF\s+EXISTS\s+"[^"]+"\s+ON\s+[^;]+;/gis, '-- skipped drop policy for pg-mem');
      } else {
        sanitizedSql = sanitizedSql
          .split('\n')
          .filter((line) => !line.trim().startsWith('ALTER PUBLICATION supabase_realtime'))
          .join('\n');
      }

      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        await client.query(sanitizedSql);
        await client.query(
          'INSERT INTO public.schema_migrations (version, name, applied_at) VALUES ($1, $2, NOW())',
          [version, file]
        );
        await client.query('COMMIT');
        results.push({ version, applied: true });
        console.log(`  ✓ [Migration Applied] ${file}`);
      } catch (err: unknown) {
        await client.query('ROLLBACK');
        const errMsg = err instanceof Error ? err.message : String(err);
        console.error(`  ✗ [Migration Failed] ${file}: ${errMsg}`);
        results.push({ version, applied: false, error: errMsg });
        throw new Error(`Failed to apply migration ${file}: ${errMsg}`);
      } finally {
        client.release();
      }
    }

    return results;
  }

  /**
   * Seed canonical demo data (4 zones, 16 workers, 16 helmets, assignments, profiles)
   * Only runs if database tables are unpopulated, or if force = true
   */
  public async seedDemoData(customPool?: pg.Pool, force: boolean = false): Promise<boolean> {
    const pool = customPool || connectionManager.getPool();

    // Check if canonical profiles already exist
    try {
      const checkRes = await pool.query('SELECT COUNT(*) as count FROM profiles');
      const count = Number(checkRes.rows[0]?.count || 0);

      if (count > 0 && !force) {
        return false; // Database already seeded, do not overwrite production data
      }
    } catch {
      // Table doesn't exist yet; migrations must be run first
      return false;
    }

    // In isolated test doubles (pg-mem), ensure test auth.users rows exist before profiles are inserted
    if (connectionManager.isPgMem()) {
      try {
        await pool.query(`
          INSERT INTO auth.users (id, email) VALUES
          ('00000000-0000-0000-0000-000000000001', 'admin@minecare.local'),
          ('00000000-0000-0000-0000-000000000002', 'supervisor@minecare.local'),
          ('00000000-0000-0000-0000-000000000003', 'worker.marak@minecare.local'),
          ('00000000-0000-0000-0000-000000000004', 'worker.kujur@minecare.local')
          ON CONFLICT (id) DO NOTHING;
        `);
      } catch {
        // ignore
      }
    }

    const seedSql = fs.readFileSync(this.seedFile, 'utf-8');
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(seedSql);
      await client.query('COMMIT');
      console.log('  ✓ [Demo Seed Applied] Canonical fleet (16 workers, 16 helmets, 4 zones) seeded successfully.');
      return true;
    } catch (err: unknown) {
      await client.query('ROLLBACK');
      console.error('[MineCare Migrator] Failed to seed demo data:', err);
      throw err;
    } finally {
      client.release();
    }
  }

  /**
   * Clean all tables (for tests only)
   */
  public async resetDatabase(customPool?: pg.Pool): Promise<void> {
    const pool = customPool || connectionManager.getPool();
    await pool.query(`
      DROP SCHEMA IF EXISTS public CASCADE;
      CREATE SCHEMA public;
      GRANT ALL ON SCHEMA public TO postgres;
      GRANT ALL ON SCHEMA public TO public;
    `);
  }
}

export const migrator = new DatabaseMigrator();
