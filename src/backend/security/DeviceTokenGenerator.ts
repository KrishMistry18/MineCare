/**
 * MineCare - Cryptographic Device Token Generator
 *
 * Generates high-entropy CSPRNG tokens for ESP8266 hardware devices.
 * Uses Node.js crypto.randomBytes(32) to ensure 256 bits of cryptographic entropy.
 *
 * Rules:
 * - Raw tokens are returned exactly once upon initial provisioning.
 * - Raw tokens are NEVER stored in plaintext in any database or file.
 * - Raw tokens are NEVER logged in server logs or observability metrics.
 * - Only SHA-256 digests and safe short prefixes are stored persistently.
 */

import crypto from 'crypto';

export interface GeneratedDeviceToken {
  rawToken: string;
  tokenHash: string;
  tokenPrefix: string;
}

export class DeviceTokenGenerator {
  /**
   * Generates a high-entropy CSPRNG device token for a specific helmet.
   * Format: mc_live_${cleanHelmetId}_${random64HexChars}
   */
  public static generate(helmetId: string): GeneratedDeviceToken {
    const cleanHelmetId = helmetId.replace(/[^a-zA-Z0-9_-]/g, '');
    const entropyHex = crypto.randomBytes(32).toString('hex'); // 32 bytes = 256 bits = 64 hex characters
    const rawToken = `mc_live_${cleanHelmetId}_${entropyHex}`;
    const tokenHash = this.hash(rawToken);
    const tokenPrefix = rawToken.slice(0, 16);

    return {
      rawToken,
      tokenHash,
      tokenPrefix,
    };
  }

  /**
   * Computes the SHA-256 hash digest of a raw token.
   */
  public static hash(rawToken: string): string {
    return crypto.createHash('sha256').update(rawToken.trim()).digest('hex');
  }

  /**
   * Extracts a safe prefix for logging and identification without exposing entropy.
   */
  public static getPrefix(rawToken: string): string {
    return rawToken.trim().slice(0, 16);
  }
}
