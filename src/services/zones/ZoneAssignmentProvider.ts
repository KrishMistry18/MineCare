/**
 * MineCare - ZoneAssignmentProvider
 *
 * Current concrete implementation of IZoneAssignmentProvider.
 * Distinguishes between:
 * 1. Assigned Zone (baseline scheduled zone)
 * 2. Current Work Zone (live checked-in zone, null when checked out)
 * 3. Exact Physical Location (strictly unavailable; no GPS)
 */

import type { IZoneAssignmentProvider } from './IZoneAssignmentProvider';
import { type MineZone, type ZoneOccupancySummary, INITIAL_MINE_ZONES } from '../../types/zone';
import type { WorkerProfile } from '../../types/worker';
import type { HelmetDevice } from '../../types/helmet';
import { INITIAL_WORKERS } from '../../data/mockData';
import { workerService } from '../api/workerService';
import { DatabaseRepository } from '../../backend/db/DatabaseRepository';

export class ZoneAssignmentProvider implements IZoneAssignmentProvider {
  private static instance: ZoneAssignmentProvider | null = null;
  public readonly providerId = 'ZONE_ASSIGNMENT_PROVIDER_V1';
  public readonly isZoneBased = true;

  private zones: MineZone[] = [...INITIAL_MINE_ZONES];
  private workers: WorkerProfile[] = INITIAL_WORKERS.map(w => ({ ...w }));
  private listeners: Set<() => void> = new Set();

  private constructor() {}

  public static getInstance(): ZoneAssignmentProvider {
    if (!ZoneAssignmentProvider.instance) {
      ZoneAssignmentProvider.instance = new ZoneAssignmentProvider();
    }
    return ZoneAssignmentProvider.instance;
  }

  public getZones(): MineZone[] {
    return [...this.zones];
  }

  public getZoneByName(name: string): MineZone | undefined {
    return this.zones.find(z => z.name.toLowerCase() === name.toLowerCase());
  }

  public getWorkers(): WorkerProfile[] {
    return [...this.workers];
  }

  public getWorkerByHelmetId(helmetId: string): WorkerProfile | undefined {
    return this.workers.find(w => w.assignedHelmetId === helmetId);
  }

  public checkInWorker(helmetId: string, zoneName: string): boolean {
    const worker = this.workers.find(w => w.assignedHelmetId === helmetId);
    if (!worker) return false;

    const targetZone = this.zones.find(z => z.name === zoneName);
    if (!targetZone) return false;

    worker.currentWorkZone = targetZone.name;
    worker.zone = targetZone.name;
    worker.checkInTime = new Date().toISOString();
    worker.checkOutTime = null;

    // Persist to authoritative relational database
    try {
      DatabaseRepository.getInstance().createZoneAssignment(
        worker.workerId,
        helmetId,
        targetZone.id,
        'CHECK_IN'
      );
    } catch {
      // Fallback
    }

    // Call versioned worker API (/api/v1/workers/:id/check-in)
    workerService.checkIn(worker.workerId, targetZone.id).catch(() => {});

    this.notifyListeners();
    return true;
  }

  public checkOutWorker(helmetId: string): boolean {
    const worker = this.workers.find(w => w.assignedHelmetId === helmetId);
    if (!worker) return false;

    worker.currentWorkZone = null;
    worker.zone = 'Checked Out';
    worker.checkOutTime = new Date().toISOString();

    // Persist to authoritative relational database
    try {
      DatabaseRepository.getInstance().checkOutWorker(worker.workerId);
    } catch {
      // Fallback
    }

    // Call versioned worker API (/api/v1/workers/:id/check-out)
    workerService.checkOut(worker.workerId).catch(() => {});

    this.notifyListeners();
    return true;
  }

  public assignZone(helmetId: string, newZoneName: string, updateDefaultAssignment: boolean = false): boolean {
    const worker = this.workers.find(w => w.assignedHelmetId === helmetId);
    if (!worker) return false;

    const targetZone = this.zones.find(z => z.name === newZoneName);
    if (!targetZone) return false;

    worker.currentWorkZone = targetZone.name;
    worker.zone = targetZone.name;
    if (updateDefaultAssignment) {
      worker.assignedZone = targetZone.name;
    }
    if (!worker.checkInTime || worker.checkOutTime) {
      worker.checkInTime = new Date().toISOString();
      worker.checkOutTime = null;
    }

    // Persist to authoritative relational database
    try {
      DatabaseRepository.getInstance().createZoneAssignment(
        worker.workerId,
        helmetId,
        targetZone.id,
        'SUPERVISOR_REASSIGN'
      );
    } catch {
      // Fallback
    }

    // Call versioned worker API (/api/v1/workers/:id/zone)
    workerService.reassignZone(worker.workerId, targetZone.id, updateDefaultAssignment).catch(() => {});

    this.notifyListeners();
    return true;
  }

  public applyRealtimeAssignment(assignment: { worker_id: string; zone_id?: string; active: boolean }): void {
    const worker = this.workers.find((w) => w.workerId === assignment.worker_id);
    if (!worker) return;

    if (!assignment.active) {
      worker.currentWorkZone = null;
      worker.zone = 'Checked Out';
      worker.checkOutTime = new Date().toISOString();
    } else if (assignment.zone_id) {
      const cleanTargetId = assignment.zone_id.toLowerCase().replace(/^zone-/, '');
      const zone = this.zones.find(
        (z) =>
          z.id.toLowerCase() === assignment.zone_id?.toLowerCase() ||
          z.id.toLowerCase().replace(/^zone-/, '') === cleanTargetId ||
          z.name.toLowerCase() === assignment.zone_id?.toLowerCase() ||
          z.name.toLowerCase().includes(cleanTargetId.replace(/-/g, ' '))
      );
      if (zone) {
        worker.currentWorkZone = zone.name;
        worker.zone = zone.name;
        worker.checkInTime = new Date().toISOString();
        worker.checkOutTime = null;
      }
    }
    this.notifyListeners();
  }

  public getZoneOccupancies(helmets: HelmetDevice[]): ZoneOccupancySummary[] {
    return this.zones.map(zone => {
      // Find workers checked into this zone
      const checkedInWorkers = this.workers.filter(w => w.currentWorkZone === zone.name);
      const workerCount = checkedInWorkers.length;

      let safeCount = 0;
      let warningCount = 0;
      let dangerCount = 0;
      let offlineCount = 0;

      checkedInWorkers.forEach(w => {
        const helmet = helmets.find(h => h.helmetId === w.assignedHelmetId);
        if (!helmet || helmet.connectivity === 'OFFLINE') {
          offlineCount++;
        } else if (helmet.safety.status === 'DANGER') {
          dangerCount++;
        } else if (helmet.safety.status === 'WARNING') {
          warningCount++;
        } else {
          safeCount++;
        }
      });

      return {
        zoneId: zone.id,
        zoneName: zone.name,
        level: zone.level,
        depthMeters: zone.depthMeters,
        description: zone.description,
        status: zone.status,
        workerCount,
        helmetCount: workerCount,
        safeCount,
        warningCount,
        dangerCount,
        offlineCount,
      };
    });
  }

  public subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private notifyListeners(): void {
    this.listeners.forEach(fn => {
      try { fn(); } catch (e) { console.error('ZoneAssignmentProvider listener error', e); }
    });
  }
}
