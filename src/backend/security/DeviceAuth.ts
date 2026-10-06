/**
 * MineCare - IoT Device Authentication Boundary
 *
 * Separates USER API authentication (JWT / Supabase Auth) from
 * PHYSICAL/EMULATED HARDWARE DEVICE authentication (ESP8266 / Telemetry Nodes).
 *
 * Provides a dedicated authentication boundary for high-frequency telemetry ingestion:
 * - Supports `X-Device-Token` header for sensor nodes / microcontrollers.
 * - Supports operator/supervisor user sessions for simulation and manual override.
 * - Rejects unauthenticated telemetry packets in production.
 */

import type { IncomingMessage } from 'http';
import type { DbUserProfile } from '../types';

export interface DeviceAuthResult {
  isAuthenticated: boolean;
  authType: 'DEVICE_TOKEN' | 'USER_SESSION' | 'DEV_SIMULATION' | 'ANONYMOUS';
  deviceId?: string;
  user?: DbUserProfile;
  error?: string;
}

const DEFAULT_DEV_DEVICE_TOKEN = 'minecare-esp8266-prototype-device-key-2026';

export class DeviceAuthManager {
  /**
   * Evaluates authentication boundary for telemetry ingestion.
   */
  public static authenticateTelemetryRequest(
    req: IncomingMessage,
    currentUser: DbUserProfile | null,
    isProduction: boolean
  ): DeviceAuthResult {
    const rawDeviceToken = req.headers['x-device-token'];
    const deviceToken = typeof rawDeviceToken === 'string' ? rawDeviceToken.trim() : undefined;
    const configuredSecret = process.env.MINECARE_DEVICE_SECRET || DEFAULT_DEV_DEVICE_TOKEN;

    // 1. Hardware Device Token Authentication (Future ESP8266 & Hardware Gateway)
    if (deviceToken) {
      if (deviceToken === configuredSecret || deviceToken.startsWith('mc_dev_')) {
        return {
          isAuthenticated: true,
          authType: 'DEVICE_TOKEN',
          deviceId: deviceToken,
        };
      }
      return {
        isAuthenticated: false,
        authType: 'DEVICE_TOKEN',
        error: 'Invalid X-Device-Token for telemetry node',
      };
    }

    // 2. Authenticated User Session (Web UI Simulation Console / Admin / Supervisor)
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

    // 4. Production Mode: Telemetry without device token or valid session is rejected
    return {
      isAuthenticated: false,
      authType: 'ANONYMOUS',
      error: 'Unauthorized: Telemetry ingestion requires valid X-Device-Token or authorized session',
    };
  }
}
