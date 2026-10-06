/**
 * MineCare - Production Rate Limiting Architecture
 *
 * Implements sliding-window token throttling across four critical tiers:
 * 1. AUTH: Throttles login brute-force attempts (5 attempts / 15 min)
 * 2. TELEMETRY: Protects ingestion pipeline against flooding (120/min)
 * 3. GENERAL: Fleet and operational REST endpoint protection (300/min)
 * 4. ADMIN: Privileged console operation limits (60/min)
 *
 * Emits standard RateLimit-* and Retry-After headers.
 * Production Safety:
 * - Backed by PostgreSQL persistence (rate_limits table) for multi-instance deployments.
 * - Silent in-memory fallback is strictly blocked in production mode.
 * - In-memory store available exclusively for hermetic development and non-DB test doubles.
 */

import type { ServerResponse } from 'http';
import { connectionManager } from '../db/connection';
import { getBackendConfig } from '../config/env';

export interface RateLimitPolicy {
  windowMs: number;
  maxRequests: number;
}

export const RATE_LIMIT_POLICIES: Record<string, RateLimitPolicy> = {
  // Login: 5 attempts per 15 minutes per IP/email
  AUTH: {
    windowMs: 15 * 60 * 1000,
    maxRequests: 5,
  },
  // Telemetry: 120 packets per minute per helmet/IP (2 Hz sustained + burst)
  TELEMETRY: {
    windowMs: 60 * 1000,
    maxRequests: 120,
  },
  // General operational API: 300 requests per minute
  GENERAL: {
    windowMs: 60 * 1000,
    maxRequests: 300,
  },
  // Admin operations: 60 requests per minute
  ADMIN: {
    windowMs: 60 * 1000,
    maxRequests: 60,
  },
};

export interface RateLimitEntry {
  timestamps: number[];
  blockedUntil?: number;
}

export interface RateLimitResult {
  allowed: boolean;
  limit: number;
  remaining: number;
  resetSeconds: number;
  retryAfterSeconds?: number;
}

export interface IRateLimitStore {
  get(key: string): Promise<RateLimitEntry | null>;
  set(key: string, entry: RateLimitEntry, ttlMs: number): Promise<void>;
  delete(key: string): Promise<void>;
  prune?(): Promise<void>;
  isPersistent(): boolean;
}

/**
 * In-Memory Rate Limit Store (for hermetic dev/test)
 */
export class MemoryRateLimitStore implements IRateLimitStore {
  private buckets: Map<string, RateLimitEntry> = new Map();

  public async get(key: string): Promise<RateLimitEntry | null> {
    const entry = this.buckets.get(key);
    if (!entry) return null;
    return {
      timestamps: [...entry.timestamps],
      blockedUntil: entry.blockedUntil,
    };
  }

  public async set(key: string, entry: RateLimitEntry): Promise<void> {
    this.buckets.set(key, {
      timestamps: [...entry.timestamps],
      blockedUntil: entry.blockedUntil,
    });
  }

  public async delete(key: string): Promise<void> {
    this.buckets.delete(key);
  }

  public async prune(): Promise<void> {
    const now = Date.now();
    for (const [key, entry] of this.buckets.entries()) {
      const category = key.split(':')[0];
      const policy = RATE_LIMIT_POLICIES[category] || RATE_LIMIT_POLICIES.GENERAL;
      const windowStart = now - policy.windowMs;
      entry.timestamps = entry.timestamps.filter((ts) => ts > windowStart);
      if (entry.timestamps.length === 0 && (!entry.blockedUntil || entry.blockedUntil <= now)) {
        this.buckets.delete(key);
      }
    }
  }

  public isPersistent(): boolean {
    return false;
  }

  public clear(): void {
    this.buckets.clear();
  }
}

/**
 * Authoritative PostgreSQL-backed Rate Limit Store
 */
export class PostgresRateLimitStore implements IRateLimitStore {
  private tableEnsured = false;

  private async ensureTable(): Promise<void> {
    if (this.tableEnsured) return;
    try {
      await connectionManager.query(`
        CREATE TABLE IF NOT EXISTS rate_limits (
          key TEXT PRIMARY KEY,
          timestamps JSONB NOT NULL DEFAULT '[]'::jsonb,
          blocked_until BIGINT,
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );
      `);
      this.tableEnsured = true;
    } catch (err) {
      const config = getBackendConfig();
      if (config.isProduction) {
        throw new Error(
          `[MineCare RateLimiter] FATAL: Failed to initialize PostgreSQL rate_limits table in production: ${
            err instanceof Error ? err.message : String(err)
          }`
        );
      }
    }
  }

  public async get(key: string): Promise<RateLimitEntry | null> {
    await this.ensureTable();
    const res = await connectionManager.query<{ timestamps: unknown; blocked_until: string | null }>(
      'SELECT timestamps, blocked_until FROM rate_limits WHERE key = $1',
      [key]
    );

    if (res.rows.length === 0) {
      return null;
    }

    const row = res.rows[0];
    let timestamps: number[] = [];
    if (Array.isArray(row.timestamps)) {
      timestamps = row.timestamps.map(Number);
    } else if (typeof row.timestamps === 'string') {
      try {
        timestamps = JSON.parse(row.timestamps).map(Number);
      } catch {
        timestamps = [];
      }
    }

    return {
      timestamps,
      blockedUntil: row.blocked_until ? Number(row.blocked_until) : undefined,
    };
  }

  public async set(key: string, entry: RateLimitEntry): Promise<void> {
    await this.ensureTable();
    await connectionManager.query(
      `INSERT INTO rate_limits (key, timestamps, blocked_until, updated_at)
       VALUES ($1, $2, $3, NOW())
       ON CONFLICT (key) DO UPDATE SET
         timestamps = EXCLUDED.timestamps,
         blocked_until = EXCLUDED.blocked_until,
         updated_at = NOW()`,
      [key, JSON.stringify(entry.timestamps), entry.blockedUntil ?? null]
    );
  }

  public async delete(key: string): Promise<void> {
    await this.ensureTable();
    await connectionManager.query('DELETE FROM rate_limits WHERE key = $1', [key]);
  }

  public async prune(): Promise<void> {
    await this.ensureTable();
    await connectionManager.query("DELETE FROM rate_limits WHERE updated_at < NOW() - INTERVAL '1 hour'");
  }

  public isPersistent(): boolean {
    return true;
  }
}

export class RateLimiter {
  private static instance: RateLimiter | null = null;
  private store: IRateLimitStore;
  private cleanupTimer: NodeJS.Timeout | null = null;

  private constructor(customStore?: IRateLimitStore) {
    const config = getBackendConfig();

    if (customStore) {
      if (config.isProduction && !customStore.isPersistent()) {
        throw new Error(
          '[MineCare RateLimiter] FATAL: Production rate limiting requires persistent PostgreSQL backend. In-memory fallback is disabled.'
        );
      }
      this.store = customStore;
    } else if (config.isProduction) {
      // Production mode requires PostgreSQL store
      this.store = new PostgresRateLimitStore();
    } else if (config.databaseUrl) {
      // Dev mode with database configured
      this.store = new PostgresRateLimitStore();
    } else {
      // Dev/test hermetic in-memory store
      this.store = new MemoryRateLimitStore();
    }

    // Run pruning every 2 minutes
    if (typeof setInterval !== 'undefined') {
      this.cleanupTimer = setInterval(() => {
        this.store.prune?.().catch(() => {
          // ignore background cleanup error
        });
      }, 2 * 60 * 1000);
      if (typeof this.cleanupTimer.unref === 'function') {
        this.cleanupTimer.unref();
      }
    }
  }

  public static getInstance(customStore?: IRateLimitStore): RateLimiter {
    if (!RateLimiter.instance) {
      RateLimiter.instance = new RateLimiter(customStore);
    } else if (customStore) {
      RateLimiter.instance.setStore(customStore);
    }
    return RateLimiter.instance;
  }

  public static resetInstance(): void {
    if (RateLimiter.instance?.cleanupTimer) {
      clearInterval(RateLimiter.instance.cleanupTimer);
    }
    RateLimiter.instance = null;
  }

  public setStore(store: IRateLimitStore): void {
    const config = getBackendConfig();
    if (config.isProduction && !store.isPersistent()) {
      throw new Error(
        '[MineCare RateLimiter] FATAL: Production rate limiting requires persistent PostgreSQL backend. In-memory fallback is disabled.'
      );
    }
    this.store = store;
  }

  public getStore(): IRateLimitStore {
    return this.store;
  }

  /**
   * Evaluates request against rate limit policy.
   * Returns: { allowed: boolean, remaining: number, resetSeconds: number, retryAfterSeconds?: number }
   */
  public async checkLimit(
    category: 'AUTH' | 'TELEMETRY' | 'GENERAL' | 'ADMIN',
    identifier: string
  ): Promise<RateLimitResult> {
    const policy = RATE_LIMIT_POLICIES[category] || RATE_LIMIT_POLICIES.GENERAL;
    const now = Date.now();
    const key = `${category}:${identifier}`;

    let entry: RateLimitEntry;
    try {
      const existing = await this.store.get(key);
      entry = existing || { timestamps: [] };
    } catch (err) {
      const config = getBackendConfig();
      if (config.isProduction) {
        throw new Error(
          `[MineCare RateLimiter] Production rate check failed: ${err instanceof Error ? err.message : String(err)}`
        );
      }
      // In development / test, initialize fresh entry
      entry = { timestamps: [] };
    }

    // 1. Check if actively blocked
    if (entry.blockedUntil && entry.blockedUntil > now) {
      const retryAfter = Math.max(1, Math.ceil((entry.blockedUntil - now) / 1000));
      return {
        allowed: false,
        limit: policy.maxRequests,
        remaining: 0,
        resetSeconds: retryAfter,
        retryAfterSeconds: retryAfter,
      };
    }

    // 2. Prune timestamps outside current window
    const windowStart = now - policy.windowMs;
    entry.timestamps = entry.timestamps.filter((ts) => ts > windowStart);

    // 3. Check if limit exceeded
    if (entry.timestamps.length >= policy.maxRequests) {
      const oldest = entry.timestamps[0];
      const resetTime = oldest + policy.windowMs;
      const retryAfter = Math.max(1, Math.ceil((resetTime - now) / 1000));
      entry.blockedUntil = now + retryAfter * 1000;

      await this.store.set(key, entry, policy.windowMs);

      return {
        allowed: false,
        limit: policy.maxRequests,
        remaining: 0,
        resetSeconds: retryAfter,
        retryAfterSeconds: retryAfter,
      };
    }

    // 4. Record allowed request
    entry.timestamps.push(now);
    entry.blockedUntil = undefined;
    await this.store.set(key, entry, policy.windowMs);

    const remaining = policy.maxRequests - entry.timestamps.length;
    const oldest = entry.timestamps[0];
    const resetSeconds = Math.max(1, Math.ceil((oldest + policy.windowMs - now) / 1000));

    return {
      allowed: true,
      limit: policy.maxRequests,
      remaining,
      resetSeconds,
    };
  }

  /**
   * Resets rate limit for a specific identifier (e.g. on successful login).
   */
  public async reset(category: 'AUTH' | 'TELEMETRY' | 'GENERAL' | 'ADMIN', identifier: string): Promise<void> {
    await this.store.delete(`${category}:${identifier}`);
  }

  /**
   * Applies rate limit headers to HTTP response.
   */
  public applyHeaders(
    res: ServerResponse,
    result: { limit: number; remaining: number; resetSeconds: number; retryAfterSeconds?: number }
  ): void {
    if (res.headersSent) return;

    res.setHeader('RateLimit-Limit', String(result.limit));
    res.setHeader('RateLimit-Remaining', String(result.remaining));
    res.setHeader('RateLimit-Reset', String(result.resetSeconds));

    if (result.retryAfterSeconds !== undefined) {
      res.setHeader('Retry-After', String(result.retryAfterSeconds));
    }
  }
}
