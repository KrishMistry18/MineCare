/**
 * MineCare - Worker Check-In & Check-Out Kiosk Modal
 *
 * Allows workers or supervisors to:
 * - Select an assigned helmet/worker
 * - Select target work zone (Portal/Surface, Level 1, Level 2, Level 3)
 * - Check in (records timestamp, sets currentWorkZone)
 * - Check out (clears currentWorkZone, records checkOutTime)
 */

import React, { useState } from 'react';
import { 
  X, 
  HardHat, 
  MapPin, 
  LogIn, 
  LogOut, 
  CheckCircle2, 
  Clock, 
  Building2, 
  Mountain, 
  Compass 
} from 'lucide-react';
import type { WorkerProfile } from '../../types/worker';
import type { MineZone } from '../../types/zone';
import { INITIAL_MINE_ZONES } from '../../types/zone';

interface WorkerCheckInModalProps {
  isOpen: boolean;
  onClose: () => void;
  workers: WorkerProfile[];
  initialHelmetId?: string | null;
  onCheckIn: (helmetId: string, zoneName: string) => boolean;
  onCheckOut: (helmetId: string) => boolean;
  onChangeZone: (helmetId: string, newZone: string, updateDefault?: boolean) => boolean;
}

export const WorkerCheckInModal: React.FC<WorkerCheckInModalProps> = ({
  isOpen,
  onClose,
  workers,
  initialHelmetId,
  onCheckIn,
  onCheckOut,
  onChangeZone,
}) => {
  const [selectedHelmetId, setSelectedHelmetId] = useState<string>(
    initialHelmetId || workers[0]?.assignedHelmetId || 'MC-001'
  );
  const [selectedZone, setSelectedZone] = useState<string>('Level 1 — North Drift');
  const [updateDefaultAssignment, setUpdateDefaultAssignment] = useState<boolean>(false);
  const [lastActionMessage, setLastActionMessage] = useState<{ text: string; type: 'success' | 'info' } | null>(null);

  if (!isOpen) return null;

  const currentWorker = workers.find(w => w.assignedHelmetId === selectedHelmetId) || workers[0];
  const isCheckedIn = Boolean(currentWorker?.currentWorkZone);

  const handleCheckInSubmit = () => {
    if (!currentWorker) return;
    if (updateDefaultAssignment) {
      onChangeZone(currentWorker.assignedHelmetId, selectedZone, true);
    } else {
      onCheckIn(currentWorker.assignedHelmetId, selectedZone);
    }
    setLastActionMessage({
      text: `${currentWorker.name} (${currentWorker.assignedHelmetId}) checked in to ${selectedZone} at ${new Date().toLocaleTimeString()}`,
      type: 'success',
    });
  };

  const handleCheckOutSubmit = () => {
    if (!currentWorker) return;
    onCheckOut(currentWorker.assignedHelmetId);
    setLastActionMessage({
      text: `${currentWorker.name} (${currentWorker.assignedHelmetId}) checked out at ${new Date().toLocaleTimeString()}`,
      type: 'info',
    });
  };

  const getZoneIcon = (zone: MineZone) => {
    if (zone.id === 'portal-surface') return Building2;
    if (zone.id === 'level-1-north-drift') return Mountain;
    if (zone.id === 'level-2-south-panel') return Compass;
    return MapPin;
  };

  return (
    <div 
      className="fixed inset-0 z-50 bg-black/80 backdrop-blur-xs flex items-center justify-center p-4 font-sans"
      onClick={onClose}
    >
      <div 
        className="bg-[#0b121e] border border-[#1e2a3c] rounded-2xl w-full max-w-xl shadow-2xl overflow-hidden text-slate-100"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="p-4 bg-[#080d16] border-b border-[#182335] flex items-center justify-between">
          <div className="flex items-center space-x-3">
            <div className="w-9 h-9 rounded-lg bg-cyan-950/80 border border-cyan-500/40 flex items-center justify-center text-cyan-400">
              <HardHat className="w-5 h-5" />
            </div>
            <div>
              <h2 className="font-bold text-white text-base tracking-tight">
                WORKER CHECK-IN & ZONE ASSIGNMENT
              </h2>
              <p className="text-xs text-slate-400 mt-0.5">
                Zone-Based Location Ledger · No Continuous GPS
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

        {/* Form Body */}
        <div className="p-6 space-y-5">
          
          {/* Action Notification Banner */}
          {lastActionMessage && (
            <div className={`p-3 rounded-xl border text-xs flex items-center space-x-2 ${
              lastActionMessage.type === 'success'
                ? 'bg-emerald-950/30 border-emerald-500/60 text-emerald-200'
                : 'bg-cyan-950/30 border-cyan-500/60 text-cyan-200'
            }`}>
              <CheckCircle2 className="w-4 h-4 shrink-0" />
              <span>{lastActionMessage.text}</span>
            </div>
          )}

          {/* Worker / Helmet Selection */}
          <div className="space-y-1.5">
            <label className="text-xs font-mono uppercase tracking-wider text-slate-400 font-semibold">
              Select Assigned Helmet & Worker
            </label>
            <select
              value={selectedHelmetId}
              onChange={(e) => {
                setSelectedHelmetId(e.target.value);
                setLastActionMessage(null);
              }}
              className="w-full bg-[#080d17] border border-[#1d2b40] rounded-xl px-3.5 py-2.5 text-xs text-slate-200 font-mono focus:outline-none focus:border-cyan-500"
            >
              {workers.map((w) => (
                <option key={w.workerId} value={w.assignedHelmetId}>
                  {w.assignedHelmetId} — {w.name} ({w.role}) · {w.currentWorkZone ? `Checked in: ${w.currentWorkZone}` : 'Checked out'}
                </option>
              ))}
            </select>
          </div>

          {/* Current Worker Status Summary Card */}
          {currentWorker && (
            <div className="p-3.5 bg-[#080e18] border border-[#162335] rounded-xl text-xs space-y-2">
              <div className="flex items-center justify-between">
                <div>
                  <span className="font-bold text-white text-sm">{currentWorker.name}</span>
                  <span className="text-slate-400 ml-2 font-mono">({currentWorker.code})</span>
                </div>
                <span className="text-[11px] text-slate-400">{currentWorker.role} · Shift {currentWorker.shift}</span>
              </div>

              <div className="grid grid-cols-2 gap-2 pt-1 font-mono text-[11px]">
                <div className="bg-[#0e1624] p-2 rounded-lg border border-[#1c293c]">
                  <span className="text-slate-500 block text-[10px] uppercase">Assigned Default Zone</span>
                  <span className="text-slate-200 font-semibold">{currentWorker.assignedZone}</span>
                </div>

                <div className="bg-[#0e1624] p-2 rounded-lg border border-[#1c293c]">
                  <span className="text-slate-500 block text-[10px] uppercase">Current Work Zone</span>
                  {isCheckedIn ? (
                    <span className="text-emerald-400 font-semibold flex items-center space-x-1">
                      <span className="w-2 h-2 rounded-full bg-emerald-400 inline-block animate-pulse" />
                      <span>{currentWorker.currentWorkZone}</span>
                    </span>
                  ) : (
                    <span className="text-slate-400 italic">Checked Out (Off-Shift)</span>
                  )}
                </div>
              </div>

              {currentWorker.checkInTime && isCheckedIn && (
                <div className="text-[10px] text-slate-400 flex items-center space-x-1 font-mono pt-1">
                  <Clock className="w-3 h-3 text-slate-500" />
                  <span>Checked in at: {new Date(currentWorker.checkInTime).toLocaleTimeString()}</span>
                </div>
              )}
            </div>
          )}

          {/* Zone Selection Buttons */}
          <div className="space-y-2">
            <label className="text-xs font-mono uppercase tracking-wider text-slate-400 font-semibold">
              Select Work Zone
            </label>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
              {INITIAL_MINE_ZONES.map((zone) => {
                const isSelected = selectedZone === zone.name;
                const Icon = getZoneIcon(zone);

                return (
                  <button
                    key={zone.id}
                    type="button"
                    onClick={() => setSelectedZone(zone.name)}
                    className={`p-3 rounded-xl border text-left flex items-start space-x-3 transition-all cursor-pointer ${
                      isSelected
                        ? 'bg-cyan-950/40 border-cyan-400 text-white shadow-[0_0_12px_rgba(56,189,248,0.15)] ring-1 ring-cyan-500'
                        : 'bg-[#080e18] border-[#182638] text-slate-300 hover:border-[#273b54] hover:bg-[#0c1422]'
                    }`}
                  >
                    <div className={`p-2 rounded-lg shrink-0 ${isSelected ? 'bg-cyan-500 text-slate-900' : 'bg-[#101928] text-slate-400'}`}>
                      <Icon className="w-4 h-4" />
                    </div>

                    <div className="min-w-0">
                      <div className="font-semibold text-xs truncate">
                        {zone.name}
                      </div>
                      <div className="text-[10px] font-mono text-slate-400 mt-0.5">
                        {zone.level} · {zone.depthMeters}m
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Supervisor Option to Update Scheduled Default Zone */}
          <div className="flex items-center space-x-2 pt-1 text-xs text-slate-400">
            <input
              type="checkbox"
              id="updateDefaultZone"
              checked={updateDefaultAssignment}
              onChange={(e) => setUpdateDefaultAssignment(e.target.checked)}
              className="rounded bg-[#0c1422] border-[#1e2a3c] text-cyan-500 focus:ring-0 cursor-pointer"
            />
            <label htmlFor="updateDefaultZone" className="cursor-pointer select-none">
              Supervisor override: Also update permanent scheduled zone assignment
            </label>
          </div>

          {/* Action Buttons: CHECK IN & CHECK OUT */}
          <div className="pt-3 border-t border-[#182335] flex items-center justify-between gap-3">
            <button
              type="button"
              disabled={!isCheckedIn}
              onClick={handleCheckOutSubmit}
              className={`px-4 py-2.5 rounded-xl text-xs font-semibold flex items-center space-x-2 transition ${
                isCheckedIn
                  ? 'bg-[#1e1315] hover:bg-[#2b181b] border border-rose-900/60 text-rose-300 cursor-pointer'
                  : 'bg-[#131720] text-slate-600 border border-[#1a2130] cursor-not-allowed'
              }`}
            >
              <LogOut className="w-4 h-4" />
              <span>CHECK OUT</span>
            </button>

            <div className="flex items-center space-x-2">
              <button
                type="button"
                onClick={onClose}
                className="px-4 py-2.5 rounded-xl bg-[#101826] hover:bg-[#162234] text-xs font-medium text-slate-300 transition cursor-pointer"
              >
                Close
              </button>

              <button
                type="button"
                onClick={handleCheckInSubmit}
                className="px-5 py-2.5 rounded-xl bg-cyan-500 hover:bg-cyan-400 text-slate-950 text-xs font-bold font-mono tracking-wider flex items-center space-x-2 transition shadow-md shadow-cyan-950 cursor-pointer"
              >
                <LogIn className="w-4 h-4" />
                <span>CHECK IN</span>
              </button>
            </div>
          </div>

        </div>
      </div>
    </div>
  );
};
