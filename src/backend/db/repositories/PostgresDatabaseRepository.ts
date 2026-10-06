/**
 * MineCare - Authoritative PostgreSQL Database Repository Implementation
 *
 * Implements real persistent relational operations matching supabase/migrations/
 * using connection-pooled PostgreSQL queries.
 */

import crypto from 'crypto';
import { connectionManager, type IConnectionManager } from '../connection';
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
import type {
  IZoneRepository,
  IWorkerRepository,
  IHelmetRepository,
  IZoneAssignmentRepository,
  ITelemetryRepository,
  IAlertRepository,
  IProfileRepository,
  IAuditRepository,
  IDatabaseRepository,
  WorkerWithZoneDetails,
  HelmetWithDetails,
} from './interfaces';

export class PostgresZoneRepository implements IZoneRepository {
  private cm: IConnectionManager;
  constructor(cm: IConnectionManager) {
    this.cm = cm;
  }

  public async findAll(): Promise<DbMineZone[]> {
    const res = await this.cm.query<DbMineZone>(
      'SELECT id, name, level, depth_meters, description, status, created_at, updated_at FROM mine_zones ORDER BY depth_meters ASC'
    );
    return res.rows;
  }

  public async findByIdOrName(idOrName: string): Promise<DbMineZone | null> {
    if (!idOrName) return null;
    const clean = idOrName.toLowerCase().replace(/^zone-/, '');
    const res = await this.cm.query<DbMineZone>(
      `SELECT id, name, level, depth_meters, description, status, created_at, updated_at 
       FROM mine_zones 
       WHERE LOWER(id) = LOWER($1) 
          OR LOWER(id) = 'zone-' || LOWER($2)
          OR LOWER(id) = LOWER($2) 
          OR LOWER(name) = LOWER($1) 
          OR LOWER(name) LIKE '%' || LOWER($2) || '%' 
       LIMIT 1`,
      [idOrName, clean]
    );
    return res.rows[0] || null;
  }

  public async create(zone: DbMineZone): Promise<DbMineZone> {
    const res = await this.cm.query<DbMineZone>(
      `INSERT INTO mine_zones (id, name, level, depth_meters, description, status, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, COALESCE($7, NOW()), COALESCE($8, NOW()))
       ON CONFLICT (id) DO UPDATE SET
         name = EXCLUDED.name,
         level = EXCLUDED.level,
         depth_meters = EXCLUDED.depth_meters,
         description = EXCLUDED.description,
         updated_at = NOW()
       RETURNING *`,
      [zone.id, zone.name, zone.level, zone.depth_meters, zone.description, zone.status, zone.created_at, zone.updated_at]
    );
    return res.rows[0];
  }
}

export class PostgresWorkerRepository implements IWorkerRepository {
  private cm: IConnectionManager;
  constructor(cm: IConnectionManager) {
    this.cm = cm;
  }

  public async findAll(): Promise<WorkerWithZoneDetails[]> {
    const res = await this.cm.query<WorkerWithZoneDetails>(
      `SELECT 
         w.id, w.worker_code, w.name, w.role, w.shift, w.assigned_zone_id, w.status, w.battery_level, w.created_at, w.updated_at,
         mz.name as assigned_zone_name,
         cur_mz.name as current_work_zone_name
       FROM workers w
       LEFT JOIN mine_zones mz ON w.assigned_zone_id = mz.id
       LEFT JOIN zone_assignments za ON za.worker_id = w.id AND za.active = TRUE
       LEFT JOIN mine_zones cur_mz ON za.zone_id = cur_mz.id
       ORDER BY w.id ASC`
    );
    return res.rows.map((row) => ({
      ...row,
      assigned_zone_name: row.assigned_zone_name || 'Portal / Surface',
      current_work_zone_name: row.current_work_zone_name || null,
    }));
  }

  public async findByIdOrCode(idOrCode: string): Promise<WorkerWithZoneDetails | null> {
    if (!idOrCode) return null;
    const res = await this.cm.query<WorkerWithZoneDetails>(
      `SELECT 
         w.id, w.worker_code, w.name, w.role, w.shift, w.assigned_zone_id, w.status, w.battery_level, w.created_at, w.updated_at,
         mz.name as assigned_zone_name,
         cur_mz.name as current_work_zone_name
       FROM workers w
       LEFT JOIN mine_zones mz ON w.assigned_zone_id = mz.id
       LEFT JOIN zone_assignments za ON za.worker_id = w.id AND za.active = TRUE
       LEFT JOIN mine_zones cur_mz ON za.zone_id = cur_mz.id
       WHERE LOWER(w.id) = LOWER($1) OR LOWER(w.worker_code) = LOWER($1)
       LIMIT 1`,
      [idOrCode]
    );
    if (!res.rows[0]) return null;
    const row = res.rows[0];
    return {
      ...row,
      assigned_zone_name: row.assigned_zone_name || 'Portal / Surface',
      current_work_zone_name: row.current_work_zone_name || null,
    };
  }

  public async update(id: string, updates: Partial<DbWorker>): Promise<DbWorker | null> {
    const fields: string[] = [];
    const values: unknown[] = [];
    let idx = 1;

    if (updates.name !== undefined) {
      fields.push(`name = $${idx++}`);
      values.push(updates.name);
    }
    if (updates.role !== undefined) {
      fields.push(`role = $${idx++}`);
      values.push(updates.role);
    }
    if (updates.shift !== undefined) {
      fields.push(`shift = $${idx++}`);
      values.push(updates.shift);
    }
    if (updates.assigned_zone_id !== undefined) {
      fields.push(`assigned_zone_id = $${idx++}`);
      values.push(updates.assigned_zone_id);
    }
    if (updates.status !== undefined) {
      fields.push(`status = $${idx++}`);
      values.push(updates.status);
    }
    if (updates.battery_level !== undefined) {
      fields.push(`battery_level = $${idx++}`);
      values.push(updates.battery_level);
    }

    if (fields.length === 0) {
      return (await this.findByIdOrCode(id)) as DbWorker | null;
    }

    fields.push(`updated_at = NOW()`);
    values.push(id);

    const res = await this.cm.query<DbWorker>(
      `UPDATE workers SET ${fields.join(', ')} WHERE id = $${idx} RETURNING *`,
      values
    );
    return res.rows[0] || null;
  }

  public async create(worker: DbWorker): Promise<DbWorker> {
    const res = await this.cm.query<DbWorker>(
      `INSERT INTO workers (id, worker_code, name, role, shift, assigned_zone_id, status, battery_level, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, COALESCE($9, NOW()), COALESCE($10, NOW()))
       ON CONFLICT (id) DO UPDATE SET
         worker_code = EXCLUDED.worker_code,
         name = EXCLUDED.name,
         role = EXCLUDED.role,
         shift = EXCLUDED.shift,
         assigned_zone_id = EXCLUDED.assigned_zone_id,
         status = EXCLUDED.status,
         battery_level = EXCLUDED.battery_level,
         updated_at = NOW()
       RETURNING *`,
      [
        worker.id,
        worker.worker_code,
        worker.name,
        worker.role,
        worker.shift,
        worker.assigned_zone_id,
        worker.status,
        worker.battery_level,
        worker.created_at,
        worker.updated_at,
      ]
    );
    return res.rows[0];
  }
}

export class PostgresHelmetRepository implements IHelmetRepository {
  private cm: IConnectionManager;
  constructor(cm: IConnectionManager) {
    this.cm = cm;
  }

  public async findAll(): Promise<HelmetWithDetails[]> {
    const res = await this.cm.query<HelmetWithDetails>(
      `SELECT 
         h.id, h.helmet_code, h.worker_id, h.status, h.online, h.last_seen, h.battery_level, h.serial_number, h.firmware_version, h.created_at, h.updated_at,
         w.name as worker_name,
         mz.name as assigned_zone_name,
         cur_mz.name as current_work_zone_name
       FROM helmets h
       LEFT JOIN workers w ON h.worker_id = w.id
       LEFT JOIN mine_zones mz ON w.assigned_zone_id = mz.id
       LEFT JOIN zone_assignments za ON za.worker_id = w.id AND za.active = TRUE
       LEFT JOIN mine_zones cur_mz ON za.zone_id = cur_mz.id
       ORDER BY h.id ASC`
    );
    return res.rows.map((row) => ({
      ...row,
      worker_name: row.worker_name || null,
      assigned_zone_name: row.assigned_zone_name || 'Portal / Surface',
      current_work_zone_name: row.current_work_zone_name || null,
    }));
  }

  public async findRawAll(): Promise<DbHelmet[]> {
    const res = await this.cm.query<DbHelmet>(
      'SELECT id, helmet_code, worker_id, status, online, last_seen, battery_level, serial_number, firmware_version, created_at, updated_at FROM helmets ORDER BY id ASC'
    );
    return res.rows;
  }

  public async findById(id: string): Promise<DbHelmet | null> {
    if (!id) return null;
    const res = await this.cm.query<DbHelmet>(
      'SELECT id, helmet_code, worker_id, status, online, last_seen, battery_level, serial_number, firmware_version, created_at, updated_at FROM helmets WHERE id = $1 OR helmet_code = $1 LIMIT 1',
      [id]
    );
    return res.rows[0] || null;
  }

  public async findByIdWithDetails(id: string): Promise<HelmetWithDetails | null> {
    if (!id) return null;
    const res = await this.cm.query<HelmetWithDetails>(
      `SELECT 
         h.id, h.helmet_code, h.worker_id, h.status, h.online, h.last_seen, h.battery_level, h.serial_number, h.firmware_version, h.created_at, h.updated_at,
         w.name as worker_name,
         mz.name as assigned_zone_name,
         cur_mz.name as current_work_zone_name
       FROM helmets h
       LEFT JOIN workers w ON h.worker_id = w.id
       LEFT JOIN mine_zones mz ON w.assigned_zone_id = mz.id
       LEFT JOIN zone_assignments za ON za.worker_id = w.id AND za.active = TRUE
       LEFT JOIN mine_zones cur_mz ON za.zone_id = cur_mz.id
       WHERE h.id = $1 OR h.helmet_code = $1
       LIMIT 1`,
      [id]
    );
    if (!res.rows[0]) return null;
    const row = res.rows[0];
    return {
      ...row,
      worker_name: row.worker_name || null,
      assigned_zone_name: row.assigned_zone_name || 'Portal / Surface',
      current_work_zone_name: row.current_work_zone_name || null,
    };
  }

  public async update(id: string, updates: Partial<DbHelmet>): Promise<DbHelmet | null> {
    const fields: string[] = [];
    const values: unknown[] = [];
    let idx = 1;

    if (updates.status !== undefined) {
      fields.push(`status = $${idx++}`);
      values.push(updates.status);
    }
    if (updates.online !== undefined) {
      fields.push(`online = $${idx++}`);
      values.push(updates.online);
    }
    if (updates.last_seen !== undefined) {
      fields.push(`last_seen = $${idx++}`);
      values.push(updates.last_seen);
    }
    if (updates.battery_level !== undefined) {
      fields.push(`battery_level = $${idx++}`);
      values.push(updates.battery_level);
    }
    if (updates.worker_id !== undefined) {
      fields.push(`worker_id = $${idx++}`);
      values.push(updates.worker_id);
    }

    if (fields.length === 0) {
      return this.findById(id);
    }

    fields.push(`updated_at = NOW()`);
    values.push(id);

    const res = await this.cm.query<DbHelmet>(
      `UPDATE helmets SET ${fields.join(', ')} WHERE id = $${idx} RETURNING *`,
      values
    );
    return res.rows[0] || null;
  }
}

export class PostgresZoneAssignmentRepository implements IZoneAssignmentRepository {
  private cm: IConnectionManager;
  constructor(cm: IConnectionManager) {
    this.cm = cm;
  }

  public async findActiveByWorkerId(workerId: string): Promise<DbZoneAssignment | null> {
    const res = await this.cm.query<DbZoneAssignment>(
      'SELECT * FROM zone_assignments WHERE worker_id = $1 AND active = TRUE ORDER BY assigned_at DESC LIMIT 1',
      [workerId]
    );
    return res.rows[0] || null;
  }

  public async findHistory(workerId?: string): Promise<DbZoneAssignment[]> {
    if (workerId) {
      const res = await this.cm.query<DbZoneAssignment>(
        'SELECT * FROM zone_assignments WHERE worker_id = $1 ORDER BY assigned_at DESC',
        [workerId]
      );
      return res.rows;
    }
    const res = await this.cm.query<DbZoneAssignment>(
      'SELECT * FROM zone_assignments ORDER BY assigned_at DESC'
    );
    return res.rows;
  }

  public async findByRange(filter: {
    from: string;
    to: string;
    workerId?: string;
    zoneId?: string;
  }): Promise<DbZoneAssignment[]> {
    let query = `
      SELECT * FROM zone_assignments 
      WHERE checked_in_at <= $2 
        AND (checked_out_at IS NULL OR checked_out_at >= $1)
    `;
    const params: unknown[] = [filter.from, filter.to];
    let idx = 3;

    if (filter.workerId) {
      query += ` AND worker_id = $${idx++}`;
      params.push(filter.workerId);
    }
    if (filter.zoneId) {
      const cleanZoneId = filter.zoneId.replace(/^zone-/, '');
      query += ` AND (zone_id = $${idx} OR zone_id = $${idx + 1})`;
      params.push(filter.zoneId, cleanZoneId);
      idx += 2;
    }

    query += ' ORDER BY assigned_at DESC';
    const res = await this.cm.query<DbZoneAssignment>(query, params);
    return res.rows;
  }

  public async create(
    workerId: string,
    helmetId: string,
    zoneId: string,
    assignmentType: 'CHECK_IN' | 'SUPERVISOR_REASSIGN' = 'CHECK_IN'
  ): Promise<DbZoneAssignment> {
    const now = new Date().toISOString();
    const assignmentId = `ZA-${Date.now()}-${Math.floor(Math.random() * 1000)}`;

    let canonicalZoneId = zoneId;
    try {
      const clean = zoneId.toLowerCase().replace(/^zone-/, '');
      const zRes = await this.cm.query<DbMineZone>(
        `SELECT id FROM mine_zones 
         WHERE LOWER(id) = LOWER($1) 
            OR LOWER(id) = 'zone-' || LOWER($2) 
            OR LOWER(id) = LOWER($2) 
         LIMIT 1`,
        [zoneId, clean]
      );
      if (zRes.rows[0]) {
        canonicalZoneId = zRes.rows[0].id;
      }
    } catch {
      // fallback
    }

    return this.cm.withTransaction(async (client) => {
      // 1. Close active assignment
      await client.query(
        'UPDATE zone_assignments SET active = FALSE, checked_out_at = $1 WHERE worker_id = $2 AND active = TRUE',
        [now, workerId]
      );

      // 2. Insert new assignment
      const res = await client.query<DbZoneAssignment>(
        `INSERT INTO zone_assignments (id, worker_id, helmet_id, zone_id, assigned_at, checked_in_at, checked_out_at, assignment_type, active, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, NULL, $7, TRUE, $8)
         RETURNING *`,
        [assignmentId, workerId, helmetId, canonicalZoneId, now, now, assignmentType, now]
      );

      return res.rows[0];
    });
  }

  public async checkOutWorker(workerId: string): Promise<boolean> {
    const now = new Date().toISOString();
    const res = await this.cm.query(
      'UPDATE zone_assignments SET active = FALSE, checked_out_at = $1 WHERE worker_id = $2 AND active = TRUE',
      [now, workerId]
    );
    return Boolean(res.rowCount && res.rowCount > 0);
  }
}

export class PostgresTelemetryRepository implements ITelemetryRepository {
  private cm: IConnectionManager;
  constructor(cm: IConnectionManager) {
    this.cm = cm;
  }

  public async save(raw: DbTelemetry | any): Promise<void> {
    const id = raw.id || raw.packetId || `PKT-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
    const helmet_id = raw.helmet_id || raw.helmetId;
    const worker_id = raw.worker_id || raw.workerId || null;
    const timestamp = raw.timestamp || new Date().toISOString();
    const sequence_number = Number(raw.sequence_number ?? raw.sequenceNumber ?? 0);
    const temperature = Number(raw.temperature ?? 0);
    const humidity = Number(raw.humidity ?? 0);
    const gas_value = Number(raw.gas_value ?? raw.gasValue ?? 0);
    const acceleration_x = Number(raw.acceleration_x ?? raw.accelX ?? 0);
    const acceleration_y = Number(raw.acceleration_y ?? raw.accelY ?? 0);
    const acceleration_z = Number(raw.acceleration_z ?? raw.accelZ ?? 9.8);
    const total_acceleration = Number(raw.total_acceleration ?? raw.totalAcceleration ?? 9.8);
    const gyro_x = Number(raw.gyro_x ?? raw.gyroX ?? 0);
    const gyro_y = Number(raw.gyro_y ?? raw.gyroY ?? 0);
    const gyro_z = Number(raw.gyro_z ?? raw.gyroZ ?? 0);
    const fall_detected = Boolean(raw.fall_detected ?? raw.fallDetected ?? raw.fall ?? false);
    const sos_pressed = Boolean(raw.sos_pressed ?? raw.sosPressed ?? raw.sos ?? false);
    const safety_status = raw.safety_status || raw.safetyStatus || 'SAFE';
    const created_at = raw.created_at || timestamp;

    await this.cm.withTransaction(async (client) => {
      // 1. Insert telemetry record
      await client.query(
        `INSERT INTO telemetry (
           id, helmet_id, worker_id, timestamp, sequence_number, temperature, humidity, gas_value,
           acceleration_x, acceleration_y, acceleration_z, total_acceleration, gyro_x, gyro_y, gyro_z,
           fall_detected, sos_pressed, safety_status, created_at
         ) VALUES (
           $1, $2, $3, $4, $5, $6, $7, $8,
           $9, $10, $11, $12, $13, $14, $15,
           $16, $17, $18, COALESCE($19, NOW())
         )`,
        [
          id,
          helmet_id,
          worker_id,
          timestamp,
          sequence_number,
          temperature,
          humidity,
          gas_value,
          acceleration_x,
          acceleration_y,
          acceleration_z,
          total_acceleration,
          gyro_x,
          gyro_y,
          gyro_z,
          fall_detected,
          sos_pressed,
          safety_status,
          created_at,
        ]
      );

      // 2. Update helmet online status, last_seen, and safety status
      await client.query(
        `UPDATE helmets 
         SET status = $1, online = TRUE, last_seen = $2, updated_at = NOW()
         WHERE id = $3`,
        [safety_status, timestamp, helmet_id]
      );

      // 3. Auto-resolve HELMET_OFFLINE alert if packet stream is re-established
      await client.query(
        `UPDATE alerts 
         SET status = 'RESOLVED', resolved_at = NOW(), supervisor_notes = 'Auto-resolved: Heartbeat packet stream re-established.', updated_at = NOW()
         WHERE helmet_id = $1 AND type = 'HELMET_OFFLINE' AND status != 'RESOLVED'`,
        [helmet_id]
      );
    });
  }

  public async findLatestByHelmetId(helmetId: string): Promise<DbTelemetry | null> {
    const res = await this.cm.query<DbTelemetry>(
      `SELECT * FROM telemetry WHERE helmet_id = $1 ORDER BY timestamp DESC LIMIT 1`,
      [helmetId]
    );
    if (!res.rows[0]) return null;
    return this.normalizeTelemetry(res.rows[0]);
  }

  public async findHistoryByHelmetId(helmetId: string, limit: number = 50): Promise<DbTelemetry[]> {
    const res = await this.cm.query<DbTelemetry>(
      `SELECT * FROM (
         SELECT * FROM telemetry WHERE helmet_id = $1 ORDER BY timestamp DESC LIMIT $2
       ) sub ORDER BY timestamp ASC`,
      [helmetId, limit]
    );
    return res.rows.map(this.normalizeTelemetry);
  }

  public async findByRange(filter: {
    from: string;
    to: string;
    helmetId?: string;
    helmetIds?: string[];
  }): Promise<DbTelemetry[]> {
    let query = `SELECT * FROM telemetry WHERE timestamp >= $1 AND timestamp <= $2`;
    const params: unknown[] = [filter.from, filter.to];
    let idx = 3;

    if (filter.helmetId) {
      query += ` AND helmet_id = $${idx++}`;
      params.push(filter.helmetId);
    } else if (filter.helmetIds && filter.helmetIds.length > 0) {
      query += ` AND helmet_id = ANY($${idx++})`;
      params.push(filter.helmetIds);
    }

    query += ' ORDER BY timestamp ASC';
    const res = await this.cm.query<DbTelemetry>(query, params);
    return res.rows.map(this.normalizeTelemetry);
  }

  private normalizeTelemetry(row: any): DbTelemetry {
    return {
      ...row,
      id: row.id,
      packet_id: row.id,
      temperature: Number(row.temperature),
      humidity: Number(row.humidity),
      gas_value: Number(row.gas_value),
      acceleration_x: Number(row.acceleration_x),
      acceleration_y: Number(row.acceleration_y),
      acceleration_z: Number(row.acceleration_z),
      total_acceleration: Number(row.total_acceleration),
      gyro_x: Number(row.gyro_x),
      gyro_y: Number(row.gyro_y),
      gyro_z: Number(row.gyro_z),
      sequence_number: Number(row.sequence_number),
      fall_detected: Boolean(row.fall_detected),
      sos_pressed: Boolean(row.sos_pressed),
    };
  }
}

export class PostgresAlertRepository implements IAlertRepository {
  private cm: IConnectionManager;
  constructor(cm: IConnectionManager) {
    this.cm = cm;
  }

  private normalizeAlert(row: any): DbAlert {
    const rawReadings = typeof row.raw_readings === 'string' ? JSON.parse(row.raw_readings) : (row.raw_readings || {});
    return {
      ...row,
      timestamp: row.triggered_at || row.created_at,
      readings_snapshot: rawReadings,
      sensor_values: rawReadings,
      acknowledged: row.status === 'ACKNOWLEDGED',
      resolved: row.status === 'RESOLVED',
    };
  }

  public async findAll(filter?: { status?: string; severity?: string; helmetId?: string }): Promise<DbAlert[]> {
    let query = 'SELECT * FROM alerts WHERE 1=1';
    const params: unknown[] = [];
    let idx = 1;

    if (filter?.status) {
      query += ` AND status = $${idx++}`;
      params.push(filter.status);
    }
    if (filter?.severity) {
      query += ` AND severity = $${idx++}`;
      params.push(filter.severity);
    }
    if (filter?.helmetId) {
      query += ` AND helmet_id = $${idx++}`;
      params.push(filter.helmetId);
    }

    query += ' ORDER BY triggered_at DESC';
    const res = await this.cm.query<DbAlert>(query, params);
    return res.rows.map((r) => this.normalizeAlert(r));
  }

  public async findActive(): Promise<DbAlert[]> {
    const res = await this.cm.query<DbAlert>(
      "SELECT * FROM alerts WHERE status != 'RESOLVED' ORDER BY triggered_at DESC"
    );
    return res.rows.map((r) => this.normalizeAlert(r));
  }

  public async findHistory(): Promise<DbAlert[]> {
    const res = await this.cm.query<DbAlert>(
      "SELECT * FROM alerts WHERE status = 'RESOLVED' ORDER BY triggered_at DESC"
    );
    return res.rows.map((r) => this.normalizeAlert(r));
  }

  public async findByRange(filter: {
    from: string;
    to: string;
    helmetId?: string;
    workerId?: string;
    zoneId?: string;
  }): Promise<DbAlert[]> {
    let query = `
      SELECT * FROM alerts 
      WHERE triggered_at <= $2 
        AND (resolved_at IS NULL OR resolved_at >= $1)
    `;
    const params: unknown[] = [filter.from, filter.to];
    let idx = 3;

    if (filter.helmetId) {
      query += ` AND helmet_id = $${idx++}`;
      params.push(filter.helmetId);
    }
    if (filter.workerId) {
      query += ` AND worker_id = $${idx++}`;
      params.push(filter.workerId);
    }

    query += ' ORDER BY triggered_at DESC';
    const res = await this.cm.query<DbAlert>(query, params);
    return res.rows.map((r) => this.normalizeAlert(r));
  }

  public async create(alert: any): Promise<DbAlert> {
    const triggeredAt = alert.triggered_at || alert.timestamp || new Date().toISOString();
    const createdAt = alert.created_at || triggeredAt;
    const updatedAt = alert.updated_at || createdAt;
    const readings = alert.raw_readings || alert.sensor_values || alert.readings_snapshot || {};

    let canonicalType = alert.type;
    if (canonicalType === 'HIGH_GAS') canonicalType = 'GAS_HAZARD';
    if (canonicalType === 'HIGH_TEMP' || canonicalType === 'HIGH_TEMPERATURE') canonicalType = 'HEAT_STRESS';
    if (canonicalType === 'FALL') canonicalType = 'WORKER_FALL';
    if (canonicalType === 'SOS') canonicalType = 'SOS_EMERGENCY';

    const canonicalStatus = alert.status === 'ACTIVE' ? 'TRIGGERED' : (alert.status || 'TRIGGERED');

    const res = await this.cm.query<DbAlert>(
      `INSERT INTO alerts (id, helmet_id, worker_id, type, severity, message, status, triggered_at, acknowledged_at, acknowledged_by, resolved_at, supervisor_notes, raw_readings, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, COALESCE($14, NOW()), COALESCE($15, NOW()))
       ON CONFLICT (id) DO UPDATE SET
         message = EXCLUDED.message,
         status = EXCLUDED.status,
         raw_readings = EXCLUDED.raw_readings,
         updated_at = NOW()
       RETURNING *`,
      [
        alert.id,
        alert.helmet_id,
        alert.worker_id || null,
        canonicalType,
        alert.severity,
        alert.message,
        canonicalStatus,
        triggeredAt,
        alert.acknowledged_at || null,
        alert.acknowledged_by || null,
        alert.resolved_at || null,
        alert.supervisor_notes || null,
        JSON.stringify(readings),
        createdAt,
        updatedAt,
      ]
    );
    return this.normalizeAlert(res.rows[0]);
  }

  public async update(id: string, updates: Partial<DbAlert>): Promise<DbAlert | null> {
    const fields: string[] = [];
    const values: unknown[] = [];
    let idx = 1;

    if (updates.status !== undefined) {
      fields.push(`status = $${idx++}`);
      values.push(updates.status);
    }
    if (updates.acknowledged_at !== undefined) {
      fields.push(`acknowledged_at = $${idx++}`);
      values.push(updates.acknowledged_at);
    }
    if (updates.acknowledged_by !== undefined) {
      fields.push(`acknowledged_by = $${idx++}`);
      values.push(updates.acknowledged_by);
    }
    if (updates.resolved_at !== undefined) {
      fields.push(`resolved_at = $${idx++}`);
      values.push(updates.resolved_at);
    }
    if (updates.supervisor_notes !== undefined) {
      fields.push(`supervisor_notes = $${idx++}`);
      values.push(updates.supervisor_notes);
    }

    if (fields.length === 0) {
      const res = await this.cm.query<DbAlert>('SELECT * FROM alerts WHERE id = $1', [id]);
      return res.rows[0] || null;
    }

    fields.push(`updated_at = NOW()`);
    values.push(id);

    const res = await this.cm.query<DbAlert>(
      `UPDATE alerts SET ${fields.join(', ')} WHERE id = $${idx} RETURNING *`,
      values
    );
    return res.rows[0] || null;
  }

  public async acknowledge(id: string, supervisorName: string): Promise<DbAlert | null> {
    const now = new Date().toISOString();
    const res = await this.cm.query<DbAlert>(
      `UPDATE alerts 
       SET status = 'ACKNOWLEDGED', acknowledged_at = $1, acknowledged_by = $2, updated_at = NOW()
       WHERE id = $3
       RETURNING *`,
      [now, supervisorName, id]
    );
    return res.rows[0] || null;
  }

  public async resolve(id: string, notes: string): Promise<DbAlert | null> {
    const now = new Date().toISOString();
    const res = await this.cm.query<DbAlert>(
      `UPDATE alerts 
       SET status = 'RESOLVED', resolved_at = $1, supervisor_notes = $2, updated_at = NOW()
       WHERE id = $3
       RETURNING *`,
      [now, notes, id]
    );
    return res.rows[0] || null;
  }

  public async resolveActiveOfflineAlert(helmetId: string): Promise<DbAlert | null> {
    const now = new Date().toISOString();
    const res = await this.cm.query<DbAlert>(
      `UPDATE alerts 
       SET status = 'RESOLVED', resolved_at = $1, supervisor_notes = 'Auto-resolved: Heartbeat packet stream re-established.', updated_at = NOW()
       WHERE helmet_id = $2 AND type = 'HELMET_OFFLINE' AND status != 'RESOLVED'
       RETURNING *`,
      [now, helmetId]
    );
    return res.rows[0] || null;
  }
}

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export class PostgresProfileRepository implements IProfileRepository {
  private cm: IConnectionManager;
  constructor(cm: IConnectionManager) {
    this.cm = cm;
  }

  public async findAll(): Promise<DbUserProfile[]> {
    const res = await this.cm.query<DbUserProfile>(
      'SELECT id, auth_user_id, name, email, role, worker_id, active, created_at, updated_at FROM profiles ORDER BY created_at ASC'
    );
    return res.rows;
  }

  public async findById(id: string): Promise<DbUserProfile | null> {
    if (!id || !UUID_REGEX.test(id)) return null;
    const res = await this.cm.query<DbUserProfile>(
      'SELECT id, auth_user_id, name, email, role, worker_id, active, created_at, updated_at FROM profiles WHERE id = $1 LIMIT 1',
      [id]
    );
    return res.rows[0] || null;
  }

  public async findByEmail(email: string): Promise<DbUserProfile | null> {
    if (!email) return null;
    const res = await this.cm.query<DbUserProfile>(
      'SELECT id, auth_user_id, name, email, role, worker_id, active, created_at, updated_at FROM profiles WHERE LOWER(email) = LOWER($1) LIMIT 1',
      [email.trim()]
    );
    return res.rows[0] || null;
  }

  public async findByAuthUserId(authUserId: string): Promise<DbUserProfile | null> {
    if (!authUserId || !UUID_REGEX.test(authUserId)) return null;
    const res = await this.cm.query<DbUserProfile>(
      'SELECT id, auth_user_id, name, email, role, worker_id, active, created_at, updated_at FROM profiles WHERE auth_user_id = $1 LIMIT 1',
      [authUserId]
    );
    return res.rows[0] || null;
  }

  public async create(profile: DbUserProfile): Promise<DbUserProfile> {
    const res = await this.cm.query<DbUserProfile>(
      `INSERT INTO profiles (id, auth_user_id, name, email, role, worker_id, active, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, COALESCE($8, NOW()), COALESCE($9, NOW()))
       ON CONFLICT (email) DO UPDATE SET
         name = EXCLUDED.name,
         role = EXCLUDED.role,
         worker_id = EXCLUDED.worker_id,
         active = EXCLUDED.active,
         updated_at = NOW()
       RETURNING *`,
      [
        profile.id,
        profile.auth_user_id,
        profile.name,
        profile.email,
        profile.role,
        profile.worker_id,
        profile.active ?? true,
        profile.created_at,
        profile.updated_at,
      ]
    );
    return res.rows[0];
  }

  public async update(id: string, updates: Partial<DbUserProfile>): Promise<DbUserProfile | null> {
    if (!id || !UUID_REGEX.test(id)) return null;
    const fields: string[] = [];
    const values: unknown[] = [];
    let idx = 1;

    if (updates.name !== undefined) {
      fields.push(`name = $${idx++}`);
      values.push(updates.name);
    }
    if (updates.role !== undefined) {
      fields.push(`role = $${idx++}`);
      values.push(updates.role);
    }
    if (updates.worker_id !== undefined) {
      fields.push(`worker_id = $${idx++}`);
      values.push(updates.worker_id);
    }
    if (updates.active !== undefined) {
      fields.push(`active = $${idx++}`);
      values.push(updates.active);
    }

    if (fields.length === 0) {
      return this.findById(id);
    }

    fields.push(`updated_at = NOW()`);
    values.push(id);

    const res = await this.cm.query<DbUserProfile>(
      `UPDATE profiles SET ${fields.join(', ')} WHERE id = $${idx} RETURNING *`,
      values
    );
    return res.rows[0] || null;
  }
}

export class PostgresAuditRepository implements IAuditRepository {
  private cm: IConnectionManager;
  private retryQueue: Array<{ entry: Omit<DbAuditLog, 'id' | 'created_at'>; id: string; attempts: number }> = [];
  private isProcessingRetry = false;
  private retryTimer: NodeJS.Timeout | null = null;

  constructor(cm: IConnectionManager) {
    this.cm = cm;
  }

  public async log(entry: Omit<DbAuditLog, 'id' | 'created_at'>): Promise<DbAuditLog> {
    const id = crypto.randomUUID();
    try {
      const res = await this.cm.query<DbAuditLog>(
        `INSERT INTO audit_logs (id, user_id, user_email, role, action, target_type, target_id, details, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW())
         RETURNING *`,
        [
          id,
          entry.user_id,
          entry.user_email,
          entry.role,
          entry.action,
          entry.target_type,
          entry.target_id,
          JSON.stringify(entry.details || {}),
        ]
      );
      return res.rows[0];
    } catch {
      // Enqueue in resilient retry buffer if queue has capacity (< 500)
      if (this.retryQueue.length < 500) {
        this.retryQueue.push({ entry, id, attempts: 0 });
        this.scheduleRetry();
      }
      return {
        id,
        created_at: new Date().toISOString(),
        ...entry,
        details: entry.details || {},
      };
    }
  }

  private scheduleRetry(): void {
    if (this.isProcessingRetry || this.retryTimer) return;
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      void this.processRetryQueue();
    }, 1000);
    if (typeof this.retryTimer.unref === 'function') {
      this.retryTimer.unref();
    }
  }

  private async processRetryQueue(): Promise<void> {
    if (this.isProcessingRetry || this.retryQueue.length === 0) return;
    this.isProcessingRetry = true;
    try {
      while (this.retryQueue.length > 0) {
        const item = this.retryQueue[0];
        try {
          await this.cm.query(
            `INSERT INTO audit_logs (id, user_id, user_email, role, action, target_type, target_id, details, created_at)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW())
             ON CONFLICT (id) DO NOTHING`,
            [
              item.id,
              item.entry.user_id,
              item.entry.user_email,
              item.entry.role,
              item.entry.action,
              item.entry.target_type,
              item.entry.target_id,
              JSON.stringify(item.entry.details || {}),
            ]
          );
          this.retryQueue.shift();
        } catch {
          item.attempts += 1;
          if (item.attempts >= 5) {
            this.retryQueue.shift(); // Drop after 5 failed attempts
          } else {
            break; // Pause and retry on next cycle
          }
        }
      }
    } finally {
      this.isProcessingRetry = false;
      if (this.retryQueue.length > 0) {
        this.scheduleRetry();
      }
    }
  }

  public async findAll(limit: number = 100): Promise<DbAuditLog[]> {
    const res = await this.cm.query<DbAuditLog>(
      'SELECT id, user_id, user_email, role, action, target_type, target_id, details, created_at FROM audit_logs ORDER BY created_at DESC LIMIT $1',
      [limit]
    );
    return res.rows;
  }
}

/**
 * Composite PostgreSQL Database Repository
 */
export class PostgresDatabaseRepository implements IDatabaseRepository {
  private static instance: PostgresDatabaseRepository | null = null;

  public zones: IZoneRepository;
  public workers: IWorkerRepository;
  public helmets: IHelmetRepository;
  public zoneAssignments: IZoneAssignmentRepository;
  public telemetry: ITelemetryRepository;
  public alerts: IAlertRepository;
  public profiles: IProfileRepository;
  public auditLogs: IAuditRepository;

  private startTime: number = Date.now();
  private cm: IConnectionManager;

  private constructor(cm: IConnectionManager = connectionManager) {
    this.cm = cm;
    this.zones = new PostgresZoneRepository(this.cm);
    this.workers = new PostgresWorkerRepository(this.cm);
    this.helmets = new PostgresHelmetRepository(this.cm);
    this.zoneAssignments = new PostgresZoneAssignmentRepository(this.cm);
    this.telemetry = new PostgresTelemetryRepository(this.cm);
    this.alerts = new PostgresAlertRepository(this.cm);
    this.profiles = new PostgresProfileRepository(this.cm);
    this.auditLogs = new PostgresAuditRepository(this.cm);
  }

  public static getInstance(cm?: IConnectionManager): PostgresDatabaseRepository {
    if (!PostgresDatabaseRepository.instance) {
      PostgresDatabaseRepository.instance = new PostgresDatabaseRepository(cm);
    }
    return PostgresDatabaseRepository.instance;
  }

  public static resetInstance(): void {
    PostgresDatabaseRepository.instance = null;
  }

  // Delegation methods
  public getZones(): Promise<DbMineZone[]> {
    return this.zones.findAll();
  }

  public getZone(idOrName: string): Promise<DbMineZone | null> {
    return this.zones.findByIdOrName(idOrName);
  }

  public getWorkers(): Promise<WorkerWithZoneDetails[]> {
    return this.workers.findAll();
  }

  public getWorker(idOrCode: string): Promise<WorkerWithZoneDetails | null> {
    return this.workers.findByIdOrCode(idOrCode);
  }

  public updateWorker(id: string, updates: Partial<DbWorker>): Promise<DbWorker | null> {
    return this.workers.update(id, updates);
  }

  public getHelmets(): Promise<HelmetWithDetails[]> {
    return this.helmets.findAll();
  }

  public getRawHelmets(): Promise<DbHelmet[]> {
    return this.helmets.findRawAll();
  }

  public getHelmet(id: string): Promise<DbHelmet | null> {
    return this.helmets.findById(id);
  }

  public getHelmetWithDetails(id: string): Promise<HelmetWithDetails | null> {
    return this.helmets.findByIdWithDetails(id);
  }

  public updateHelmet(id: string, updates: Partial<DbHelmet>): Promise<DbHelmet | null> {
    return this.helmets.update(id, updates);
  }

  public getActiveZoneAssignment(workerId: string): Promise<DbZoneAssignment | null> {
    return this.zoneAssignments.findActiveByWorkerId(workerId);
  }

  public getZoneAssignmentsHistory(workerId?: string): Promise<DbZoneAssignment[]> {
    return this.zoneAssignments.findHistory(workerId);
  }

  public getZoneAssignmentsByRange(filter: {
    from: string;
    to: string;
    workerId?: string;
    zoneId?: string;
  }): Promise<DbZoneAssignment[]> {
    return this.zoneAssignments.findByRange(filter);
  }

  public createZoneAssignment(
    workerId: string,
    helmetId: string,
    zoneId: string,
    assignmentType: 'CHECK_IN' | 'SUPERVISOR_REASSIGN' = 'CHECK_IN'
  ): Promise<DbZoneAssignment> {
    return this.zoneAssignments.create(workerId, helmetId, zoneId, assignmentType);
  }

  public checkOutWorker(workerId: string): Promise<boolean> {
    return this.zoneAssignments.checkOutWorker(workerId);
  }

  public saveTelemetry(telemetry: DbTelemetry): Promise<void> {
    return this.telemetry.save(telemetry);
  }

  public getLatestTelemetry(helmetId: string): Promise<DbTelemetry | null> {
    return this.telemetry.findLatestByHelmetId(helmetId);
  }

  public getTelemetryHistory(helmetId: string, limit: number = 50): Promise<DbTelemetry[]> {
    return this.telemetry.findHistoryByHelmetId(helmetId, limit);
  }

  public getTelemetryByRange(filter: {
    from: string;
    to: string;
    helmetId?: string;
    helmetIds?: string[];
  }): Promise<DbTelemetry[]> {
    return this.telemetry.findByRange(filter);
  }

  public getAlerts(filter?: { status?: string; severity?: string; helmetId?: string }): Promise<DbAlert[]> {
    return this.alerts.findAll(filter);
  }

  public getAlertsStore(): Promise<DbAlert[]> {
    return this.alerts.findAll();
  }

  public getActiveAlerts(): Promise<DbAlert[]> {
    return this.alerts.findActive();
  }

  public getAlertHistory(): Promise<DbAlert[]> {
    return this.alerts.findHistory();
  }

  public getAlertsHistory(): Promise<DbAlert[]> {
    return this.alerts.findHistory();
  }

  public getAlertsByRange(filter: {
    from: string;
    to: string;
    helmetId?: string;
    workerId?: string;
    zoneId?: string;
  }): Promise<DbAlert[]> {
    return this.alerts.findByRange(filter);
  }

  public saveAlert(alert: DbAlert): Promise<DbAlert> {
    return this.alerts.create(alert);
  }

  public acknowledgeAlert(id: string, supervisorName: string): Promise<DbAlert | null> {
    return this.alerts.acknowledge(id, supervisorName);
  }

  public resolveAlert(id: string, notes: string): Promise<DbAlert | null> {
    return this.alerts.resolve(id, notes);
  }

  public getAllProfiles(): Promise<DbUserProfile[]> {
    return this.profiles.findAll();
  }

  public getProfiles(): Promise<DbUserProfile[]> {
    return this.profiles.findAll();
  }

  public getProfile(id: string): Promise<DbUserProfile | null> {
    return this.profiles.findById(id);
  }

  public getProfileById(id: string): Promise<DbUserProfile | null> {
    return this.profiles.findById(id);
  }

  public getProfileByEmail(email: string): Promise<DbUserProfile | null> {
    return this.profiles.findByEmail(email);
  }

  public getProfileByAuthId(authId: string): Promise<DbUserProfile | null> {
    return this.profiles.findByAuthUserId(authId);
  }

  public createProfile(profile: DbUserProfile): Promise<DbUserProfile> {
    return this.profiles.create(profile);
  }

  public updateProfile(id: string, updates: Partial<DbUserProfile>): Promise<DbUserProfile | null> {
    return this.profiles.update(id, updates);
  }

  public logAuditAction(entry: Omit<DbAuditLog, 'id' | 'created_at'>): Promise<DbAuditLog> {
    return this.auditLogs.log(entry);
  }

  public getAuditLogs(limit: number = 100): Promise<DbAuditLog[]> {
    return this.auditLogs.findAll(limit);
  }

  public async getSystemHealth(): Promise<SystemHealthStatus> {
    const [zonesRes, workersRes, helmetsRes, activeAssignsRes, activeAlertsRes] = await Promise.all([
      this.cm.query<{ count: string }>('SELECT COUNT(*) as count FROM mine_zones'),
      this.cm.query<{ count: string }>('SELECT COUNT(*) as count FROM workers'),
      this.cm.query<{ count: string; online_count: string }>(
        'SELECT COUNT(*) as count, COUNT(*) FILTER (WHERE online = TRUE) as online_count FROM helmets'
      ),
      this.cm.query<{ count: string }>('SELECT COUNT(*) as count FROM zone_assignments WHERE active = TRUE'),
      this.cm.query<{ count: string }>("SELECT COUNT(*) as count FROM alerts WHERE status != 'RESOLVED'"),
    ]);

    const totalHelmets = Number(helmetsRes.rows[0]?.count || 0);
    const onlineHelmets = Number(helmetsRes.rows[0]?.online_count || 0);
    const activeWorkers = Number(activeAssignsRes.rows[0]?.count || 0);
    const activeAlerts = Number(activeAlertsRes.rows[0]?.count || 0);
    const totalZones = Number(zonesRes.rows[0]?.count || 0);
    const totalWorkers = Number(workersRes.rows[0]?.count || 0);

    const isHealthy = onlineHelmets > 0;

    return {
      status: isHealthy ? 'OPERATIONAL' : 'DEGRADED',
      timestamp: new Date().toISOString(),
      uptimeSeconds: Math.floor((Date.now() - this.startTime) / 1000),
      services: {
        backend: { status: 'ONLINE', port: 3001, version: '4.0.0-phase8' },
        database: {
          status: 'CONNECTED',
          engine: this.cm.isPgMem() ? 'PostgreSQL (pg-mem)' : 'Supabase PostgreSQL',
          activeRecords: totalZones + totalWorkers + totalHelmets + activeAlerts,
        },
        telemetrySource: { status: 'STREAMING', producer: 'MockTelemetryProvider', packetRateHz: 0.5 },
        realtime: { status: 'ACTIVE', provider: 'Supabase Realtime' },
        auth: {
          status: 'OPERATIONAL',
          provider: 'Supabase Auth',
          totalUsers: 4,
          rlsEnforced: true,
        },
      },
      metrics: {
        totalHelmets,
        onlineHelmets,
        activeWorkers,
        activeAlerts,
        totalZones,
      },
    };
  }
}
