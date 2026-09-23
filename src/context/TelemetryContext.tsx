/**
 * MineCare - Telemetry & Zone React Context & Provider
 */

import React, { createContext, useContext, useEffect, useState } from 'react';
import { TelemetryService } from '../services/telemetry/TelemetryService';
import type { HelmetDevice } from '../types/helmet';
import type { SafetyAlert } from '../types/alert';
import type { ScenarioType, TelemetryHistoryPoint } from '../types/telemetry';
import type { MineZone, ZoneOccupancySummary } from '../types/zone';
import type { WorkerProfile } from '../types/worker';
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

  // Zone & Worker Tracking APIs
  zones: MineZone[];
  workers: WorkerProfile[];
  checkInWorker: (helmetId: string, zoneName: string) => boolean;
  checkOutWorker: (helmetId: string) => boolean;
  changeWorkerZone: (helmetId: string, newZoneName: string, updateDefault?: boolean) => boolean;
  zoneOccupancies: ZoneOccupancySummary[];
  selectedZone: string | null;
  setSelectedZone: (zoneName: string | null) => void;
}

const TelemetryContext = createContext<TelemetryContextValue | null>(null);

export const TelemetryProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const service = TelemetryService.getInstance();
  const zoneProvider = service.getZoneProvider();

  const [helmets, setHelmets] = useState<HelmetDevice[]>(service.getHelmets());
  const [alerts, setAlerts] = useState<SafetyAlert[]>(service.getAlerts());
  const [workers, setWorkers] = useState<WorkerProfile[]>(zoneProvider.getWorkers());
  const [zones] = useState<MineZone[]>(zoneProvider.getZones());
  const [selectedHelmetId, setSelectedHelmetId] = useState<string | null>('MC-001');
  const [selectedZone, setSelectedZone] = useState<string | null>(null);
  const [audioMuted, setAudioMuted] = useState<boolean>(true); // Default muted to respect browser UX

  useEffect(() => {
    const unsubscribe = service.subscribe(() => {
      const updatedHelmets = service.getHelmets();
      setHelmets(updatedHelmets);
      setAlerts(service.getAlerts());
      setWorkers(zoneProvider.getWorkers());
    });

    return () => {
      unsubscribe();
    };
  }, [service, zoneProvider]);

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

  const checkInWorker = (helmetId: string, zoneName: string): boolean => {
    const res = zoneProvider.checkInWorker(helmetId, zoneName);
    if (res) {
      setWorkers(zoneProvider.getWorkers());
      setHelmets(service.getHelmets());
    }
    return res;
  };

  const checkOutWorker = (helmetId: string): boolean => {
    const res = zoneProvider.checkOutWorker(helmetId);
    if (res) {
      setWorkers(zoneProvider.getWorkers());
      setHelmets(service.getHelmets());
    }
    return res;
  };

  const changeWorkerZone = (helmetId: string, newZoneName: string, updateDefault: boolean = false): boolean => {
    const res = zoneProvider.assignZone(helmetId, newZoneName, updateDefault);
    if (res) {
      setWorkers(zoneProvider.getWorkers());
      setHelmets(service.getHelmets());
    }
    return res;
  };

  const zoneOccupancies = zoneProvider.getZoneOccupancies(helmets);

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

        // Zones & Worker tracking
        zones,
        workers,
        checkInWorker,
        checkOutWorker,
        changeWorkerZone,
        zoneOccupancies,
        selectedZone,
        setSelectedZone,
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
