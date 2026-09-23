/**
 * MineCare - MineMap Underground Schematic
 *
 * Professional SVG Underground Mine Schematic showing Zone-Based Worker Occupancy.
 *
 * Strictly adheres to:
 * - NO GPS coordinates
 * - NO moving markers
 * - Workers/helmets grouped inside their CURRENT WORK ZONE
 * - Visually distinct zones with real-time status summary
 */

import React, { useState } from 'react';
import { 
  ShieldCheck, 
  AlertTriangle, 
  WifiOff, 
  Layers, 
  ExternalLink,
  Search as SearchIcon
} from 'lucide-react';
import type { ZoneOccupancySummary } from '../../types/zone';
import type { WorkerProfile } from '../../types/worker';
import type { HelmetDevice } from '../../types/helmet';
import { ZoneDetailsDrawer } from './ZoneDetailsDrawer';

interface MineMapProps {
  zoneOccupancies: ZoneOccupancySummary[];
  workers: WorkerProfile[];
  helmets: HelmetDevice[];
  searchQuery: string;
  statusFilter: 'ALL' | 'DANGER' | 'WARNING' | 'SAFE' | 'OFFLINE';
  selectedZoneName: string | null;
  onSelectZone: (zoneName: string | null) => void;
  onInspectHelmet: (helmetId: string) => void;
  onChangeWorkerZone: (helmetId: string, newZone: string) => void;
  onCheckOutWorker: (helmetId: string) => void;
}

export const MineMap: React.FC<MineMapProps> = ({
  zoneOccupancies,
  workers,
  helmets,
  searchQuery,
  statusFilter,
  selectedZoneName,
  onSelectZone,
  onInspectHelmet,
  onChangeWorkerZone,
  onCheckOutWorker,
}) => {
  const [activeDrawerZone, setActiveDrawerZone] = useState<ZoneOccupancySummary | null>(null);

  const searchLower = searchQuery.toLowerCase().trim();

  // Helper to retrieve helmet safety status
  const getWorkerHelmet = (helmetId: string): HelmetDevice | undefined => {
    return helmets.find(h => h.helmetId === helmetId);
  };

  const getWorkerStatus = (helmetId: string): 'SAFE' | 'WARNING' | 'DANGER' | 'OFFLINE' => {
    const helmet = getWorkerHelmet(helmetId);
    if (!helmet || helmet.connectivity === 'OFFLINE') return 'OFFLINE';
    return helmet.safety.status;
  };

  const isWorkerMatchingFilter = (helmetId: string): boolean => {
    if (statusFilter === 'ALL') return true;
    const status = getWorkerStatus(helmetId);
    return status === statusFilter;
  };

  const isWorkerMatchingSearch = (worker: WorkerProfile): boolean => {
    if (!searchLower) return false;
    return (
      worker.name.toLowerCase().includes(searchLower) ||
      worker.assignedHelmetId.toLowerCase().includes(searchLower) ||
      worker.code.toLowerCase().includes(searchLower)
    );
  };

  const isZoneMatchingSearch = (zoneName: string): boolean => {
    if (!searchLower) return false;
    return zoneName.toLowerCase().includes(searchLower);
  };

  const handleOpenZoneDrawer = (summary: ZoneOccupancySummary) => {
    setActiveDrawerZone(summary);
    onSelectZone(summary.zoneName);
  };

  // Checked-out workers (off-shift or not assigned to an active zone)
  const checkedOutWorkers = workers.filter(w => !w.currentWorkZone);

  return (
    <div className="space-y-6 select-none font-sans">
      
      {/* Map Control / Legend Bar */}
      <div className="bg-[#0b121e] border border-[#182538] rounded-xl p-4 flex flex-col md:flex-row items-start md:items-center justify-between gap-3 text-xs">
        <div className="flex items-center space-x-2 text-slate-300">
          <Layers className="w-4 h-4 text-cyan-400" />
          <span className="font-semibold text-white">UNDERGROUND SCHEMATIC</span>
          <span className="text-slate-500">•</span>
          <span className="text-slate-400 text-[11px]">Zone-Based Work Location System (No GPS)</span>
        </div>

        {/* Legend */}
        <div className="flex items-center space-x-4 text-[11px] font-mono">
          <div className="flex items-center space-x-1.5">
            <span className="w-2.5 h-2.5 rounded-full bg-emerald-400 inline-block" />
            <span className="text-slate-300">SAFE</span>
          </div>
          <div className="flex items-center space-x-1.5">
            <span className="w-2.5 h-2.5 rounded-full bg-amber-400 inline-block" />
            <span className="text-slate-300">WARNING</span>
          </div>
          <div className="flex items-center space-x-1.5">
            <span className="w-2.5 h-2.5 rounded-full bg-red-500 ring-2 ring-red-400/50 inline-block" />
            <span className="text-slate-300">DANGER</span>
          </div>
          <div className="flex items-center space-x-1.5">
            <span className="w-2.5 h-2.5 rounded-full bg-slate-500 inline-block" />
            <span className="text-slate-400">OFFLINE</span>
          </div>
        </div>
      </div>

      {/* Main Mine Schematic Layout */}
      <div className="relative bg-[#070b12] border border-[#162234] rounded-2xl p-4 sm:p-6 overflow-hidden">
        
        {/* SVG Underground Infrastructure Blueprint Background */}
        <div className="absolute inset-0 pointer-events-none opacity-25">
          <svg className="w-full h-full" xmlns="http://www.w3.org/2000/svg" preserveAspectRatio="none">
            <defs>
              <pattern id="mineGrid" width="40" height="40" patternUnits="userSpaceOnUse">
                <path d="M 40 0 L 0 0 0 40" fill="none" stroke="#162842" strokeWidth="0.75" />
              </pattern>
            </defs>
            <rect width="100%" height="100%" fill="url(#mineGrid)" />

            {/* Hoist Headframe at top left */}
            <path d="M 60 50 L 100 10 L 140 50 Z" fill="none" stroke="#38bdf8" strokeWidth="1.5" />
            <line x1="100" y1="10" x2="100" y2="1000" stroke="#38bdf8" strokeWidth="2" strokeDasharray="6,4" />
            <line x1="120" y1="50" x2="120" y2="1000" stroke="#0284c7" strokeWidth="1.5" strokeDasharray="3,3" />

            {/* Shaft stations connecting levels */}
            <line x1="100" y1="90" x2="180" y2="90" stroke="#38bdf8" strokeWidth="1.5" />
            <line x1="100" y1="280" x2="180" y2="280" stroke="#38bdf8" strokeWidth="1.5" />
            <line x1="100" y1="470" x2="180" y2="470" stroke="#38bdf8" strokeWidth="1.5" />
            <line x1="100" y1="660" x2="180" y2="660" stroke="#38bdf8" strokeWidth="1.5" />

            {/* Geological Rock strata indicator lines */}
            <path d="M 0 160 Q 300 170 800 150 T 1600 165" fill="none" stroke="#1e293b" strokeWidth="1.5" />
            <path d="M 0 350 Q 400 340 900 360 T 1600 345" fill="none" stroke="#1e293b" strokeWidth="1.5" />
            <path d="M 0 540 Q 300 550 850 535 T 1600 550" fill="none" stroke="#1e293b" strokeWidth="1.5" />
          </svg>
        </div>

        {/* Schematic Content with Vertical Shaft Spine & Zone Chambers */}
        <div className="relative z-10 flex flex-col space-y-6">
          
          {zoneOccupancies.map((zoneSummary, index) => {
            const isSelected = selectedZoneName === zoneSummary.zoneName;
            const zoneMatchesSearch = isZoneMatchingSearch(zoneSummary.zoneName);
            const zoneWorkers = workers.filter(w => w.currentWorkZone === zoneSummary.zoneName);

            // Check if any worker in this zone is in danger or warning
            const hasDanger = zoneSummary.dangerCount > 0;
            const hasWarning = zoneSummary.warningCount > 0;

            return (
              <div 
                key={zoneSummary.zoneId}
                className="flex items-stretch gap-3 sm:gap-6 group"
              >
                {/* Elevation & Shaft Connector Tag (Left Spine) */}
                <div className="w-16 sm:w-24 shrink-0 flex flex-col items-center justify-start pt-3">
                  <div className="px-2 py-1 rounded bg-[#0c1523] border border-[#1b2b40] text-[10px] sm:text-xs font-mono font-bold text-cyan-400 text-center shadow-xs">
                    {zoneSummary.depthMeters} m
                  </div>
                  <div className="text-[10px] font-mono text-slate-500 mt-1 uppercase tracking-wider text-center">
                    {zoneSummary.level}
                  </div>
                  {index < zoneOccupancies.length - 1 && (
                    <div className="w-0.5 flex-1 bg-gradient-to-b from-cyan-500/40 via-cyan-500/20 to-cyan-500/40 my-2" />
                  )}
                </div>

                {/* Zone Chamber Box */}
                <div
                  onClick={() => handleOpenZoneDrawer(zoneSummary)}
                  className={`flex-1 bg-[#0b1320]/90 backdrop-blur-xs border rounded-2xl p-4 sm:p-5 transition-all duration-200 cursor-pointer shadow-lg ${
                    hasDanger
                      ? 'border-red-500/80 bg-red-950/15 ring-1 ring-red-500/30'
                      : hasWarning
                      ? 'border-amber-500/70 bg-amber-950/10'
                      : isSelected || zoneMatchesSearch
                      ? 'border-cyan-400 bg-cyan-950/20 ring-2 ring-cyan-500/40'
                      : 'border-[#19273c] hover:border-[#2a3e5c] hover:bg-[#0e1828]'
                  }`}
                >
                  {/* Zone Header */}
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pb-3.5 border-b border-[#162335]">
                    <div>
                      <div className="flex items-center space-x-2.5">
                        <span className="font-bold text-white text-sm sm:text-base tracking-tight font-sans">
                          {zoneSummary.zoneName}
                        </span>

                        {hasDanger && (
                          <span className="text-[10px] px-2 py-0.5 rounded font-mono font-bold bg-red-600 text-white flex items-center space-x-1 animate-pulse">
                            <AlertTriangle className="w-3 h-3" />
                            <span>HAZARD ACTIVE</span>
                          </span>
                        )}

                        {zoneMatchesSearch && (
                          <span className="text-[10px] px-2 py-0.5 rounded font-mono font-bold bg-cyan-950 border border-cyan-500 text-cyan-300 flex items-center space-x-1">
                            <SearchIcon className="w-2.5 h-2.5" />
                            <span>MATCH</span>
                          </span>
                        )}
                      </div>
                      <p className="text-[11px] text-slate-400 mt-0.5">
                        {zoneSummary.description}
                      </p>
                    </div>

                    {/* Zone Summary Metrics Badge */}
                    <div className="flex items-center space-x-1.5 self-start sm:self-auto font-mono text-[11px]">
                      <div className="px-2.5 py-1 rounded-lg bg-[#070d17] border border-[#18273c] text-slate-200 font-bold">
                        {zoneSummary.workerCount} {zoneSummary.workerCount === 1 ? 'WORKER' : 'WORKERS'}
                      </div>

                      <div className="px-2 py-1 rounded bg-[#0b241b] border border-[#164e3b] text-emerald-300 font-bold flex items-center space-x-1">
                        <ShieldCheck className="w-3 h-3 text-emerald-400" />
                        <span>{zoneSummary.safeCount}</span>
                      </div>

                      <div className="px-2 py-1 rounded bg-[#291b07] border border-[#78350f] text-amber-300 font-bold flex items-center space-x-1">
                        <AlertTriangle className="w-3 h-3 text-amber-400" />
                        <span>{zoneSummary.warningCount}</span>
                      </div>

                      <div className="px-2 py-1 rounded bg-[#2d0f12] border border-[#7f1d1d] text-red-300 font-bold flex items-center space-x-1">
                        <AlertTriangle className="w-3 h-3 text-red-400" />
                        <span>{zoneSummary.dangerCount}</span>
                      </div>

                      <div className="px-2 py-1 rounded bg-[#141c28] border border-[#233349] text-slate-400 font-bold flex items-center space-x-1">
                        <WifiOff className="w-3 h-3" />
                        <span>{zoneSummary.offlineCount}</span>
                      </div>
                    </div>
                  </div>

                  {/* Workers Currently Checked Into This Zone */}
                  <div className="pt-3.5 space-y-2">
                    <div className="text-[10px] font-mono uppercase tracking-wider text-slate-400 font-semibold flex items-center justify-between">
                      <span>CHECKED-IN WORKERS & HELMETS</span>
                      <span className="text-slate-500 group-hover:text-cyan-400 flex items-center space-x-1 transition text-[11px]">
                        <span>Click zone for details</span>
                        <ExternalLink className="w-3 h-3" />
                      </span>
                    </div>

                    {zoneWorkers.length === 0 ? (
                      <div className="py-4 text-center text-xs text-slate-500 italic bg-[#080e18]/50 rounded-lg border border-dashed border-[#162335]">
                        No workers currently checked in to {zoneSummary.zoneName}
                      </div>
                    ) : (
                      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-2">
                        {zoneWorkers.map((worker) => {
                          const status = getWorkerStatus(worker.assignedHelmetId);
                          const isDanger = status === 'DANGER';
                          const isWarning = status === 'WARNING';
                          const isOffline = status === 'OFFLINE';
                          const matchesFilter = isWorkerMatchingFilter(worker.assignedHelmetId);
                          const matchesSearch = isWorkerMatchingSearch(worker);

                          return (
                            <div
                              key={worker.workerId}
                              onClick={(e) => {
                                e.stopPropagation();
                                onInspectHelmet(worker.assignedHelmetId);
                              }}
                              className={`p-2 rounded-lg border text-xs flex items-center justify-between gap-2 transition-all cursor-pointer ${
                                !matchesFilter
                                  ? 'opacity-25 grayscale border-[#162335] bg-[#090f19]'
                                  : isDanger
                                  ? 'bg-red-950/40 border-red-500 text-red-200 shadow-[0_0_12px_rgba(239,68,68,0.25)] ring-1 ring-red-400'
                                  : isWarning
                                  ? 'bg-amber-950/30 border-amber-500/70 text-amber-200'
                                  : matchesSearch
                                  ? 'bg-cyan-950/40 border-cyan-400 text-cyan-200 ring-1 ring-cyan-400'
                                  : 'bg-[#0e1726] border-[#1c2a3e] hover:border-cyan-500/50 hover:bg-[#131f32] text-slate-200'
                              }`}
                              title={`Click to inspect ${worker.name} (${worker.assignedHelmetId})`}
                            >
                              <div className="flex items-center space-x-2 min-w-0">
                                {/* Status Indicator Dot */}
                                <span 
                                  className={`w-2 h-2 rounded-full shrink-0 ${
                                    isOffline
                                      ? 'bg-slate-500'
                                      : isDanger
                                      ? 'bg-red-500 ring-2 ring-red-400 animate-pulse'
                                      : isWarning
                                      ? 'bg-amber-400'
                                      : 'bg-emerald-400'
                                  }`}
                                />

                                <div className="truncate">
                                  <div className="font-mono font-bold text-[11px] text-white flex items-center space-x-1">
                                    <span>{worker.assignedHelmetId}</span>
                                    {isDanger && (
                                      <span className="text-[9px] px-1 rounded bg-red-600 text-white font-sans font-bold">
                                        HAZARD
                                      </span>
                                    )}
                                  </div>
                                  <div className="text-[11px] text-slate-300 truncate">
                                    {worker.name}
                                  </div>
                                </div>
                              </div>

                              <div className="text-[10px] font-mono text-slate-400 shrink-0 uppercase">
                                {isOffline ? 'OFF' : status}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            );
          })}

          {/* Checked Out / Off-Shift Workers Section */}
          {checkedOutWorkers.length > 0 && (
            <div className="pt-2">
              <div className="bg-[#0b121e]/80 border border-dashed border-[#1c2c42] rounded-xl p-3.5 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
                <div className="text-xs text-slate-400">
                  <span className="font-mono font-bold text-slate-300">
                    {checkedOutWorkers.length} {checkedOutWorkers.length === 1 ? 'WORKER' : 'WORKERS'} CHECKED OUT
                  </span>
                  <span className="text-slate-500 mx-2">•</span>
                  <span>Not active in any underground mine zone (off-shift / surface dispatch)</span>
                </div>

                <div className="flex flex-wrap gap-1.5">
                  {checkedOutWorkers.map(w => (
                    <button
                      key={w.workerId}
                      onClick={() => onInspectHelmet(w.assignedHelmetId)}
                      className="px-2 py-1 rounded bg-[#101928] border border-[#1c293c] text-slate-400 text-[11px] font-mono hover:text-slate-200 transition cursor-pointer"
                    >
                      {w.assignedHelmetId} · {w.name}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}

        </div>
      </div>

      {/* Zone Details Drawer */}
      <ZoneDetailsDrawer
        zoneSummary={activeDrawerZone}
        workers={workers}
        helmets={helmets}
        onClose={() => setActiveDrawerZone(null)}
        onInspectHelmet={onInspectHelmet}
        onChangeWorkerZone={onChangeWorkerZone}
        onCheckOutWorker={onCheckOutWorker}
      />
    </div>
  );
};
