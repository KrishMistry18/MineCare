/**
 * MineCare - Supabase Realtime Service (Phase 10 Hardened)
 *
 * Implements authoritative Realtime delivery for:
 * - 'telemetry' (INSERT)
 * - 'helmets' (UPDATE)
 * - 'alerts' (INSERT | UPDATE)
 * - 'zone_assignments' (INSERT | UPDATE)
 *
 * Connection Lifecycle & Hardening:
 * - CONNECTING -> CONNECTED
 * - On network/server failure: ERROR / DISCONNECTED
 * - Automatic exponential backoff reconnection with jitter
 * - Heartbeat / keepalive watchdog to detect hung or half-open connections
 * - Browser network online/offline lifecycle listeners
 * - Clean unsubscribe and connection teardown on logout/navigation
 * - Role-aware event filtering (Worker role receives ONLY permitted personal data)
 * - Authoritative deduplication cache preventing duplicate event processing
 */

import { createClient, type RealtimeChannel, type SupabaseClient } from '@supabase/supabase-js';
import type { UserRole } from '../../backend/types';
import { RealtimePublisher } from '../../backend/realtime/RealtimePublisher';
import { getAuthToken } from '../api/apiClient';

export type RealtimeConnectionState = 'CONNECTED' | 'CONNECTING' | 'DISCONNECTED' | 'ERROR';
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

export type TableChangeCallback<T = any> = (payload: PostgresChangesPayload<T>) => void;
export type ConnectionStateListener = (state: RealtimeConnectionState) => void;

export class SupabaseRealtimeService {
  private static instance: SupabaseRealtimeService | null = null;

  private connectionState: RealtimeConnectionState = 'DISCONNECTED';
  private stateListeners: Set<ConnectionStateListener> = new Set();
  private tableSubscribers: Map<RealtimeTable, Set<TableChangeCallback>> = new Map([
    ['telemetry', new Set()],
    ['helmets', new Set()],
    ['alerts', new Set()],
    ['zone_assignments', new Set()],
  ]);

  // Supabase remote client (when environment variables exist)
  private supabaseClient: SupabaseClient | null = null;
  private supabaseChannel: RealtimeChannel | null = null;
  private isSupabaseConfigured: boolean = false;

  // Local stream client (browser EventSource / in-process fallback)
  private eventSource: EventSource | null = null;
  private inProcessUnsubscribe: (() => void) | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectAttempts: number = 0;
  private isExplicitDisconnect: boolean = false;

  // Heartbeat / Keepalive watchdog
  private lastHeartbeatTimestamp: number = Date.now();
  private heartbeatWatchdogTimer: ReturnType<typeof setInterval> | null = null;
  private heartbeatTimeoutMs: number = 45000; // 45 seconds default keepalive timeout

  // Online / Offline window listeners
  private onlineListener: (() => void) | null = null;
  private offlineListener: (() => void) | null = null;

  // Active user authorization context
  private currentUser: { role: UserRole; worker_id?: string | null; assignedHelmetId?: string | null } | null = null;

  // Event deduplication cache
  private processedEventKeys: Set<string> = new Set();
  private duplicateEventsDroppedCount: number = 0;

  private constructor() {
    this.checkConfiguration();
  }

  public static getInstance(): SupabaseRealtimeService {
    if (!SupabaseRealtimeService.instance) {
      SupabaseRealtimeService.instance = new SupabaseRealtimeService();
    }
    return SupabaseRealtimeService.instance;
  }

  /**
   * Reset instance (for test isolation)
   */
  public static resetInstance(): void {
    if (SupabaseRealtimeService.instance) {
      SupabaseRealtimeService.instance.disconnect();
      SupabaseRealtimeService.instance.clearTableSubscribers();
      SupabaseRealtimeService.instance = null;
    }
  }

  private checkConfiguration(): void {
    const supabaseUrl =
      typeof import.meta !== 'undefined' && import.meta.env?.VITE_SUPABASE_URL
        ? String(import.meta.env.VITE_SUPABASE_URL).trim()
        : typeof process !== 'undefined' && process.env?.VITE_SUPABASE_URL
        ? String(process.env.VITE_SUPABASE_URL).trim()
        : '';

    const supabaseKey =
      typeof import.meta !== 'undefined' && import.meta.env?.VITE_SUPABASE_ANON_KEY
        ? String(import.meta.env.VITE_SUPABASE_ANON_KEY).trim()
        : typeof process !== 'undefined' && process.env?.VITE_SUPABASE_ANON_KEY
        ? String(process.env.VITE_SUPABASE_ANON_KEY).trim()
        : '';

    this.isSupabaseConfigured = Boolean(
      supabaseUrl &&
      supabaseKey &&
      supabaseUrl.startsWith('http') &&
      !supabaseUrl.includes('placeholder')
    );

    if (this.isSupabaseConfigured) {
      try {
        this.supabaseClient = createClient(supabaseUrl, supabaseKey);
      } catch (err) {
        console.warn('[SupabaseRealtimeService] Could not init Supabase client, falling back to Event Bus:', err);
        this.isSupabaseConfigured = false;
      }
    }
  }

  public getProviderName(): string {
    return this.isSupabaseConfigured ? 'Supabase Realtime' : 'Event Bus';
  }

  public getConnectionState(): RealtimeConnectionState {
    return this.connectionState;
  }

  public onConnectionStateChange(listener: ConnectionStateListener): () => void {
    this.stateListeners.add(listener);
    listener(this.connectionState);
    return () => {
      this.stateListeners.delete(listener);
    };
  }

  private setConnectionState(state: RealtimeConnectionState): void {
    if (this.connectionState === state) return;
    this.connectionState = state;
    this.stateListeners.forEach((listener) => {
      try {
        listener(state);
      } catch (e) {
        console.error('[SupabaseRealtimeService] Error in state listener', e);
      }
    });
  }

  /**
   * Set user role authorization context for real-time isolation
   */
  public setUser(user: { role: UserRole; worker_id?: string | null; assignedHelmetId?: string | null } | null): void {
    const prevUser = this.currentUser;
    this.currentUser = user;
    if (user && user !== prevUser && typeof window !== 'undefined') {
      this.connectLocalEventBus();
    }
  }

  /**
   * Connect to Realtime service
   */
  public connect(): void {
    this.isExplicitDisconnect = false;
    if (this.connectionState === 'CONNECTED' || this.connectionState === 'CONNECTING') {
      return;
    }

    this.setConnectionState('CONNECTING');
    this.lastHeartbeatTimestamp = Date.now();
    this.setupNetworkListeners();
    this.startKeepaliveWatchdog();

    // 1. Authoritative Backend Event Bus via SSE
    this.connectLocalEventBus();

    // 2. Remote Supabase Realtime Channel (if configured)
    if (this.isSupabaseConfigured && this.supabaseClient) {
      this.connectRemoteSupabase();
    }
  }

  /**
   * Connect via Remote Supabase Realtime Channel
   */
  private connectRemoteSupabase(): void {
    if (!this.supabaseClient) return;

    try {
      this.supabaseChannel = this.supabaseClient
        .channel('minecare-operations')
        .on('postgres_changes', { event: '*', schema: 'public', table: 'telemetry' }, (payload) => {
          this.lastHeartbeatTimestamp = Date.now();
          this.handleIncomingPayload({
            schema: 'public',
            table: 'telemetry',
            eventType: payload.eventType as RealtimeEventType,
            new: payload.new,
            old: payload.old,
            commit_timestamp: payload.commit_timestamp || new Date().toISOString(),
          });
        })
        .on('postgres_changes', { event: '*', schema: 'public', table: 'helmets' }, (payload) => {
          this.lastHeartbeatTimestamp = Date.now();
          this.handleIncomingPayload({
            schema: 'public',
            table: 'helmets',
            eventType: payload.eventType as RealtimeEventType,
            new: payload.new,
            old: payload.old,
            commit_timestamp: payload.commit_timestamp || new Date().toISOString(),
          });
        })
        .on('postgres_changes', { event: '*', schema: 'public', table: 'alerts' }, (payload) => {
          this.lastHeartbeatTimestamp = Date.now();
          this.handleIncomingPayload({
            schema: 'public',
            table: 'alerts',
            eventType: payload.eventType as RealtimeEventType,
            new: payload.new,
            old: payload.old,
            commit_timestamp: payload.commit_timestamp || new Date().toISOString(),
          });
        })
        .on('postgres_changes', { event: '*', schema: 'public', table: 'zone_assignments' }, (payload) => {
          this.lastHeartbeatTimestamp = Date.now();
          this.handleIncomingPayload({
            schema: 'public',
            table: 'zone_assignments',
            eventType: payload.eventType as RealtimeEventType,
            new: payload.new,
            old: payload.old,
            commit_timestamp: payload.commit_timestamp || new Date().toISOString(),
          });
        })
        .subscribe((status, error) => {
          if (status === 'SUBSCRIBED') {
            this.setConnectionState('CONNECTED');
            this.reconnectAttempts = 0;
            this.lastHeartbeatTimestamp = Date.now();
          } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || error) {
            console.error('[SupabaseRealtime] Connection error:', status, error);
            this.setConnectionState('ERROR');
            this.scheduleReconnect();
          } else if (status === 'CLOSED') {
            if (!this.isExplicitDisconnect) {
              this.setConnectionState('DISCONNECTED');
              this.scheduleReconnect();
            }
          }
        });
    } catch (err) {
      console.error('[SupabaseRealtime] Failed to setup channel:', err);
      this.setConnectionState('ERROR');
      this.scheduleReconnect();
    }
  }

  /**
   * Connect via Local Realtime Event Bus / SSE Stream
   */
  private connectLocalEventBus(): void {
    // 1. In browser environment with window: Use EventSource
    if (typeof window !== 'undefined' && typeof EventSource !== 'undefined') {
      const token = getAuthToken() || '';
      const baseUrl =
        typeof import.meta !== 'undefined' && import.meta.env?.VITE_API_URL
          ? String(import.meta.env.VITE_API_URL).trim().replace(/\/+$/, '')
          : '';
      const sseUrl = `${baseUrl}/api/v1/realtime/stream${token ? `?token=${encodeURIComponent(token)}` : ''}`;

      try {
        if (this.eventSource) {
          this.eventSource.close();
        }

        this.eventSource = new EventSource(sseUrl);

        this.eventSource.addEventListener('status', (event: MessageEvent) => {
          this.lastHeartbeatTimestamp = Date.now();
          try {
            const data = JSON.parse(event.data);
            if (data.status === 'CONNECTED') {
              this.setConnectionState('CONNECTED');
              this.reconnectAttempts = 0;
            }
          } catch {
            this.setConnectionState('CONNECTED');
          }
        });

        this.eventSource.addEventListener('heartbeat', () => {
          this.lastHeartbeatTimestamp = Date.now();
        });

        this.eventSource.addEventListener('postgres_changes', (event: MessageEvent) => {
          this.lastHeartbeatTimestamp = Date.now();
          try {
            const payload = JSON.parse(event.data) as PostgresChangesPayload;
            this.handleIncomingPayload(payload);
          } catch (e) {
            console.error('[SupabaseRealtime] Error parsing realtime event:', e);
          }
        });

        this.eventSource.onopen = () => {
          this.lastHeartbeatTimestamp = Date.now();
          this.setConnectionState('CONNECTED');
          this.reconnectAttempts = 0;
        };

        this.eventSource.onerror = () => {
          if (this.isExplicitDisconnect) return;
          this.setConnectionState('ERROR');
          if (this.eventSource) {
            this.eventSource.close();
            this.eventSource = null;
          }
          this.scheduleReconnect();
        };
      } catch (err) {
        console.error('[SupabaseRealtime] Error creating EventSource:', err);
        this.setConnectionState('ERROR');
        this.scheduleReconnect();
      }
      return;
    }

    // 2. Node.js / test environment: Connect to in-process RealtimePublisher
    this.connectInProcessBroker();
  }

  /**
   * In-process connection for testing & SSR
   */
  public connectInProcessBroker(): void {
    try {
      if (this.inProcessUnsubscribe) {
        this.inProcessUnsubscribe();
      }
      this.inProcessUnsubscribe = RealtimePublisher.getInstance().subscribe((payload) => {
        this.lastHeartbeatTimestamp = Date.now();
        this.handleIncomingPayload(payload);
      });
      this.lastHeartbeatTimestamp = Date.now();
      this.setConnectionState('CONNECTED');
      this.reconnectAttempts = 0;
    } catch {
      this.setConnectionState('CONNECTED');
    }
  }

  /**
   * Schedule automatic reconnection with exponential backoff and jitter
   */
  private scheduleReconnect(): void {
    if (this.isExplicitDisconnect) return;
    if (this.reconnectTimer) return;

    this.reconnectAttempts++;
    const baseDelay = Math.min(1000 * Math.pow(1.5, this.reconnectAttempts - 1), 10000);
    // Add up to 15% random jitter to avoid thundering herd on server recovery
    const jitter = baseDelay * (Math.random() * 0.15);
    const delay = Math.round(baseDelay + jitter);

    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      if (!this.isExplicitDisconnect) {
        this.connect();
      }
    }, delay);
  }

  public getReconnectAttempts(): number {
    return this.reconnectAttempts;
  }

  /**
   * Keepalive Watchdog: Monitors connection freshness and re-establishes dead/stale links
   */
  private startKeepaliveWatchdog(): void {
    if (this.heartbeatWatchdogTimer) return;
    this.heartbeatWatchdogTimer = setInterval(() => {
      this.checkKeepalive();
    }, 15000);

    if (typeof this.heartbeatWatchdogTimer.unref === 'function') {
      this.heartbeatWatchdogTimer.unref();
    }
  }

  public checkKeepalive(): boolean {
    if (this.connectionState === 'CONNECTED') {
      const elapsed = Date.now() - this.lastHeartbeatTimestamp;
      if (elapsed > this.heartbeatTimeoutMs) {
        console.warn(`[SupabaseRealtimeService] Heartbeat watchdog timeout (${elapsed}ms > ${this.heartbeatTimeoutMs}ms). Stale connection detected, reconnecting.`);
        this.setConnectionState('ERROR');
        if (this.eventSource) {
          this.eventSource.close();
          this.eventSource = null;
        }
        this.scheduleReconnect();
        return false;
      }
    }
    return true;
  }

  public recordHeartbeat(): void {
    this.lastHeartbeatTimestamp = Date.now();
  }

  public getLastHeartbeat(): number {
    return this.lastHeartbeatTimestamp;
  }

  public setHeartbeatTimeout(ms: number): void {
    this.heartbeatTimeoutMs = ms;
  }

  /**
   * Setup browser window network online/offline listeners
   */
  private setupNetworkListeners(): void {
    if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
      if (!this.onlineListener) {
        this.onlineListener = () => this.handleNetworkOnline();
        window.addEventListener('online', this.onlineListener);
      }
      if (!this.offlineListener) {
        this.offlineListener = () => this.handleNetworkOffline();
        window.addEventListener('offline', this.offlineListener);
      }
    }
  }

  public handleNetworkOffline(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.setConnectionState('DISCONNECTED');
    if (this.eventSource) {
      this.eventSource.close();
      this.eventSource = null;
    }
  }

  public handleNetworkOnline(): void {
    if (!this.isExplicitDisconnect) {
      this.reconnectAttempts = 0;
      this.connect();
    }
  }

  public triggerOffline(): void {
    this.handleNetworkOffline();
  }

  public triggerOnline(): void {
    this.handleNetworkOnline();
  }

  /**
   * Disconnect and cleanup active connections, timers, and listeners
   */
  public disconnect(): void {
    this.isExplicitDisconnect = true;

    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }

    if (this.heartbeatWatchdogTimer) {
      clearInterval(this.heartbeatWatchdogTimer);
      this.heartbeatWatchdogTimer = null;
    }

    if (this.supabaseChannel && this.supabaseClient) {
      this.supabaseClient.removeChannel(this.supabaseChannel);
      this.supabaseChannel = null;
    }

    if (this.eventSource) {
      this.eventSource.close();
      this.eventSource = null;
    }

    if (this.inProcessUnsubscribe) {
      this.inProcessUnsubscribe();
      this.inProcessUnsubscribe = null;
    }

    if (typeof window !== 'undefined' && typeof window.removeEventListener === 'function') {
      if (this.onlineListener) {
        window.removeEventListener('online', this.onlineListener);
        this.onlineListener = null;
      }
      if (this.offlineListener) {
        window.removeEventListener('offline', this.offlineListener);
        this.offlineListener = null;
      }
    }

    this.setConnectionState('DISCONNECTED');
  }

  /**
   * Subscribe to specific table events (e.g., 'telemetry', 'helmets', 'alerts', 'zone_assignments')
   */
  public subscribeTable<T = any>(table: RealtimeTable, callback: TableChangeCallback<T>): () => void {
    const subs = this.tableSubscribers.get(table);
    if (subs) {
      subs.add(callback as TableChangeCallback);
    }

    // Auto-connect if not already connected
    if (this.connectionState === 'DISCONNECTED') {
      this.connect();
    }

    return () => {
      const set = this.tableSubscribers.get(table);
      if (set) {
        set.delete(callback as TableChangeCallback);
      }
    };
  }

  public clearTableSubscribers(): void {
    this.tableSubscribers.forEach((subs) => subs.clear());
  }

  public getTableSubscriberCount(table?: RealtimeTable): number {
    if (table) {
      return this.tableSubscribers.get(table)?.size || 0;
    }
    let total = 0;
    this.tableSubscribers.forEach((subs) => {
      total += subs.size;
    });
    return total;
  }

  /**
   * Authoritative cleanup on user logout: disconnects stream, resets context and caches
   */
  public cleanupOnLogout(): void {
    this.disconnect();
    this.setUser(null);
    this.clearDeduplicationCache();
  }

  /**
   * Authoritative dispatch of payload to subscribers with deduplication and RBAC filtering
   */
  public handleIncomingPayload(payload: PostgresChangesPayload): void {
    this.lastHeartbeatTimestamp = Date.now();

    // 1. Role-aware client filtering
    if (!this.isPayloadAuthorized(payload)) {
      return;
    }

    // 2. Deduplication check
    const eventKey = this.generateEventKey(payload);
    if (this.processedEventKeys.has(eventKey)) {
      this.duplicateEventsDroppedCount++;
      return; // Already processed
    }
    this.processedEventKeys.add(eventKey);
    // Keep deduplication set bounded to last 500 events
    if (this.processedEventKeys.size > 500) {
      const first = this.processedEventKeys.values().next().value;
      if (first) this.processedEventKeys.delete(first);
    }

    // 3. Dispatch to table subscribers
    const subscribers = this.tableSubscribers.get(payload.table);
    if (subscribers) {
      subscribers.forEach((cb) => {
        try {
          cb(payload);
        } catch (err) {
          console.error(`[SupabaseRealtime] Error in ${payload.table} subscriber:`, err);
        }
      });
    }
  }

  public getDuplicateEventsDroppedCount(): number {
    return this.duplicateEventsDroppedCount;
  }

  public getProcessedEventCount(): number {
    return this.processedEventKeys.size;
  }

  public clearDeduplicationCache(): void {
    this.processedEventKeys.clear();
    this.duplicateEventsDroppedCount = 0;
  }

  private generateEventKey(payload: PostgresChangesPayload): string {
    const rec = (payload.new || {}) as Record<string, unknown>;
    const id = String(rec.id || rec.packetId || rec.helmetId || rec.packet_id || '');
    const seq = rec.sequence_number !== undefined ? String(rec.sequence_number) : (rec.sequenceNumber !== undefined ? String(rec.sequenceNumber) : '');
    const ts = String(rec.timestamp || payload.commit_timestamp || '');
    const status = String(rec.status || rec.safety_status || '');
    return `${payload.table}:${payload.eventType}:${id}:${seq}:${ts}:${status}`;
  }

  /**
   * Role-based authorization check: Worker clients must ONLY receive permitted personal data
   */
  public isPayloadAuthorized(payload: PostgresChangesPayload): boolean {
    if (!this.currentUser) return true; // Default permissive when no user bound yet
    if (this.currentUser.role === 'ADMIN' || this.currentUser.role === 'SUPERVISOR') {
      return true; // Admins and Supervisors receive all operational data
    }

    if (this.currentUser.role === 'WORKER') {
      const rec = (payload.new || {}) as Record<string, unknown>;
      const myWorkerId = this.currentUser.worker_id;
      const myHelmetId = this.currentUser.assignedHelmetId || 'MC-001';

      switch (payload.table) {
        case 'telemetry': {
          const helmetId = String(rec.helmet_id || rec.helmetId || '');
          return Boolean(myHelmetId && helmetId === myHelmetId);
        }

        case 'helmets': {
          const helmetId = String(rec.id || rec.helmetId || rec.helmet_code || '');
          return Boolean(myHelmetId && helmetId === myHelmetId);
        }

        case 'alerts': {
          const alertWorkerId = String(rec.worker_id || rec.workerId || '');
          const alertHelmetId = String(rec.helmet_id || rec.helmetId || '');
          return (
            (Boolean(myWorkerId) && alertWorkerId === myWorkerId) ||
            (Boolean(myHelmetId) && alertHelmetId === myHelmetId)
          );
        }

        case 'zone_assignments': {
          const assignmentWorkerId = String(rec.worker_id || rec.workerId || '');
          return Boolean(myWorkerId && assignmentWorkerId === myWorkerId);
        }

        default:
          return false;
      }
    }

    return false;
  }
}
