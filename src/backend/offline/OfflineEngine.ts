/**
 * MineCare - Centralized Offline Connectivity Engine
 *
 * Evaluates helmet connectivity state based on last_seen heartbeat timestamps:
 * - ONLINE: Heartbeat received within last 4 seconds (< 4000ms)
 * - STALE: Heartbeat delayed between 4 and 8 seconds (4000ms - 8000ms)
 * - OFFLINE: Missing heartbeat for > 8 seconds (> 8000ms)
 */

import type { ConnectivityState, DbAlert, DbHelmet } from '../types';

export const CONNECTIVITY_THRESHOLDS = {
  STALE_MS: 4000,
  OFFLINE_MS: 8000,
} as const;

export class OfflineEngine {
  public static evaluateConnectivity(lastSeenIso: string, nowMs: number = Date.now()): ConnectivityState {
    const lastSeenMs = Date.parse(lastSeenIso);
    if (isNaN(lastSeenMs)) return 'OFFLINE';

    const diff = nowMs - lastSeenMs;
    if (diff < CONNECTIVITY_THRESHOLDS.STALE_MS) return 'ONLINE';
    if (diff <= CONNECTIVITY_THRESHOLDS.OFFLINE_MS) return 'STALE';
    return 'OFFLINE';
  }

  public static checkFleetHeartbeats(
    helmets: DbHelmet[],
    alerts: DbAlert[],
    nowMs: number = Date.now()
  ): { statusChanges: Array<{ helmetId: string; state: ConnectivityState }>; newAlerts: DbAlert[] } {
    const statusChanges: Array<{ helmetId: string; state: ConnectivityState }> = [];
    const newAlerts: DbAlert[] = [];

    helmets.forEach((helmet) => {
      const state = this.evaluateConnectivity(helmet.last_seen, nowMs);
      const isCurrentlyOnline = helmet.online;

      if (state === 'OFFLINE' && isCurrentlyOnline) {
        helmet.online = false;
        helmet.updated_at = new Date(nowMs).toISOString();
        statusChanges.push({ helmetId: helmet.id, state: 'OFFLINE' });

        // Spawn HELMET_OFFLINE alert if none active
        const existingOfflineAlert = alerts.find(
          (a) => a.helmet_id === helmet.id && a.type === 'HELMET_OFFLINE' && a.status !== 'RESOLVED'
        );

        if (!existingOfflineAlert) {
          const alert: DbAlert = {
            id: `ALT-OFFLINE-${Date.now()}-${helmet.id}`,
            helmet_id: helmet.id,
            worker_id: helmet.worker_id,
            type: 'HELMET_OFFLINE',
            severity: 'WARNING',
            message: `Telemetry heartbeat lost for > ${CONNECTIVITY_THRESHOLDS.OFFLINE_MS / 1000} seconds. Telemetry link disrupted.`,
            status: 'TRIGGERED',
            triggered_at: new Date(nowMs).toISOString(),
            acknowledged_at: null,
            acknowledged_by: null,
            resolved_at: null,
            supervisor_notes: null,
            created_at: new Date(nowMs).toISOString(),
            updated_at: new Date(nowMs).toISOString(),
          };
          alerts.unshift(alert);
          newAlerts.push(alert);
        }
      } else if (state === 'ONLINE' && !isCurrentlyOnline) {
        helmet.online = true;
        helmet.updated_at = new Date(nowMs).toISOString();
        statusChanges.push({ helmetId: helmet.id, state: 'ONLINE' });

        // Auto-resolve any active OFFLINE alert
        alerts.forEach((a) => {
          if (a.helmet_id === helmet.id && a.type === 'HELMET_OFFLINE' && a.status !== 'RESOLVED') {
            a.status = 'RESOLVED';
            a.resolved_at = new Date(nowMs).toISOString();
            a.supervisor_notes = 'Auto-resolved: Heartbeat packet stream re-established.';
            a.updated_at = new Date(nowMs).toISOString();
          }
        });
      }
    });

    return { statusChanges, newAlerts };
  }
}
