/**
 * MineCare - Frontend Helmet Service
 */

import { apiRequest } from './apiClient';
import type { DbHelmet, DbTelemetry } from '../../backend/types';

export const helmetService = {
  async getHelmets(): Promise<DbHelmet[]> {
    return apiRequest<DbHelmet[]>('/api/v1/helmets');
  },

  async getHelmet(id: string): Promise<DbHelmet> {
    return apiRequest<DbHelmet>(`/api/v1/helmets/${encodeURIComponent(id)}`);
  },

  async getLatestTelemetry(id: string): Promise<DbTelemetry> {
    return apiRequest<DbTelemetry>(`/api/v1/helmets/${encodeURIComponent(id)}/latest`);
  },

  async getTelemetryHistory(id: string, limit: number = 50): Promise<DbTelemetry[]> {
    return apiRequest<DbTelemetry[]>(`/api/v1/helmets/${encodeURIComponent(id)}/history?limit=${limit}`);
  },
};
