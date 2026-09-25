/**
 * MineCare - Backend Realtime Event Publisher
 *
 * Implements Supabase-compatible Realtime postgres_changes event publishing:
 * - Broadcasts authoritative database changes to all connected clients
 * - Tables supported: 'telemetry' | 'helmets' | 'alerts' | 'zone_assignments'
 * - Events supported: 'INSERT' | 'UPDATE' | 'DELETE'
 * - Provides both SSE stream delivery (for browser clients) and in-process subscribers (for tests/local)
 * - Enforces role-based isolation (Worker clients receive only permitted personal events)
 */

import type { ServerResponse } from 'http';
import type { UserRole } from '../types';

export type RealtimeTable = 'telemetry' | 'helmets' | 'alerts' | 'zone_assignments';
export type RealtimeEventType = 'INSERT' | 'UPDATE' | 'DELETE';

export interface PostgresChangesPayload<T = any> {
  schema: 'public';
  table: RealtimeTable;
  eventType: RealtimeEventType;
  new: T;
  old: Partial<T> | null;
  commit_timestamp: string;
}

export type RealtimeListener = (payload: PostgresChangesPayload) => void;

export interface SseClient {
  id: string;
  res: ServerResponse;
  role: UserRole;
  workerId: string | null;
  assignedHelmetId: string | null;
}

export class RealtimePublisher {
  private static instance: RealtimePublisher | null = null;
  private listeners: Set<RealtimeListener> = new Set();
  private sseClients: Map<string, SseClient> = new Map();
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;

  private constructor() {}

  public static getInstance(): RealtimePublisher {
    if (!RealtimePublisher.instance) {
      RealtimePublisher.instance = new RealtimePublisher();
    }
    return RealtimePublisher.instance;
  }

  /**
   * Reset instance (useful for clean test isolation)
   */
  public static resetInstance(): void {
    if (RealtimePublisher.instance) {
      if (RealtimePublisher.instance.heartbeatTimer) {
        clearInterval(RealtimePublisher.instance.heartbeatTimer);
        RealtimePublisher.instance.heartbeatTimer = null;
      }
      RealtimePublisher.instance.listeners.clear();
      RealtimePublisher.instance.sseClients.clear();
      RealtimePublisher.instance = null;
    }
  }

  /**
   * Subscribe an in-process listener (used by tests and in-process services)
   */
  public subscribe(listener: RealtimeListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /**
   * Register an SSE HTTP client connection
   */
  public addSseClient(client: SseClient): void {
    this.sseClients.set(client.id, client);
    client.res.on('close', () => {
      this.removeSseClient(client.id);
    });

    if (!this.heartbeatTimer) {
      this.startHeartbeat();
    }
  }

  /**
   * Remove an SSE HTTP client
   */
  public removeSseClient(clientId: string): void {
    this.sseClients.delete(clientId);
    if (this.sseClients.size === 0 && this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  private startHeartbeat(): void {
    this.heartbeatTimer = setInterval(() => {
      this.sendHeartbeat();
    }, 25000);

    if (typeof this.heartbeatTimer.unref === 'function') {
      this.heartbeatTimer.unref();
    }
  }

  private sendHeartbeat(): void {
    if (this.sseClients.size === 0) {
      if (this.heartbeatTimer) {
        clearInterval(this.heartbeatTimer);
        this.heartbeatTimer = null;
      }
      return;
    }

    const comment = `: heartbeat ${Date.now()}\n\n`;
    this.sseClients.forEach((client) => {
      try {
        client.res.write(comment);
      } catch {
        this.sseClients.delete(client.id);
      }
    });
  }

  public getConnectedClientsCount(): number {
    return this.sseClients.size + this.listeners.size;
  }

  /**
   * Authoritatively publish a database change event in Supabase Realtime format
   */
  public publish<T = any>(
    table: RealtimeTable,
    eventType: RealtimeEventType,
    newRecord: T,
    oldRecord: Partial<T> | null = null
  ): PostgresChangesPayload<T> {
    const payload: PostgresChangesPayload<T> = {
      schema: 'public',
      table,
      eventType,
      new: newRecord,
      old: oldRecord,
      commit_timestamp: new Date().toISOString(),
    };

    // 1. Dispatch to in-process listeners
    this.listeners.forEach((listener) => {
      try {
        listener(payload as PostgresChangesPayload);
      } catch (err) {
        console.error('[RealtimePublisher] Error in in-process listener:', err);
      }
    });

    // 2. Dispatch to connected SSE clients with RBAC isolation
    if (this.sseClients.size > 0) {
      const dataStr = JSON.stringify(payload);
      const sseMessage = `event: postgres_changes\ndata: ${dataStr}\n\n`;

      this.sseClients.forEach((client) => {
        if (!this.isEventPermittedForClient(client, payload as PostgresChangesPayload)) {
          return; // Drop events that worker client is not authorized to see
        }

        try {
          client.res.write(sseMessage);
        } catch {
          this.sseClients.delete(client.id);
        }
      });
    }

    return payload;
  }

  /**
   * Authoritative check: Is the client permitted to receive this realtime database change?
   */
  public isEventPermittedForClient(client: SseClient, payload: PostgresChangesPayload): boolean {
    if (client.role === 'ADMIN' || client.role === 'SUPERVISOR') {
      return true; // Admins and Supervisors receive all operational events
    }

    if (client.role === 'WORKER') {
      const { table, new: record } = payload;
      const rec = record as Record<string, unknown>;

      switch (table) {
        case 'telemetry': {
          const helmetId = String(rec.helmet_id || '');
          return Boolean(client.assignedHelmetId && helmetId === client.assignedHelmetId);
        }

        case 'helmets': {
          const helmetId = String(rec.id || rec.helmet_code || '');
          return Boolean(client.assignedHelmetId && helmetId === client.assignedHelmetId);
        }

        case 'alerts': {
          const alertWorkerId = String(rec.worker_id || '');
          const alertHelmetId = String(rec.helmet_id || '');
          const matchWorker = Boolean(client.workerId && alertWorkerId === client.workerId);
          const matchHelmet = Boolean(client.assignedHelmetId && alertHelmetId === client.assignedHelmetId);
          return matchWorker || matchHelmet;
        }

        case 'zone_assignments': {
          const assignmentWorkerId = String(rec.worker_id || '');
          return Boolean(client.workerId && assignmentWorkerId === client.workerId);
        }

        default:
          return false;
      }
    }

    return false;
  }
}
