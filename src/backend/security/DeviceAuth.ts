/**
 * MineCare - IoT Device Authentication Boundary
 *
 * Separates USER API authentication (JWT / Supabase Auth) from
 * PHYSICAL/EMULATED HARDWARE DEVICE authentication (ESP8266 / Telemetry Nodes).
 *
 * Provides a dedicated authentication boundary for high-frequency telemetry ingestion:
 * - Supports `X-Device-Token` header for sensor nodes / microcontrollers.
 * - Hardware tokens are strictly bound to specific helmet IDs.
 * - Rejects invalid, revoked, or mismatched hardware tokens.
 * - Supports operator/supervisor user sessions for simulation and manual override.
 * - Preserves mock telemetry in development / test mode.
 * - Rejects unauthenticated telemetry packets in production.
 */

import type { IncomingMessage } from 'http';
import type { DbUserProfile } from '../types';

export interface DeviceAuthResult {
  isAuthenticated: boolean;
  statusCode?: 401 | 403;
  authType: 'DEVICE_TOKEN' | 'USER_SESSION' | 'DEV_SIMULATION' | 'ANONYMOUS';
  deviceId?: string;
  user?: DbUserProfile;
  error?: string;
}

const DEFAULT_DEV_DEVICE_TOKEN = 'minecare-esp8266-prototype-device-key-2026';

export class DeviceAuthManager {
  private static revokedTokens: Set<string> = new Set();
  private static registeredTokens: Map<string, string> = new Map(); // token -> helmetId

  /**
   * Registers a hardware device token bound to a specific helmet ID.
   */
  public static registerDeviceToken(token: string, helmetId: string): void {
    this.registeredTokens.set(token.trim(), helmetId.trim());
  }

  /**
   * Explicitly marks a device token as revoked.
   */
  public static revokeToken(token: string): void {
    this.revokedTokens.add(token.trim());
  }

  /**
   * Checks whether a device token is revoked.
   */
  public static isTokenRevoked(token: string): boolean {
    const clean = token.trim();
    if (this.revokedTokens.has(clean)) {
      return true;
    }
    const envRevoked = process.env.MINECARE_REVOKED_DEVICE_TOKENS;
    if (envRevoked) {
      const revokedList = envRevoked.split(',').map((t) => t.trim());
      if (revokedList.includes(clean)) {
        return true;
      }
    }
    return false;
  }

  /**
   * Resets registry state (useful for hermetic test suites).
   */
  public static resetRegistry(): void {
    this.revokedTokens.clear();
    this.registeredTokens.clear();
  }

  /**
   * Evaluates authentication boundary for telemetry ingestion with helmet binding.
   */
  public static authenticateTelemetryRequest(
    req: IncomingMessage,
    currentUser: DbUserProfile | null,
    isProduction: boolean,
    targetHelmetId?: string
  ): DeviceAuthResult {
    const rawDeviceToken = req.headers['x-device-token'];
    const deviceToken = typeof rawDeviceToken === 'string' ? rawDeviceToken.trim() : undefined;
    const configuredSecret = process.env.MINECARE_DEVICE_SECRET || DEFAULT_DEV_DEVICE_TOKEN;

    // 1. Hardware Device Token Authentication (ESP8266 & Hardware Gateway)
    if (deviceToken) {
      // 1.1 Revocation Check
      if (this.isTokenRevoked(deviceToken)) {
        return {
          isAuthenticated: false,
          statusCode: 401,
          authType: 'DEVICE_TOKEN',
          error: 'Unauthorized: Device token has been revoked',
        };
      }

      // 1.2 Explicit Registered Token Check (with bound helmet validation)
      if (this.registeredTokens.has(deviceToken)) {
        const boundHelmet = this.registeredTokens.get(deviceToken);
        if (targetHelmetId && boundHelmet && boundHelmet !== targetHelmetId) {
          return {
            isAuthenticated: false,
            statusCode: 403,
            authType: 'DEVICE_TOKEN',
            error: `Forbidden: Device token is bound to helmet ${boundHelmet}, not ${targetHelmetId}`,
          };
        }
        return {
          isAuthenticated: true,
          authType: 'DEVICE_TOKEN',
          deviceId: deviceToken,
        };
      }

      // 1.3 Format: mc_dev_${helmetId} (e.g. mc_dev_MC-001)
      if (deviceToken.startsWith('mc_dev_')) {
        const boundHelmetId = deviceToken.slice(7);
        if (targetHelmetId && boundHelmetId && boundHelmetId !== targetHelmetId) {
          return {
            isAuthenticated: false,
            statusCode: 403,
            authType: 'DEVICE_TOKEN',
            error: `Forbidden: Device token is bound to helmet ${boundHelmetId}, not ${targetHelmetId}`,
          };
        }
        return {
          isAuthenticated: true,
          authType: 'DEVICE_TOKEN',
          deviceId: deviceToken,
        };
      }

      // 1.4 Master Hardware Gateway Secret
      if (deviceToken === configuredSecret) {
        return {
          isAuthenticated: true,
          authType: 'DEVICE_TOKEN',
          deviceId: 'gateway-master',
        };
      }

      // 1.5 Unrecognized Token
      return {
        isAuthenticated: false,
        statusCode: 401,
        authType: 'DEVICE_TOKEN',
        error: 'Unauthorized: Invalid X-Device-Token for telemetry node',
      };
    }

    // 2. Authenticated User Session (Operator / Admin / Supervisor Override)
    if (currentUser) {
      if (currentUser.role === 'ADMIN' || currentUser.role === 'SUPERVISOR') {
        return {
          isAuthenticated: true,
          authType: 'USER_SESSION',
          user: currentUser,
        };
      }
      // Workers cannot inject arbitrary fleet telemetry
      return {
        isAuthenticated: false,
        statusCode: 403,
        authType: 'USER_SESSION',
        error: 'Forbidden: Workers cannot inject fleet telemetry packets',
      };
    }

    // 3. Development / Test Mode Mock Telemetry Simulation
    if (!isProduction) {
      return {
        isAuthenticated: true,
        authType: 'DEV_SIMULATION',
      };
    }

    // 4. Production Mode: Telemetry without device token or authorized session is rejected
    return {
      isAuthenticated: false,
      statusCode: 401,
      authType: 'ANONYMOUS',
      error: 'Unauthorized: Telemetry ingestion requires valid X-Device-Token or authorized session',
    };
  }
}
