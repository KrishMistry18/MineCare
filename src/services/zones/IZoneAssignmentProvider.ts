/**
 * MineCare - Zone Assignment Provider Interface
 *
 * Future-Compatible Abstraction:
 * Current: ZoneAssignmentProvider (Current Work Zone via check-in / supervisor assignment)
 * Future: PositionProvider (Indoor positioning / RFID beacons / reverse-telemetry)
 *
 * The UI layer consumes this interface so that future positioning capabilities
 * do not require UI rewrites.
 */

import type { MineZone, ZoneOccupancySummary } from '../../types/zone';
import type { WorkerProfile } from '../../types/worker';
import type { HelmetDevice } from '../../types/helmet';

export interface IZoneAssignmentProvider {
  /** Unique provider identifier (e.g. 'MANUAL_ZONE_ASSIGNMENT') */
  readonly providerId: string;

  /** True if this provider manages discrete zones rather than continuous coordinates */
  readonly isZoneBased: boolean;

  /** Retrieve all configured mine zones */
  getZones(): MineZone[];

  /** Retrieve zone by identifier or name */
  getZoneByName(name: string): MineZone | undefined;

  /** Retrieve all worker profiles and their active assignment states */
  getWorkers(): WorkerProfile[];

  /** Find worker profile assigned to a given helmet ID */
  getWorkerByHelmetId(helmetId: string): WorkerProfile | undefined;

  /**
   * Worker Check-In Workflow:
   * Sets currentWorkZone, records checkInTime, clears checkOutTime.
   */
  checkInWorker(helmetId: string, zoneName: string): boolean;

  /**
   * Worker Check-Out Workflow:
   * Sets currentWorkZone = null, records checkOutTime.
   */
  checkOutWorker(helmetId: string): boolean;

  /**
   * Supervisor Assignment Workflow:
   * Reassigns currentWorkZone (and optionally updates assignedZone).
   */
  assignZone(helmetId: string, newZoneName: string, updateDefaultAssignment?: boolean): boolean;

  /**
   * Calculate live zone occupancy summaries combining zone definitions with live helmet statuses
   */
  getZoneOccupancies(helmets: HelmetDevice[]): ZoneOccupancySummary[];

  /** Subscribe to zone assignment change events */
  subscribe(listener: () => void): () => void;
}
