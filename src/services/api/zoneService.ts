/**
 * MineCare - Frontend Zone Service
 */

import { apiRequest } from './apiClient';
import type { DbMineZone, DbWorker } from '../../backend/types';
import type { ZoneOccupancySummary } from '../../types/zone';

export const zoneService = {
  async getZones(): Promise<ZoneOccupancySummary[]> {
    return apiRequest<ZoneOccupancySummary[]>('/api/v1/zones');
  },

  async getZone(id: string): Promise<DbMineZone> {
    return apiRequest<DbMineZone>(`/api/v1/zones/${encodeURIComponent(id)}`);
  },

  async getZoneWorkers(id: string): Promise<DbWorker[]> {
    return apiRequest<DbWorker[]>(`/api/v1/zones/${encodeURIComponent(id)}/workers`);
  },
};
