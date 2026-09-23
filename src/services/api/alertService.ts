/**
 * MineCare - Frontend Alert Service
 */

import { apiRequest } from './apiClient';
import type { DbAlert } from '../../backend/types';

export const alertService = {
  async getAlerts(filter?: { status?: string; severity?: string; helmetId?: string }): Promise<DbAlert[]> {
    const params = new URLSearchParams();
    if (filter?.status) params.set('status', filter.status);
    if (filter?.severity) params.set('severity', filter.severity);
    if (filter?.helmetId) params.set('helmetId', filter.helmetId);

    const query = params.toString() ? `?${params.toString()}` : '';
    return apiRequest<DbAlert[]>(`/api/v1/alerts${query}`);
  },

  async getActiveAlerts(): Promise<DbAlert[]> {
    return apiRequest<DbAlert[]>('/api/v1/alerts/active');
  },

  async getAlertHistory(): Promise<DbAlert[]> {
    return apiRequest<DbAlert[]>('/api/v1/alerts/history');
  },

  async acknowledgeAlert(alertId: string, supervisorName?: string): Promise<DbAlert> {
    return apiRequest<DbAlert>(`/api/v1/alerts/${encodeURIComponent(alertId)}/acknowledge`, {
      method: 'POST',
      body: JSON.stringify({ supervisorName: supervisorName || 'Supervisor On-Duty' }),
    });
  },

  async resolveAlert(alertId: string, notes?: string): Promise<DbAlert> {
    return apiRequest<DbAlert>(`/api/v1/alerts/${encodeURIComponent(alertId)}/resolve`, {
      method: 'POST',
      body: JSON.stringify({ notes: notes || 'Resolved from dashboard' }),
    });
  },
};
