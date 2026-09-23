/**
 * MineCare - Frontend System Service
 */

import { apiRequest } from './apiClient';
import type { SystemHealthStatus } from '../../backend/types';

export const systemService = {
  async getHealth(): Promise<SystemHealthStatus> {
    return apiRequest<SystemHealthStatus>('/api/v1/system/health');
  },
};
