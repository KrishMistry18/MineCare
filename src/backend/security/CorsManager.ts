/**
 * MineCare - Strict Production CORS Policy Manager
 *
 * Enforces explicit origin allowlists. Prohibits wildcard ('*') fallback in production.
 * Handles OPTIONS preflight requests securely with appropriate Cache and Vary headers.
 */

import type { IncomingMessage, ServerResponse } from 'http';
import { getBackendConfig } from '../config/env';
import { ApiError } from './ApiError';
import { RequestIdManager } from './RequestId';

export class CorsManager {
  /**
   * Applies CORS headers to response.
   * Returns false if request is a cross-origin request from an unauthorized origin in production.
   */
  public static handleCors(req: IncomingMessage, res: ServerResponse): boolean {
    const config = getBackendConfig();
    const isProduction = process.env.NODE_ENV === 'production' || config.isProduction;
    const originHeader = req.headers.origin;
    const requestOrigin = typeof originHeader === 'string' ? originHeader.trim() : undefined;

    // Parse configured allowlist from CORS_ORIGIN (process.env takes precedence in production)
    const rawOrigins = (process.env.CORS_ORIGIN || config.corsOrigin || '').trim();
    const allowlist = rawOrigins
      ? rawOrigins.split(',').map((o) => o.trim().toLowerCase()).filter(Boolean)
      : [];

    let isAllowed = false;
    let allowedOriginToSet: string | null = null;

    if (!requestOrigin) {
      // Same-origin, direct server-to-server, or local CLI requests (no Origin header)
      isAllowed = true;
    } else {
      const lowerReqOrigin = requestOrigin.toLowerCase();

      // In development / test mode, allow localhost and 127.0.0.1 origins
      const isLocalhostOrigin =
        /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(lowerReqOrigin);

      if (!isProduction && (isLocalhostOrigin || allowlist.length === 0)) {
        isAllowed = true;
        allowedOriginToSet = requestOrigin;
      } else if (allowlist.includes(lowerReqOrigin)) {
        isAllowed = true;
        allowedOriginToSet = requestOrigin;
      } else {
        // Disallowed cross-origin in production
        isAllowed = false;
      }
    }

    if (allowedOriginToSet) {
      res.setHeader('Access-Control-Allow-Origin', allowedOriginToSet);
      res.setHeader('Vary', 'Origin');
    }

    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    res.setHeader(
      'Access-Control-Allow-Headers',
      'Content-Type, Authorization, X-Request-ID, X-Device-Token'
    );
    res.setHeader('Access-Control-Max-Age', '86400');

    // Handle OPTIONS Preflight
    if (req.method?.toUpperCase() === 'OPTIONS') {
      if (!isAllowed && isProduction) {
        const requestId = RequestIdManager.resolveRequestId(req, res);
        res.statusCode = 403;
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify(ApiError.forbidden(requestId, 'Forbidden: CORS origin not allowed')));
        return false;
      }
      res.statusCode = 204;
      res.end();
      return false; // Handled completely
    }

    if (!isAllowed && isProduction) {
      const requestId = RequestIdManager.resolveRequestId(req, res);
      res.statusCode = 403;
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify(ApiError.forbidden(requestId, 'Forbidden: CORS origin not allowed')));
      return false;
    }

    return true; // Allowed to proceed to router
  }
}

