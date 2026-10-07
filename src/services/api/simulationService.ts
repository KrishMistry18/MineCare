/**
 * MineCare - Simulation API Service
 *
 * Dispatches authorized scenario simulation commands to backend API (/api/v1/simulation/*).
 * Ensures zero device secrets are exposed to client bundle.
 */

import { apiRequest } from './apiClient';
import type { ScenarioType } from '../../types/telemetry';

export interface SimulationScenarioResponse {
  success: boolean;
  simulation: boolean;
  scenario: ScenarioType;
  helmetId: string;
  packetId?: string;
  safety?: {
    status: 'SAFE' | 'WARNING' | 'DANGER';
    primaryTrigger: string;
    triggerDetails: string[];
    outputs: {
      greenLed: boolean;
      redLed: boolean;
      buzzer: boolean;
    };
  };
  alertCreated?: boolean;
  alertsResolvedCount?: number;
}

export const simulationService = {
  /**
   * Triggers an authorized simulation scenario on the backend.
   */
  async runScenario(scenario: ScenarioType, helmetId: string): Promise<SimulationScenarioResponse> {
    return apiRequest<SimulationScenarioResponse>('/api/v1/simulation/scenario', {
      method: 'POST',
      body: JSON.stringify({ scenario, helmetId }),
    });
  },
};
