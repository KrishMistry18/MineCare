/**
 * MineCare - Request Size & Stream Protection Limiter
 *
 * Enforces explicit limits on URL length and incoming JSON request bodies.
 * Rejects oversized streams early with HTTP 413 (Payload Too Large) or 414 (URI Too Long).
 */

import type { IncomingMessage } from 'http';

export const MAX_URI_LENGTH = 2048;

export const ROUTE_BODY_LIMITS: Record<string, number> = {
  auth: 16 * 1024,      // 16 KB
  telemetry: 32 * 1024, // 32 KB
  admin: 64 * 1024,     // 64 KB
  default: 128 * 1024,  // 128 KB
};

export class RequestLimiter {
  public static getLimitForPath(pathname: string): number {
    if (pathname.startsWith('/api/v1/auth/')) {
      return ROUTE_BODY_LIMITS.auth;
    }
    if (pathname === '/api/v1/telemetry') {
      return ROUTE_BODY_LIMITS.telemetry;
    }
    if (pathname.startsWith('/api/v1/admin/')) {
      return ROUTE_BODY_LIMITS.admin;
    }
    return ROUTE_BODY_LIMITS.default;
  }

  public static isUriTooLong(url: string): boolean {
    return url.length > MAX_URI_LENGTH;
  }

  /**
   * Reads JSON body with hard byte-level stream accounting.
   * Rejects immediately if byte limit is exceeded.
   */
  public static readLimitedJsonBody(
    req: IncomingMessage,
    maxBytes: number
  ): Promise<{ data: Record<string, unknown> | null; tooLarge: boolean; parseError?: boolean }> {
    return new Promise((resolve) => {
      let totalBytes = 0;
      let body = '';
      let isAborted = false;

      // Check Content-Length header up front if available
      const rawContentLength = req.headers['content-length'];
      if (rawContentLength) {
        const declaredLength = parseInt(rawContentLength, 10);
        if (!isNaN(declaredLength) && declaredLength > maxBytes) {
          req.resume(); // drain
          return resolve({ data: null, tooLarge: true });
        }
      }

      const onData = (chunk: Buffer | string) => {
        if (isAborted) return;
        const chunkLen = Buffer.isBuffer(chunk) ? chunk.length : Buffer.byteLength(chunk);
        totalBytes += chunkLen;

        if (totalBytes > maxBytes) {
          isAborted = true;
          req.removeListener('data', onData);
          req.resume(); // drain remaining to prevent socket hangs
          return resolve({ data: null, tooLarge: true });
        }

        body += chunk.toString();
      };

      req.on('data', onData);

      req.on('end', () => {
        if (isAborted) return;
        if (!body.trim()) {
          return resolve({ data: {}, tooLarge: false });
        }
        try {
          const parsed = JSON.parse(body);
          if (typeof parsed !== 'object' || parsed === null) {
            return resolve({ data: null, tooLarge: false, parseError: true });
          }
          resolve({ data: parsed as Record<string, unknown>, tooLarge: false });
        } catch {
          resolve({ data: null, tooLarge: false, parseError: true });
        }
      });

      req.on('error', () => {
        if (isAborted) return;
        resolve({ data: null, tooLarge: false, parseError: true });
      });
    });
  }
}
