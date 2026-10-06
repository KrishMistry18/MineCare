/**
 * MineCare - Production HTTP Security Headers Module
 *
 * Emits hardened, compliant security headers protecting against XSS, clickjacking,
 * MIME sniffing, and unintended cross-origin embedding.
 */

import type { ServerResponse } from 'http';

export class SecurityHeadersManager {
  public static apply(res: ServerResponse): void {
    if (res.headersSent) return;

    // 1. Content Security Policy (tuned to allow Google Fonts, WebSockets, and Vite bundle)
    res.setHeader(
      'Content-Security-Policy',
      "default-src 'self'; " +
      "script-src 'self' 'unsafe-inline'; " +
      "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; " +
      "font-src 'self' https://fonts.gstatic.com data:; " +
      "img-src 'self' data: https: blob:; " +
      "connect-src 'self' https: wss:; " +
      "frame-ancestors 'none'; " +
      "base-uri 'self'; " +
      "form-action 'self'"
    );

    // 2. MIME Sniffing protection
    res.setHeader('X-Content-Type-Options', 'nosniff');

    // 3. Referrer Policy
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');

    // 4. Strict Transport Security (HSTS)
    res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains; preload');

    // 5. Anti-Clickjacking Frame Options (defense in depth alongside CSP frame-ancestors)
    res.setHeader('X-Frame-Options', 'DENY');

    // 6. Restrictive Device Permissions Policy
    res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');

    // 7. Modern XSS Protection Header
    res.setHeader('X-XSS-Protection', '0');
  }
}
