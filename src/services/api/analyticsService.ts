/**
 * MineCare - Frontend Analytics API Service
 * Communicates with /api/v1/analytics/*
 */

import { apiRequest } from './apiClient';
import type {
  AnalyticsOverviewResult,
  TelemetryAnalyticsResult,
  AlertAnalyticsResult,
  ZoneAnalyticsSummary,
} from '../../backend/analytics/AnalyticsEngine';

export interface AnalyticsFilterParams {
  from?: string;
  to?: string;
  helmetId?: string;
  workerId?: string;
  zoneId?: string;
}

function buildQueryString(params?: AnalyticsFilterParams): string {
  if (!params) return '';
  const search = new URLSearchParams();
  if (params.from) search.set('from', params.from);
  if (params.to) search.set('to', params.to);
  if (params.helmetId) search.set('helmetId', params.helmetId);
  if (params.workerId) search.set('workerId', params.workerId);
  if (params.zoneId) search.set('zoneId', params.zoneId);
  const q = search.toString();
  return q ? `?${q}` : '';
}

export const analyticsService = {
  async getOverview(params?: AnalyticsFilterParams): Promise<AnalyticsOverviewResult> {
    return apiRequest<AnalyticsOverviewResult>(`/api/v1/analytics/overview${buildQueryString(params)}`);
  },

  async getTelemetry(params?: AnalyticsFilterParams): Promise<TelemetryAnalyticsResult> {
    return apiRequest<TelemetryAnalyticsResult>(`/api/v1/analytics/telemetry${buildQueryString(params)}`);
  },

  async getAlerts(params?: AnalyticsFilterParams): Promise<AlertAnalyticsResult> {
    return apiRequest<AlertAnalyticsResult>(`/api/v1/analytics/alerts${buildQueryString(params)}`);
  },

  async getZones(params?: AnalyticsFilterParams): Promise<ZoneAnalyticsSummary[]> {
    return apiRequest<ZoneAnalyticsSummary[]>(`/api/v1/analytics/zones${buildQueryString(params)}`);
  },

  async getHelmetAnalytics(helmetId: string, params?: { from?: string; to?: string }): Promise<any> {
    return apiRequest<any>(`/api/v1/analytics/helmets/${encodeURIComponent(helmetId)}${buildQueryString(params)}`);
  },

  async getWorkerAnalytics(workerId: string, params?: { from?: string; to?: string }): Promise<any> {
    return apiRequest<any>(`/api/v1/analytics/workers/${encodeURIComponent(workerId)}${buildQueryString(params)}`);
  },
};
