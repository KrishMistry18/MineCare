/**
 * MineCare - Repository Layer Abstractions
 *
 * Defines clean decoupled contracts for persistent entities:
 * - Zones
 * - Workers
 * - Helmets
 * - Zone Assignments
 * - Telemetry
 * - Alerts
 * - User Profiles
 * - Audit Logs
 */

import type {
  DbMineZone,
  DbWorker,
  DbHelmet,
  DbZoneAssignment,
  DbTelemetry,
  DbAlert,
  DbUserProfile,
  DbAuditLog,
  SystemHealthStatus,
} from '../../types';

export interface IZoneRepository {
  findAll(): Promise<DbMineZone[]>;
  findByIdOrName(idOrName: string): Promise<DbMineZone | null>;
  create(zone: DbMineZone): Promise<DbMineZone>;
}

export type WorkerWithZoneDetails = DbWorker & {
  assigned_zone_name?: string;
  current_work_zone_name?: string | null;
};

export interface IWorkerRepository {
  findAll(): Promise<WorkerWithZoneDetails[]>;
  findByIdOrCode(idOrCode: string): Promise<WorkerWithZoneDetails | null>;
  update(id: string, updates: Partial<DbWorker>): Promise<DbWorker | null>;
  create(worker: DbWorker): Promise<DbWorker>;
}

export type HelmetWithDetails = DbHelmet & {
  assigned_zone_name?: string;
  current_work_zone_name?: string | null;
  worker_name?: string | null;
};

export interface IHelmetRepository {
  findAll(): Promise<HelmetWithDetails[]>;
  findRawAll(): Promise<DbHelmet[]>;
  findById(id: string): Promise<DbHelmet | null>;
  findByIdWithDetails(id: string): Promise<HelmetWithDetails | null>;
  update(id: string, updates: Partial<DbHelmet>): Promise<DbHelmet | null>;
}

export interface IZoneAssignmentRepository {
  findActiveByWorkerId(workerId: string): Promise<DbZoneAssignment | null>;
  findHistory(workerId?: string): Promise<DbZoneAssignment[]>;
  findByRange(filter: {
    from: string;
    to: string;
    workerId?: string;
    zoneId?: string;
  }): Promise<DbZoneAssignment[]>;
  create(
    workerId: string,
    helmetId: string,
    zoneId: string,
    assignmentType?: 'CHECK_IN' | 'SUPERVISOR_REASSIGN'
  ): Promise<DbZoneAssignment>;
  checkOutWorker(workerId: string): Promise<boolean>;
}

export interface ITelemetryRepository {
  save(telemetry: DbTelemetry): Promise<void>;
  findLatestByHelmetId(helmetId: string): Promise<DbTelemetry | null>;
  findHistoryByHelmetId(helmetId: string, limit?: number): Promise<DbTelemetry[]>;
  findByRange(filter: {
    from: string;
    to: string;
    helmetId?: string;
    helmetIds?: string[];
  }): Promise<DbTelemetry[]>;
}

export interface IAlertRepository {
  findAll(filter?: { status?: string; severity?: string; helmetId?: string }): Promise<DbAlert[]>;
  findActive(): Promise<DbAlert[]>;
  findHistory(): Promise<DbAlert[]>;
  findByRange(filter: {
    from: string;
    to: string;
    helmetId?: string;
    workerId?: string;
    zoneId?: string;
  }): Promise<DbAlert[]>;
  create(alert: DbAlert): Promise<DbAlert>;
  update(id: string, updates: Partial<DbAlert>): Promise<DbAlert | null>;
  acknowledge(id: string, supervisorName: string): Promise<DbAlert | null>;
  resolve(id: string, notes: string): Promise<DbAlert | null>;
  resolveActiveOfflineAlert(helmetId: string): Promise<DbAlert | null>;
}

export interface IProfileRepository {
  findAll(): Promise<DbUserProfile[]>;
  findById(id: string): Promise<DbUserProfile | null>;
  findByEmail(email: string): Promise<DbUserProfile | null>;
  findByAuthUserId(authUserId: string): Promise<DbUserProfile | null>;
  create(profile: DbUserProfile): Promise<DbUserProfile>;
  update(id: string, updates: Partial<DbUserProfile>): Promise<DbUserProfile | null>;
}

export interface IAuditRepository {
  log(entry: Omit<DbAuditLog, 'id' | 'created_at'>): Promise<DbAuditLog>;
  findAll(limit?: number): Promise<DbAuditLog[]>;
}

export interface IDatabaseRepository {
  // Convenience composite methods matching service needs
  getZones(): Promise<DbMineZone[]>;
  getZone(idOrName: string): Promise<DbMineZone | null>;

  getWorkers(): Promise<WorkerWithZoneDetails[]>;
  getWorker(idOrCode: string): Promise<WorkerWithZoneDetails | null>;
  updateWorker(id: string, updates: Partial<DbWorker>): Promise<DbWorker | null>;

  getHelmets(): Promise<HelmetWithDetails[]>;
  getRawHelmets(): Promise<DbHelmet[]>;
  getHelmet(id: string): Promise<DbHelmet | null>;
  getHelmetWithDetails(id: string): Promise<HelmetWithDetails | null>;
  updateHelmet(id: string, updates: Partial<DbHelmet>): Promise<DbHelmet | null>;

  getActiveZoneAssignment(workerId: string): Promise<DbZoneAssignment | null>;
  getZoneAssignmentsHistory(workerId?: string): Promise<DbZoneAssignment[]>;
  getZoneAssignmentsByRange(filter: {
    from: string;
    to: string;
    workerId?: string;
    zoneId?: string;
  }): Promise<DbZoneAssignment[]>;
  createZoneAssignment(
    workerId: string,
    helmetId: string,
    zoneId: string,
    assignmentType?: 'CHECK_IN' | 'SUPERVISOR_REASSIGN'
  ): Promise<DbZoneAssignment>;
  checkOutWorker(workerId: string): Promise<boolean>;

  saveTelemetry(telemetry: DbTelemetry): Promise<void>;
  getLatestTelemetry(helmetId: string): Promise<DbTelemetry | null>;
  getTelemetryHistory(helmetId: string, limit?: number): Promise<DbTelemetry[]>;
  getTelemetryByRange(filter: {
    from: string;
    to: string;
    helmetId?: string;
    helmetIds?: string[];
  }): Promise<DbTelemetry[]>;

  getAlerts(filter?: { status?: string; severity?: string; helmetId?: string }): Promise<DbAlert[]>;
  getAlertsStore(): Promise<DbAlert[]>;
  getActiveAlerts(): Promise<DbAlert[]>;
  getAlertHistory(): Promise<DbAlert[]>;
  getAlertsHistory(): Promise<DbAlert[]>;
  getAlertsByRange(filter: {
    from: string;
    to: string;
    helmetId?: string;
    workerId?: string;
    zoneId?: string;
  }): Promise<DbAlert[]>;
  saveAlert(alert: DbAlert): Promise<DbAlert>;
  acknowledgeAlert(id: string, supervisorName: string): Promise<DbAlert | null>;
  resolveAlert(id: string, notes: string): Promise<DbAlert | null>;

  getAllProfiles(): Promise<DbUserProfile[]>;
  getProfiles(): Promise<DbUserProfile[]>;
  getProfile(id: string): Promise<DbUserProfile | null>;
  getProfileById(id: string): Promise<DbUserProfile | null>;
  getProfileByEmail(email: string): Promise<DbUserProfile | null>;
  getProfileByAuthId(authId: string): Promise<DbUserProfile | null>;
  createProfile(profile: DbUserProfile): Promise<DbUserProfile>;
  updateProfile(id: string, updates: Partial<DbUserProfile>): Promise<DbUserProfile | null>;

  logAuditAction(entry: Omit<DbAuditLog, 'id' | 'created_at'>): Promise<DbAuditLog>;
  getAuditLogs(limit?: number): Promise<DbAuditLog[]>;

  getSystemHealth(): Promise<SystemHealthStatus>;
  ping?(): Promise<boolean>;
}
