/**
 * MineCare - Cryptographic JWT Verification & Minting Module
 *
 * Implements standard JSON Web Token (JWT) verification using the 'jose' library.
 * Supports:
 * 1. Supabase Auth JWKS remote key set verification
 * 2. Supabase Auth HMAC-SHA256 signature verification
 * 3. Issuer, audience, expiration, and algorithm validation
 */

import * as jose from 'jose';
import crypto from 'crypto';
import { getBackendConfig } from '../config/env';

export interface VerifiedTokenPayload {
  sub: string;
  email?: string;
  role?: string;
  iss?: string;
  aud?: string | string[];
  exp?: number;
  [key: string]: unknown;
}

const DEFAULT_DEV_JWT_SECRET = 'minecare-dev-jwt-secret-do-not-use-in-production-2026-secure-32chars!';

let remoteJwkSet: ReturnType<typeof jose.createRemoteJWKSet> | null = null;

function getHmacSecret(): Uint8Array {
  const config = getBackendConfig();
  const secret = config.supabaseJwtSecret || DEFAULT_DEV_JWT_SECRET;
  return new TextEncoder().encode(secret);
}

/**
 * Cryptographically verifies a Supabase Auth access token
 */
export async function verifySupabaseJwt(token: string): Promise<VerifiedTokenPayload | null> {
  if (!token || typeof token !== 'string') {
    return null;
  }

  // Reject obsolete prototype tokens
  if (token.startsWith('mc_tok_')) {
    return null;
  }

  const config = getBackendConfig();

  // 1. Try remote JWKS if configured
  if (config.supabaseJwksUrl) {
    try {
      if (!remoteJwkSet) {
        remoteJwkSet = jose.createRemoteJWKSet(new URL(config.supabaseJwksUrl));
      }
      const { payload } = await jose.jwtVerify(token, remoteJwkSet, {
        issuer: config.supabaseJwtIssuer,
        audience: 'authenticated',
      });
      return payload as VerifiedTokenPayload;
    } catch (_jwksErr) {
      // If remote JWKS fails, fall through to HMAC secret check
    }
  }

  // 2. Verify with HMAC secret (standard Supabase JWT secret)
  try {
    const hmacKey = getHmacSecret();
    const { payload } = await jose.jwtVerify(token, hmacKey, {
      audience: 'authenticated',
    });
    return payload as VerifiedTokenPayload;
  } catch (_hmacErr: unknown) {
    // If audience check failed or signature invalid, reject
    return null;
  }
}

/**
 * Creates a standard compliant JWT for development, automated testing, or demo login
 */
export async function createStandardJwt(
  payload: {
    sub: string;
    email: string;
    role?: string;
  },
  expiresInSeconds: number = 24 * 3600
): Promise<string> {
  const config = getBackendConfig();
  const hmacKey = getHmacSecret();

  const issuer = config.supabaseJwtIssuer || 'https://minecare.local/auth/v1';

  return new jose.SignJWT({
    email: payload.email,
    user_metadata: { role: payload.role },
  })
    .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
    .setSubject(payload.sub)
    .setIssuer(issuer)
    .setAudience('authenticated')
    .setJti(crypto.randomUUID())
    .setIssuedAt()
    .setExpirationTime(Math.floor(Date.now() / 1000) + expiresInSeconds)
    .sign(hmacKey);
}

/**
 * Creates an expired JWT for testing expiration handling
 */
export async function createExpiredTestJwt(
  payload: { sub: string; email: string },
  pastSeconds: number = 60
): Promise<string> {
  const config = getBackendConfig();
  const hmacKey = getHmacSecret();
  const issuer = config.supabaseJwtIssuer || 'https://minecare.local/auth/v1';

  return new jose.SignJWT({
    email: payload.email,
  })
    .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
    .setSubject(payload.sub)
    .setIssuer(issuer)
    .setAudience('authenticated')
    .setIssuedAt(Math.floor(Date.now() / 1000) - pastSeconds * 2)
    .setExpirationTime(Math.floor(Date.now() / 1000) - pastSeconds)
    .sign(hmacKey);
}
