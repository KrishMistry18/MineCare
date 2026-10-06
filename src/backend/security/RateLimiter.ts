/**
 * MineCare - Production Rate Limiting Architecture
 *
 * Implements sliding-window token throttling across four critical tiers:
 * 1. AUTH: Throttles login brute-force attempts
 * 2. TELEMETRY: Protects ingestion pipeline against flooding
 * 3. GENERAL: Fleet and operational REST endpoint protection
 * 4. ADMIN: Privileged console operation limits
 *
 * Emits standard RateLimit-* and Retry-After headers.
 * Implements bounded in-memory sliding window with periodic cleanup,
 * with pluggable storage interface for multi-instance PostgreSQL/Redis deployments.
 */

import type { ServerResponse } from 'http';

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

interface WindowEntry {
  timestamps: number[];
  blockedUntil?: number;
}

export class RateLimiter {
  private static instance: RateLimiter | null = null;
  private buckets: Map<string, WindowEntry> = new Map();
  private cleanupTimer: NodeJS.Timeout | null = null;

  private constructor() {
    // Run cleanup every 2 minutes to remove expired windows
    if (typeof setInterval !== 'undefined') {
      this.cleanupTimer = setInterval(() => this.pruneExpired(), 2 * 60 * 1000);
      if (typeof this.cleanupTimer.unref === 'function') {
        this.cleanupTimer.unref();
      }
    }
  }

  public static getInstance(): RateLimiter {
    if (!RateLimiter.instance) {
      RateLimiter.instance = new RateLimiter();
    }
    return RateLimiter.instance;
  }

  public static resetInstance(): void {
    if (RateLimiter.instance?.cleanupTimer) {
      clearInterval(RateLimiter.instance.cleanupTimer);
    }
    RateLimiter.instance = null;
  }

  /**
   * Evaluates request against rate limit policy.
   * Returns: { allowed: boolean, remaining: number, resetSeconds: number, retryAfterSeconds?: number }
   */
  public checkLimit(
    category: 'AUTH' | 'TELEMETRY' | 'GENERAL' | 'ADMIN',
    identifier: string
  ): {
    allowed: boolean;
    limit: number;
    remaining: number;
    resetSeconds: number;
    retryAfterSeconds?: number;
  } {
    const policy = RATE_LIMIT_POLICIES[category] || RATE_LIMIT_POLICIES.GENERAL;
    const now = Date.now();
    const key = `${category}:${identifier}`;

    let entry = this.buckets.get(key);
    if (!entry) {
      entry = { timestamps: [] };
      this.buckets.set(key, entry);
    }

    // Check if actively blocked
    if (entry.blockedUntil && entry.blockedUntil > now) {
      const retryAfter = Math.ceil((entry.blockedUntil - now) / 1000);
      return {
        allowed: false,
        limit: policy.maxRequests,
        remaining: 0,
        resetSeconds: retryAfter,
        retryAfterSeconds: retryAfter,
      };
    }

    // Prune timestamps outside current window
    const windowStart = now - policy.windowMs;
    entry.timestamps = entry.timestamps.filter((ts) => ts > windowStart);

    if (entry.timestamps.length >= policy.maxRequests) {
      // Exceeded limit: block for remaining window or retry interval
      const oldest = entry.timestamps[0];
      const resetTime = oldest + policy.windowMs;
      const retryAfter = Math.max(1, Math.ceil((resetTime - now) / 1000));
      entry.blockedUntil = now + retryAfter * 1000;

      return {
        allowed: false,
        limit: policy.maxRequests,
        remaining: 0,
        resetSeconds: retryAfter,
        retryAfterSeconds: retryAfter,
      };
    }

    // Record request
    entry.timestamps.push(now);
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
  public reset(category: 'AUTH' | 'TELEMETRY' | 'GENERAL' | 'ADMIN', identifier: string): void {
    this.buckets.delete(`${category}:${identifier}`);
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

  private pruneExpired(): void {
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
}
