/**
 * MineCare - Telemetry React Context & Provider
 */

import React, { createContext, useContext, useEffect, useState } from 'react';
import { TelemetryService } from '../services/telemetry/TelemetryService';
import type { HelmetDevice } from '../types/helmet';
import type { SafetyAlert } from '../types/alert';
import type { ScenarioType, TelemetryHistoryPoint } from '../types/telemetry';
import { audioAlert } from '../utils/audioAlert';

interface TelemetryContextValue {
  helmets: HelmetDevice[];
  alerts: SafetyAlert[];
  selectedHelmet: HelmetDevice | null;
  selectedHelmetId: string | null;
  setSelectedHelmetId: (id: string | null) => void;
  getTelemetryHistory: (helmetId: string) => TelemetryHistoryPoint[];
  acknowledgeAlert: (alertId: string) => void;
  resolveAlert: (alertId: string, notes?: string) => void;
  triggerScenario: (scenario: ScenarioType, helmetId?: string) => void;
  audioMuted: boolean;
  toggleAudioMute: () => void;
  activeDangerCount: number;
  activeWarningCount: number;
  providerId: string;
  isSimulation: boolean;
}

const TelemetryContext = createContext<TelemetryContextValue | null>(null);

export const TelemetryProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const service = TelemetryService.getInstance();
  const [helmets, setHelmets] = useState<HelmetDevice[]>(service.getHelmets());
  const [alerts, setAlerts] = useState<SafetyAlert[]>(service.getAlerts());
  const [selectedHelmetId, setSelectedHelmetId] = useState<string | null>('MC-001');
  const [audioMuted, setAudioMuted] = useState<boolean>(true); // Default muted to respect browser UX

  useEffect(() => {
    const unsubscribe = service.subscribe(() => {
      const updatedHelmets = service.getHelmets();
      setHelmets(updatedHelmets);
      setAlerts(service.getAlerts());
    });

    return () => {
      unsubscribe();
    };
  }, [service]);

  // Audio alarm handling when any helmet is in DANGER status
  const dangerHelmets = helmets.filter(h => h.safety.status === 'DANGER');
  const warningHelmets = helmets.filter(h => h.safety.status === 'WARNING');

  useEffect(() => {
    if (dangerHelmets.length > 0 && !audioMuted) {
      audioAlert.startDangerAlarm();
    } else {
      audioAlert.stopAlarm();
    }
  }, [dangerHelmets.length, audioMuted]);

  const toggleAudioMute = () => {
    const next = !audioMuted;
    setAudioMuted(next);
    audioAlert.setMuted(next);
  };

  const selectedHelmet = helmets.find(h => h.helmetId === selectedHelmetId) || helmets[0] || null;

  return (
    <TelemetryContext.Provider
      value={{
        helmets,
        alerts,
        selectedHelmet,
        selectedHelmetId,
        setSelectedHelmetId,
        getTelemetryHistory: (id: string) => service.getTelemetryHistory(id),
        acknowledgeAlert: (alertId: string) => service.acknowledgeAlert(alertId),
        resolveAlert: (alertId: string, notes?: string) => service.resolveAlert(alertId, notes),
        triggerScenario: (scenario: ScenarioType, helmetId?: string) => service.triggerScenario(scenario, helmetId),
        audioMuted,
        toggleAudioMute,
        activeDangerCount: dangerHelmets.length,
        activeWarningCount: warningHelmets.length,
        providerId: service.getProvider().providerId,
        isSimulation: service.getProvider().isSimulation,
      }}
    >
      {children}
    </TelemetryContext.Provider>
  );
};

export const useTelemetry = (): TelemetryContextValue => {
  const context = useContext(TelemetryContext);
  if (!context) {
    throw new Error('useTelemetry must be used within a TelemetryProvider');
  }
  return context;
};
