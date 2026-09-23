/**
 * MineCare - Zone Details Drawer
 * Displays comprehensive zone occupancy summary and worker ledger when a zone is selected.
 */

import React, { useState } from 'react';
import { 
  X, 
  ShieldCheck, 
  AlertTriangle, 
  WifiOff, 
  Clock, 
  Battery, 
  ArrowRightLeft, 
  LogOut,
  Layers,
  MapPin
} from 'lucide-react';
import type { ZoneOccupancySummary } from '../../types/zone';
import type { WorkerProfile } from '../../types/worker';
import type { HelmetDevice } from '../../types/helmet';
import { INITIAL_MINE_ZONES } from '../../types/zone';

interface ZoneDetailsDrawerProps {
  zoneSummary: ZoneOccupancySummary | null;
  workers: WorkerProfile[];
  helmets: HelmetDevice[];
  onClose: () => void;
  onInspectHelmet: (helmetId: string) => void;
  onChangeWorkerZone: (helmetId: string, newZone: string) => void;
  onCheckOutWorker: (helmetId: string) => void;
}

export const ZoneDetailsDrawer: React.FC<ZoneDetailsDrawerProps> = ({
  zoneSummary,
  workers,
  helmets,
  onClose,
  onInspectHelmet,
  onChangeWorkerZone,
  onCheckOutWorker,
}) => {
  const [reassigningHelmetId, setReassigningHelmetId] = useState<string | null>(null);

  if (!zoneSummary) return null;

  // Workers checked into this zone
  const zoneWorkers = workers.filter(w => w.currentWorkZone === zoneSummary.zoneName);

  const getHelmetStatus = (helmetId: string) => {
    const helmet = helmets.find(h => h.helmetId === helmetId);
    if (!helmet || helmet.connectivity === 'OFFLINE') return 'OFFLINE';
    return helmet.safety.status;
  };

  const handleSelectNewZone = (helmetId: string, targetZone: string) => {
    onChangeWorkerZone(helmetId, targetZone);
    setReassigningHelmetId(null);
  };

  return (
    <div 
      className="fixed inset-0 z-40 bg-black/70 backdrop-blur-xs flex justify-end transition-opacity"
      onClick={onClose}
    >
      <div 
        className="w-full max-w-lg bg-[#0a101b] border-l border-[#1a2638] h-full flex flex-col shadow-2xl text-slate-100 overflow-hidden font-sans"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Drawer Header */}
        <div className="p-4 bg-[#080d16] border-b border-[#182335] flex items-center justify-between">
          <div className="flex items-center space-x-3">
            <div className="w-9 h-9 rounded-lg bg-cyan-950/80 border border-cyan-500/40 flex items-center justify-center text-cyan-400">
              <Layers className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center space-x-2">
                <span className="font-bold text-white text-base tracking-tight">{zoneSummary.zoneName}</span>
                <span className="text-[10px] px-2 py-0.5 rounded font-mono font-bold bg-[#142032] border border-[#23354f] text-cyan-300">
                  {zoneSummary.level} · {zoneSummary.depthMeters}m
                </span>
              </div>
              <p className="text-xs text-slate-400 mt-0.5 line-clamp-1">
                {zoneSummary.description}
              </p>
            </div>
          </div>

          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-[#152030] transition cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Scrollable Content */}
        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          
          {/* Zone Occupancy Metric Cards */}
          <div className="bg-[#0c1422] border border-[#1a2638] rounded-xl p-3.5 space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center space-x-1.5 text-xs font-mono uppercase text-slate-400 font-semibold tracking-wider">
                <MapPin className="w-3.5 h-3.5 text-cyan-400" />
                <span>ZONE OCCUPANCY SUMMARY</span>
              </div>
              <span className="text-xs font-mono font-bold text-slate-200">
                {zoneSummary.workerCount} Workers Checked In
              </span>
            </div>

            {/* Status Breakdown Grid */}
            <div className="grid grid-cols-4 gap-2 text-center">
              <div className="bg-[#0b241b]/60 border border-[#164e3b] rounded-lg p-2">
                <div className="flex items-center justify-center space-x-1 text-emerald-400 text-[10px] font-mono font-bold">
                  <ShieldCheck className="w-3 h-3" />
                  <span>SAFE</span>
                </div>
                <div className="text-lg font-bold text-emerald-300 font-mono mt-0.5">
                  {zoneSummary.safeCount}
                </div>
              </div>

              <div className="bg-[#291b07]/60 border border-[#78350f] rounded-lg p-2">
                <div className="flex items-center justify-center space-x-1 text-amber-400 text-[10px] font-mono font-bold">
                  <AlertTriangle className="w-3 h-3" />
                  <span>WARN</span>
                </div>
                <div className="text-lg font-bold text-amber-300 font-mono mt-0.5">
                  {zoneSummary.warningCount}
                </div>
              </div>

              <div className="bg-[#2d0f12]/60 border border-[#7f1d1d] rounded-lg p-2">
                <div className="flex items-center justify-center space-x-1 text-red-400 text-[10px] font-mono font-bold">
                  <AlertTriangle className="w-3 h-3" />
                  <span>DANGER</span>
                </div>
                <div className="text-lg font-bold text-red-400 font-mono mt-0.5">
                  {zoneSummary.dangerCount}
                </div>
              </div>

              <div className="bg-[#141b27]/60 border border-[#26354b] rounded-lg p-2">
                <div className="flex items-center justify-center space-x-1 text-slate-400 text-[10px] font-mono font-bold">
                  <WifiOff className="w-3 h-3" />
                  <span>OFFLINE</span>
                </div>
                <div className="text-lg font-bold text-slate-300 font-mono mt-0.5">
                  {zoneSummary.offlineCount}
                </div>
              </div>
            </div>
          </div>

          {/* Workers in this Zone */}
          <div className="space-y-2.5">
            <div className="flex items-center justify-between text-xs text-slate-400 font-medium px-1">
              <span>WORKERS IN THIS ZONE ({zoneWorkers.length})</span>
              <span className="text-[11px] font-mono text-slate-500">Live Status</span>
            </div>

            {zoneWorkers.length === 0 ? (
              <div className="bg-[#0c1422] border border-[#182335] rounded-xl p-8 text-center text-xs text-slate-400">
                No workers are currently checked into this zone.
              </div>
            ) : (
              <div className="space-y-2">
                {zoneWorkers.map((worker) => {
                  const status = getHelmetStatus(worker.assignedHelmetId);
                  const isDanger = status === 'DANGER';
                  const isWarning = status === 'WARNING';
                  const isOffline = status === 'OFFLINE';
                  const isReassigning = reassigningHelmetId === worker.assignedHelmetId;

                  return (
                    <div
                      key={worker.workerId}
                      className={`bg-[#0c1422] border rounded-xl p-3 transition-colors ${
                        isDanger
                          ? 'border-red-500/80 bg-red-950/20'
                          : isWarning
                          ? 'border-amber-500/60 bg-amber-950/15'
                          : 'border-[#182335] hover:border-[#23354f]'
                      }`}
                    >
                      <div className="flex items-start justify-between">
                        <div>
                          <div className="flex items-center space-x-2">
                            <span className="font-mono font-bold text-white text-xs">
                              {worker.assignedHelmetId}
                            </span>
                            <span className="text-slate-500">•</span>
                            <span className="text-xs font-semibold text-slate-100">
                              {worker.name}
                            </span>
                          </div>
                          <div className="text-[11px] text-slate-400 mt-0.5 flex items-center space-x-2">
                            <span>{worker.role}</span>
                            <span>•</span>
                            <span className="flex items-center space-x-1">
                              <Battery className="w-3 h-3 text-slate-400" />
                              <span>{worker.battery}%</span>
                            </span>
                          </div>
                        </div>

                        {/* Status Badge */}
                        <div>
                          {isOffline ? (
                            <span className="bg-[#18202c] border border-[#2b394e] text-slate-400 text-[10px] font-bold px-2 py-0.5 rounded-full flex items-center space-x-1 font-mono">
                              <span>•</span>
                              <span>OFFLINE</span>
                            </span>
                          ) : isDanger ? (
                            <span className="bg-[#2d0f12] border border-[#7f1d1d] text-[#f87171] text-[10px] font-bold px-2 py-0.5 rounded-full flex items-center space-x-1 font-mono">
                              <span>•</span>
                              <span>DANGER</span>
                            </span>
                          ) : isWarning ? (
                            <span className="bg-[#291b07] border border-[#78350f] text-[#fbbf24] text-[10px] font-bold px-2 py-0.5 rounded-full flex items-center space-x-1 font-mono">
                              <span>•</span>
                              <span>WARNING</span>
                            </span>
                          ) : (
                            <span className="bg-[#0b241b] border border-[#164e3b] text-[#34d399] text-[10px] font-bold px-2 py-0.5 rounded-full flex items-center space-x-1 font-mono">
                              <span>•</span>
                              <span>SAFE</span>
                            </span>
                          )}
                        </div>
                      </div>

                      {/* Check-In Timestamp */}
                      <div className="mt-2 pt-2 border-t border-[#162132] flex items-center justify-between text-[11px] text-slate-400 font-mono">
                        <span className="flex items-center space-x-1 text-slate-500">
                          <Clock className="w-3 h-3" />
                          <span>
                            {worker.checkInTime ? new Date(worker.checkInTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '06:00 AM'}
                          </span>
                        </span>

                        <div className="flex items-center space-x-2">
                          <button
                            onClick={() => onInspectHelmet(worker.assignedHelmetId)}
                            className="px-2 py-1 rounded bg-[#131f30] hover:bg-[#1b2b42] text-cyan-400 text-[11px] font-medium transition cursor-pointer"
                          >
                            View Helmet
                          </button>

                          <button
                            onClick={() => setReassigningHelmetId(isReassigning ? null : worker.assignedHelmetId)}
                            className="px-2 py-1 rounded bg-[#131f30] hover:bg-[#1b2b42] text-amber-300 text-[11px] font-medium flex items-center space-x-1 transition cursor-pointer"
                          >
                            <ArrowRightLeft className="w-3 h-3" />
                            <span>Change Zone</span>
                          </button>

                          <button
                            onClick={() => onCheckOutWorker(worker.assignedHelmetId)}
                            className="px-2 py-1 rounded bg-[#1f1618] hover:bg-[#2b1f22] text-rose-300 text-[11px] font-medium flex items-center space-x-1 transition cursor-pointer"
                            title="Check out worker from mine zone"
                          >
                            <LogOut className="w-3 h-3" />
                            <span>Check Out</span>
                          </button>
                        </div>
                      </div>

                      {/* Supervisor Zone Reassignment Menu */}
                      {isReassigning && (
                        <div className="mt-3 p-2.5 bg-[#080d16] border border-[#22334c] rounded-lg space-y-2">
                          <div className="text-[10px] font-mono uppercase text-amber-300 font-semibold tracking-wider">
                            SUPERVISOR: ASSIGN NEW WORK ZONE
                          </div>
                          <div className="grid grid-cols-2 gap-1.5">
                            {INITIAL_MINE_ZONES.map(z => (
                              <button
                                key={z.id}
                                disabled={z.name === zoneSummary.zoneName}
                                onClick={() => handleSelectNewZone(worker.assignedHelmetId, z.name)}
                                className={`text-[11px] p-1.5 rounded text-left truncate transition ${
                                  z.name === zoneSummary.zoneName
                                    ? 'bg-[#152030] text-slate-500 cursor-not-allowed'
                                    : 'bg-[#111c2c] hover:bg-[#18283e] text-slate-200 cursor-pointer'
                                }`}
                              >
                                {z.name}
                              </button>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
