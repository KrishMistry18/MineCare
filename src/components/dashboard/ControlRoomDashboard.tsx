/**
 * MineCare - Control Room Dashboard View
 * Matching Lovable reference design 1:1.
 */

import React from 'react';
import { 
  HardHat, 
  ShieldCheck, 
  AlertTriangle, 
  WifiOff, 
  ArrowRight
} from 'lucide-react';
import { useTelemetry } from '../../context/TelemetryContext';
import { HelmetCard } from './HelmetCard';
import { SimulationConsole } from './SimulationConsole';
import { ZoneOccupancyWidget } from './ZoneOccupancyWidget';

interface ControlRoomDashboardProps {
  onNavigateToFleet: (options?: { zone?: string; view?: 'GRID' | 'MAP' }) => void;
  onInspectHelmet: (helmetId: string) => void;
}

export const ControlRoomDashboard: React.FC<ControlRoomDashboardProps> = ({ 
  onNavigateToFleet, 
  onInspectHelmet 
}) => {
  const { 
    helmets, 
    alerts, 
    activeDangerCount, 
    activeWarningCount, 
    resolveAlert,
    zoneOccupancies,
    lastTelemetryTime
  } = useTelemetry();

  const totalHelmets = helmets.length;
  const offlineHelmets = helmets.filter(h => h.connectivity === 'OFFLINE').length;
  const safeHelmets = helmets.filter(h => h.safety.status === 'SAFE' && h.connectivity !== 'OFFLINE').length;

  // Active alerts that are unresolved
  const activeAlertsList = alerts.filter(a => !a.resolved);

  // Sort helmets by severity: DANGER (1), WARNING (2), OFFLINE (3), SAFE (4)
  const sortedHelmets = [...helmets].sort((a, b) => {
    const getScore = (h: typeof a) => {
      if (h.safety.status === 'DANGER') return 0;
      if (h.safety.status === 'WARNING') return 1;
      if (h.connectivity === 'OFFLINE') return 2;
      return 3;
    };
    return getScore(a) - getScore(b);
  });

  // Display all 16 commissioned helmets ordered by severity
  const displayHelmets = sortedHelmets;

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
        <div>
          <h1 className="text-2xl font-bold text-white tracking-tight">
            Control room
          </h1>
          <p className="text-xs text-slate-400 mt-1">
            Simulated telemetry — no physical helmet is connected yet.
          </p>
        </div>

        <div className="text-xs font-mono text-slate-400 self-start sm:self-auto flex items-center space-x-1.5">
          <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 inline-block animate-pulse" />
          <span>Last telemetry {lastTelemetryTime}</span>
        </div>
      </div>

      {/* Top 4 KPI Metrics Row */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3.5">
        {/* Metric 1: HELMETS REPORTING */}
        <div className="bg-[#0c131f] border border-[#182335] rounded-xl p-4 flex flex-col justify-between">
          <div className="flex items-center justify-between text-slate-400">
            <span className="text-[10px] font-mono uppercase tracking-wider font-semibold">
              HELMETS REPORTING
            </span>
            <HardHat className="w-4 h-4 text-slate-400" />
          </div>
          <div className="mt-3">
            <div className="text-3xl font-bold text-white font-mono">
              {totalHelmets}
            </div>
            <div className="text-[11px] text-slate-400 mt-1 font-mono">
              {totalHelmets} commissioned
            </div>
          </div>
        </div>

        {/* Metric 2: SAFE */}
        <div className="bg-[#0c131f] border border-[#182335] rounded-xl p-4 flex flex-col justify-between">
          <div className="flex items-center justify-between text-slate-400">
            <span className="text-[10px] font-mono uppercase tracking-wider font-semibold">
              SAFE
            </span>
            <ShieldCheck className="w-4 h-4 text-slate-400" />
          </div>
          <div className="mt-3">
            <div className="text-3xl font-bold text-emerald-400 font-mono">
              {safeHelmets}
            </div>
          </div>
        </div>

        {/* Metric 3: WARNING / DANGER */}
        <div className={`bg-[#0c131f] border rounded-xl p-4 flex flex-col justify-between transition-colors ${
          activeDangerCount > 0 ? 'border-red-500/80 bg-red-950/20' : activeWarningCount > 0 ? 'border-amber-500/70 bg-amber-950/15' : 'border-[#182335]'
        }`}>
          <div className="flex items-center justify-between text-slate-400">
            <span className="text-[10px] font-mono uppercase tracking-wider font-semibold">
              WARNING / DANGER
            </span>
            <AlertTriangle className={`w-4 h-4 ${activeDangerCount > 0 ? 'text-red-400 animate-bounce' : activeWarningCount > 0 ? 'text-amber-400' : 'text-slate-400'}`} />
          </div>
          <div className="mt-3">
            <div className="text-3xl font-bold font-mono">
              <span className={activeWarningCount > 0 ? 'text-amber-400' : 'text-white'}>{activeWarningCount}</span>
              <span className="text-slate-500 mx-2">/</span>
              <span className={activeDangerCount > 0 ? 'text-red-400 animate-pulse' : 'text-white'}>{activeDangerCount}</span>
            </div>
          </div>
        </div>

        {/* Metric 4: OFFLINE */}
        <div className="bg-[#0c131f] border border-[#182335] rounded-xl p-4 flex flex-col justify-between">
          <div className="flex items-center justify-between text-slate-400">
            <span className="text-[10px] font-mono uppercase tracking-wider font-semibold">
              OFFLINE
            </span>
            <WifiOff className="w-4 h-4 text-slate-400" />
          </div>
          <div className="mt-3">
            <div className="text-3xl font-bold text-white font-mono">
              {offlineHelmets}
            </div>
          </div>
        </div>
      </div>

      {/* Main 2-Column Split: Fleet status (Left) vs Active alerts & Simulation console (Right) */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
        
        {/* Left Column: Fleet status (7 of 12 columns on lg) */}
        <div className="lg:col-span-8 space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="font-bold text-white text-base">
                Fleet status
              </h2>
              <p className="text-xs text-slate-400 mt-0.5">
                Ordered by severity. Select a helmet for full telemetry.
              </p>
            </div>

            <button
              onClick={() => onNavigateToFleet()}
              className="text-xs text-sky-400 hover:text-sky-300 font-medium hover:underline flex items-center space-x-1"
            >
              <span>View all helmets</span>
              <ArrowRight className="w-3.5 h-3.5" />
            </button>
          </div>

          {/* 2-Column Grid of 4 Helmet Cards */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5">
            {displayHelmets.map(helmet => (
              <HelmetCard
                key={helmet.helmetId}
                helmet={helmet}
                onClick={onInspectHelmet}
              />
            ))}
          </div>
        </div>

        {/* Right Column: Zone Occupancy, Active alerts & Simulation console (4 of 12 columns on lg) */}
        <div className="lg:col-span-4 space-y-4 lg:sticky lg:top-6 self-start">
          
          {/* Card 1: Zone Occupancy Overview */}
          <ZoneOccupancyWidget
            zoneOccupancies={zoneOccupancies}
            onNavigateToZoneMap={(zoneName) => onNavigateToFleet({ zone: zoneName, view: 'MAP' })}
          />

          {/* Card 2: Active alerts */}
          <div className="bg-[#0c131f] border border-[#182335] rounded-xl p-4 space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="font-bold text-white text-sm">
                Active alerts
              </h3>
              {activeAlertsList.length > 0 && (
                <span className="text-[10px] px-2 py-0.5 rounded-full font-bold bg-red-600 text-white font-mono">
                  {activeAlertsList.length}
                </span>
              )}
            </div>

            {activeAlertsList.length === 0 ? (
              <div className="py-10 text-center space-y-1">
                <div className="font-bold text-slate-200 text-sm">
                  No active alerts
                </div>
                <div className="text-xs text-slate-400">
                  Every reporting helmet is within prototype thresholds.
                </div>
              </div>
            ) : (
              <div className="space-y-2.5 max-h-72 overflow-y-auto pr-1">
                {activeAlertsList.map(alert => {
                  const isCritical = alert.severity === 'CRITICAL';
                  return (
                    <div
                      key={alert.id}
                      className={`p-3 rounded-lg border text-xs space-y-1.5 ${
                        isCritical
                          ? 'bg-red-950/30 border-red-500/70 text-red-200'
                          : 'bg-amber-950/20 border-amber-500/60 text-amber-200'
                      }`}
                    >
                      <div className="flex items-center justify-between font-mono font-bold">
                        <span className={isCritical ? 'text-red-400' : 'text-amber-400'}>
                          {alert.helmetId} · {alert.workerName}
                        </span>
                        <span className={`text-[10px] px-1.5 py-0.2 rounded font-bold ${
                          isCritical ? 'bg-red-600 text-white' : 'bg-amber-500/30 text-amber-300'
                        }`}>
                          {alert.severity}
                        </span>
                      </div>
                      <p className="text-[11px] leading-relaxed text-slate-300">
                        {alert.description}
                      </p>
                      <div className="pt-1 flex items-center justify-between text-[10px] text-slate-400 font-mono border-t border-white/5">
                        <span>{new Date(alert.timestamp).toLocaleTimeString()}</span>
                        <button
                          onClick={() => resolveAlert(alert.id, 'Resolved from dashboard')}
                          className="text-cyan-400 hover:underline"
                        >
                          Resolve
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Card 2: Simulation console (compact native card below Active alerts) */}
          <SimulationConsole />

        </div>

      </div>
    </div>
  );
};
