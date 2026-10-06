/**
 * MineCare - Request ID & Correlation Module
 *
 * Extracts, validates, and generates cryptographically secure request correlation IDs.
 * Conforms to industry standard X-Request-ID specifications.
 */

import crypto from 'crypto';
import type { IncomingMessage, ServerResponse } from 'http';

const VALID_REQUEST_ID_REGEX = /^[a-zA-Z0-9_\-]{8,64}$/;

export class RequestIdManager {
  /**
   * Extracts and validates X-Request-ID from request headers,
   * or generates a secure UUIDv4 if absent or invalid.
   */
  public static resolveRequestId(req: IncomingMessage, res?: ServerResponse): string {
    const rawHeader = req.headers['x-request-id'];
    let requestId: string;

    if (typeof rawHeader === 'string' && rawHeader.trim().length > 0) {
      const trimmed = rawHeader.trim();
      if (VALID_REQUEST_ID_REGEX.test(trimmed)) {
        requestId = trimmed;
      } else {
        // Untrusted/malformed request ID: reject and replace with secure UUID
        requestId = crypto.randomUUID();
      }
    } else {
      requestId = crypto.randomUUID();
    }

    if (res && !res.headersSent) {
      res.setHeader('X-Request-ID', requestId);
    }

    return requestId;
  }
}
