/**
 * MineCare - Production PostgreSQL Connection Manager
 *
 * Implements connection pooling, lifecycle management (startup/shutdown),
 * query timeouts, and error handling for PostgreSQL (Supabase / Self-hosted).
 */

import pg, { type PoolClient, type QueryResult, type QueryResultRow } from 'pg';
import crypto from 'crypto';
import { newDb } from 'pg-mem';
import { getBackendConfig } from '../config/env';

const { Pool } = pg;

export interface IConnectionManager {
  getPool(): pg.Pool;
  query<T extends QueryResultRow = any>(text: string, params?: unknown[]): Promise<QueryResult<T>>;
  getClient(): Promise<PoolClient>;
  withTransaction<T>(callback: (client: PoolClient) => Promise<T>): Promise<T>;
  testConnection(): Promise<boolean>;
  closePool(): Promise<void>;
  isPgMem(): boolean;
}

class PostgresConnectionManager implements IConnectionManager {
  private static instance: PostgresConnectionManager | null = null;
  private pool: pg.Pool | null = null;
  private isUsingPgMem: boolean = false;

  private constructor() {}

  public static getInstance(): PostgresConnectionManager {
    if (!PostgresConnectionManager.instance) {
      PostgresConnectionManager.instance = new PostgresConnectionManager();
    }
    return PostgresConnectionManager.instance;
  }

  /**
   * Initializes the PostgreSQL connection pool according to environment
   */
  public initializePool(customPool?: pg.Pool, isPgMem: boolean = false): pg.Pool {
    if (this.pool) {
      return this.pool;
    }

    if (customPool) {
      this.pool = customPool;
      this.isUsingPgMem = isPgMem;
      return this.pool;
    }

    const config = getBackendConfig();

    if (config.databaseUrl) {
      // Connect to real PostgreSQL / Supabase
      const isLocalhost = config.databaseUrl.includes('localhost') || config.databaseUrl.includes('127.0.0.1');
      this.pool = new Pool({
        connectionString: config.databaseUrl,
        max: 10,
        idleTimeoutMillis: 30000,
        connectionTimeoutMillis: 8000,
        ssl: isLocalhost ? false : { rejectUnauthorized: false },
      });
      this.isUsingPgMem = false;
    } else {
      // In development / test mode without external DB URL, initialize pg-mem PostgreSQL instance
      if (config.isProduction) {
        throw new Error(
          '[MineCare DB] FATAL: Production mode requires a valid DATABASE_URL. In-memory fallback is disabled.'
        );
      }

      this.pool = this.createPgMemPool();
      this.isUsingPgMem = true;
    }

    this.pool.on('error', (err) => {
      console.error('[MineCare DB] Unexpected error on idle PostgreSQL client:', err.message);
    });

    return this.pool;
  }

  /**
   * Creates an in-process PostgreSQL database using pg-mem for hermetic offline testing
   */
  public createPgMemPool(): pg.Pool {
    try {
      const memDb = newDb({
        autoCreateForeignKeyIndices: true,
      });

      // Register standard functions used by Supabase/PostgreSQL migrations
      memDb.public.registerFunction({
        name: 'gen_random_uuid',
        args: [],
        returns: memDb.public.getType('uuid' as any) || (memDb.public as any).uuid,
        implementation: () => crypto.randomUUID(),
      });

      memDb.public.registerFunction({
        name: 'now',
        args: [],
        returns: (memDb.public as any).timestampz || (memDb.public as any).text,
        implementation: () => new Date(),
      });

      // Mock auth schema functions for RLS simulation
      memDb.registerExtension('auth', (schema: any) => {
        schema.registerFunction({
          name: 'uid',
          args: [],
          returns: schema.uuid || (memDb.public as any).uuid,
          implementation: () => '00000000-0000-0000-0000-000000000001',
        });
        schema.registerFunction({
          name: 'role',
          args: [],
          returns: schema.text || (memDb.public as any).text,
          implementation: () => 'authenticated',
        });
      });

      const adapter = memDb.adapters.createPg();
      const memPool = new adapter.Pool();
      return memPool as unknown as pg.Pool;
    } catch (err: unknown) {
      throw new Error(`[MineCare DB] Failed to create in-memory PostgreSQL instance: ${String(err)}`);
    }
  }

  public getPool(): pg.Pool {
    if (!this.pool) {
      return this.initializePool();
    }
    return this.pool;
  }

  public isPgMem(): boolean {
    return this.isUsingPgMem;
  }

  /**
   * Execute parameterized SQL query
   */
  public async query<T extends QueryResultRow = any>(text: string, params?: unknown[]): Promise<QueryResult<T>> {
    const pool = this.getPool();
    const start = Date.now();
    try {
      const res = await pool.query<T>(text, params);
      const duration = Date.now() - start;
      if (duration > 1500) {
        console.warn(`[MineCare DB Slow Query] ${duration}ms: ${text.slice(0, 100)}...`);
      }
      return res;
    } catch (error) {
      console.error(`[MineCare DB Error] Query failed:`, {
        query: text.replace(/\s+/g, ' ').trim().slice(0, 200),
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * Acquire a client from the pool
   */
  public async getClient(): Promise<PoolClient> {
    const pool = this.getPool();
    return pool.connect();
  }

  /**
   * Execute callback within a database transaction
   */
  public async withTransaction<T>(callback: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await this.getClient();
    try {
      await client.query('BEGIN');
      const result = await callback(client);
      await client.query('COMMIT');
      return result;
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  /**
   * Test whether PostgreSQL connectivity is healthy
   */
  public async testConnection(): Promise<boolean> {
    try {
      const res = await this.query('SELECT 1 as healthy');
      return Boolean(res.rows[0]?.healthy === 1);
    } catch {
      return false;
    }
  }

  /**
   * Graceful shutdown of PostgreSQL pool
   */
  public async closePool(): Promise<void> {
    if (this.pool) {
      await this.pool.end();
      this.pool = null;
    }
  }

  /**
   * Force reset of connection pool (for test teardown and restart testing)
   */
  public static resetInstance(): void {
    if (PostgresConnectionManager.instance?.pool) {
      try {
        void PostgresConnectionManager.instance.pool.end();
      } catch {
        // ignore
      }
    }
    PostgresConnectionManager.instance = null;
  }
}

export const connectionManager = PostgresConnectionManager.getInstance();
export { PostgresConnectionManager };
