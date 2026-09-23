/**
 * MineCare - Authoritative Alert Lifecycle Engine
 *
 * Implements strict alert lifecycle management:
 * - Deduplication: Prevents spawning duplicate active alerts across consecutive packets.
 * - Auto-recovery: Auto-resolves active hazard alerts when sensors return to SAFE baseline.
 * - Manual acknowledgement & resolution handling with supervisor audit trail.
 */

import type { DbAlert, ValidatedTelemetryPacket } from '../types';
import type { SafetyEvaluation } from '../safety/SafetyEngine';
import type { AlertCategory, AlertSeverity } from '../../types/alert';

export class AlertEngine {
  /**
   * Process evaluated telemetry frame and manage alert lifecycle in persistent store
   */
  public static processAlerts(
    alertsStore: DbAlert[],
    helmetId: string,
    workerId: string | null,
    telemetry: ValidatedTelemetryPacket,
    evaluation: SafetyEvaluation
  ): { createdAlert: DbAlert | null; resolvedAlerts: DbAlert[] } {
    const now = new Date().toISOString();
    const resolvedAlerts: DbAlert[] = [];
    let createdAlert: DbAlert | null = null;

    // 1. RECOVERY: If helmet returned to SAFE, auto-resolve any active hazard alerts
    if (evaluation.status === 'SAFE') {
      alertsStore.forEach((alert) => {
        if (alert.helmet_id === helmetId && alert.status !== 'RESOLVED' && alert.type !== 'HELMET_OFFLINE') {
          alert.status = 'RESOLVED';
          alert.resolved_at = now;
          alert.supervisor_notes = 'Auto-resolved: Environmental and biometric metrics restored to safe baseline.';
          alert.updated_at = now;
          resolvedAlerts.push(alert);
        }
      });
      return { createdAlert: null, resolvedAlerts };
    }

    // 2. Map evaluation trigger to alert category
    let category: AlertCategory = 'GAS_HAZARD';
    if (evaluation.primaryTrigger === 'SOS_BUTTON_TRIGGERED') category = 'SOS_EMERGENCY';
    else if (evaluation.primaryTrigger === 'FALL_IMPACT_DETECTED') category = 'WORKER_FALL';
    else if (evaluation.primaryTrigger === 'MULTIPLE_HAZARDS') category = 'MULTI_HAZARD';
    else if (evaluation.primaryTrigger === 'HIGH_TEMPERATURE') category = 'HEAT_STRESS';

    const severity: AlertSeverity = evaluation.status === 'DANGER' ? 'CRITICAL' : 'WARNING';

    // 3. Deduplication check: Is there already an active (unresolved) alert for this helmet & category?
    const existingActiveAlert = alertsStore.find(
      (a) => a.helmet_id === helmetId && a.type === category && a.status !== 'RESOLVED'
    );

    if (existingActiveAlert) {
      // Ongoing active incident: update readings snapshot without generating duplicates
      existingActiveAlert.message = evaluation.triggerDetails.join(' | ');
      existingActiveAlert.readings_snapshot = {
        temperature: telemetry.temperature,
        humidity: telemetry.humidity,
        gas_value: telemetry.gasValue,
        total_acceleration: telemetry.totalAcceleration,
        sos_pressed: telemetry.sosPressed,
        fall_detected: telemetry.fallDetected,
      };
      existingActiveAlert.updated_at = now;
      return { createdAlert: null, resolvedAlerts: [] };
    }

    // 4. Create new alert
    const newAlert: DbAlert = {
      id: `ALT-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
      helmet_id: helmetId,
      worker_id: workerId,
      type: category,
      severity,
      message: evaluation.triggerDetails.join(' | '),
      status: 'TRIGGERED',
      triggered_at: telemetry.timestamp,
      acknowledged_at: null,
      acknowledged_by: null,
      resolved_at: null,
      supervisor_notes: null,
      readings_snapshot: {
        temperature: telemetry.temperature,
        humidity: telemetry.humidity,
        gas_value: telemetry.gasValue,
        total_acceleration: telemetry.totalAcceleration,
        sos_pressed: telemetry.sosPressed,
        fall_detected: telemetry.fallDetected,
      },
      created_at: now,
      updated_at: now,
    };

    alertsStore.unshift(newAlert);
    createdAlert = newAlert;

    return { createdAlert, resolvedAlerts };
  }

  public static acknowledge(
    alertsStore: DbAlert[],
    alertId: string,
    supervisorName: string = 'Supervisor On-Duty'
  ): DbAlert | null {
    const alert = alertsStore.find((a) => a.id === alertId);
    if (!alert) return null;

    alert.status = 'ACKNOWLEDGED';
    alert.acknowledged_at = new Date().toISOString();
    alert.acknowledged_by = supervisorName;
    alert.updated_at = new Date().toISOString();
    return alert;
  }

  public static resolve(
    alertsStore: DbAlert[],
    alertId: string,
    supervisorNotes: string = 'Resolved by supervisor'
  ): DbAlert | null {
    const alert = alertsStore.find((a) => a.id === alertId);
    if (!alert) return null;

    alert.status = 'RESOLVED';
    alert.resolved_at = new Date().toISOString();
    alert.supervisor_notes = supervisorNotes;
    alert.updated_at = new Date().toISOString();
    return alert;
  }
}
