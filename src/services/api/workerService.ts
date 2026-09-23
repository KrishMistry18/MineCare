/**
 * MineCare - Frontend Worker Service
 */

import { apiRequest } from './apiClient';
import type { DbWorker } from '../../backend/types';

export interface WorkerWithZone extends DbWorker {
  assigned_zone_name?: string;
  current_work_zone_name?: string | null;
}

export const workerService = {
  async getWorkers(): Promise<WorkerWithZone[]> {
    return apiRequest<WorkerWithZone[]>('/api/v1/workers');
  },

  async getWorker(id: string): Promise<WorkerWithZone> {
    return apiRequest<WorkerWithZone>(`/api/v1/workers/${encodeURIComponent(id)}`);
  },

  async checkIn(workerId: string, zoneIdOrName: string): Promise<{ success: boolean; message: string }> {
    return apiRequest<{ success: boolean; message: string }>(
      `/api/v1/workers/${encodeURIComponent(workerId)}/check-in`,
      {
        method: 'POST',
        body: JSON.stringify({ zoneId: zoneIdOrName }),
      }
    );
  },

  async checkOut(workerId: string): Promise<{ success: boolean; message: string }> {
    return apiRequest<{ success: boolean; message: string }>(
      `/api/v1/workers/${encodeURIComponent(workerId)}/check-out`,
      {
        method: 'POST',
      }
    );
  },

  async reassignZone(
    workerId: string,
    zoneIdOrName: string,
    updateDefault: boolean = false
  ): Promise<{ success: boolean; message: string }> {
    return apiRequest<{ success: boolean; message: string }>(
      `/api/v1/workers/${encodeURIComponent(workerId)}/zone`,
      {
        method: 'POST',
        body: JSON.stringify({ zoneId: zoneIdOrName, updateDefault }),
      }
    );
  },
};
