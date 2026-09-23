/**
 * MineCare - Frontend Telemetry Ingestion Service
 */

import { apiRequest } from './apiClient';
import type { TelemetryIngestPayload } from '../../backend/types';
import type { SafetyEvaluationResult } from '../../types/safety';

export interface TelemetryIngestResponse {
  success: boolean;
  packetId: string;
  safety: SafetyEvaluationResult;
  alertCreated: boolean;
  alertsResolvedCount: number;
}

export const telemetryApiService = {
  async sendTelemetry(payload: TelemetryIngestPayload): Promise<TelemetryIngestResponse> {
    return apiRequest<TelemetryIngestResponse>('/api/v1/telemetry', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  },
};
