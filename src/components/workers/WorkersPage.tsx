/**
 * MineCare - Workers Page
 * Displays worker registry with Assigned Zone, Current Work Zone, Check-in status, and Supervisor actions.
 */

import React, { useState } from 'react';
import { 
  LogIn, 
  ArrowRightLeft, 
  LogOut, 
  Clock, 
  ShieldCheck, 
  AlertTriangle, 
  WifiOff 
} from 'lucide-react';
import { useTelemetry } from '../../context/TelemetryContext';
import { WorkerCheckInModal } from './WorkerCheckInModal';

interface WorkersPageProps {
  onInspectHelmet: (helmetId: string) => void;
}

export const WorkersPage: React.FC<WorkersPageProps> = ({ onInspectHelmet }) => {
  const { 
    helmets, 
    workers, 
    checkInWorker, 
    checkOutWorker, 
    changeWorkerZone 
  } = useTelemetry();

  const [checkInModalOpen, setCheckInModalOpen] = useState(false);
  const [selectedKioskHelmetId, setSelectedKioskHelmetId] = useState<string | null>(null);

  const openKioskForWorker = (helmetId: string) => {
    setSelectedKioskHelmetId(helmetId);
    setCheckInModalOpen(true);
  };

  return (
    <div className="space-y-6 select-none font-sans">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-white tracking-tight">
            Workers & Zone Ledger
          </h1>
          <p className="text-xs text-slate-400 mt-1">
            Worker profiles, assigned default zones, and live checked-in work zones.
          </p>
        </div>

        {/* Worker Check-In / Out Kiosk Button */}
        <button
          onClick={() => {
            setSelectedKioskHelmetId(null);
            setCheckInModalOpen(true);
          }}
          className="px-4 py-2 rounded-xl bg-cyan-500 hover:bg-cyan-400 text-slate-950 text-xs font-bold font-mono tracking-wider flex items-center space-x-2 transition self-start sm:self-auto shadow-md shadow-cyan-950/40 cursor-pointer"
        >
          <LogIn className="w-4 h-4" />
          <span>WORKER CHECK-IN / OUT</span>
        </button>
      </div>

      {/* Workers Table */}
      <div className="bg-[#0c131f] border border-[#182335] rounded-xl overflow-x-auto shadow-sm">
        <table className="w-full text-left text-xs font-sans">
          <thead className="bg-[#090f19] text-slate-400 border-b border-[#182335] text-[11px] font-medium font-mono">
            <tr>
              <th className="py-3.5 px-4 font-sans">Worker</th>
              <th className="py-3.5 px-4">Code</th>
              <th className="py-3.5 px-4 font-sans">Role</th>
              <th className="py-3.5 px-4 text-center">Shift</th>
              <th className="py-3.5 px-4 font-sans">Assigned Zone</th>
              <th className="py-3.5 px-4 font-sans">Current Work Zone</th>
              <th className="py-3.5 px-4">Helmet</th>
              <th className="py-3.5 px-4 text-center">Safety Status</th>
              <th className="py-3.5 px-4 text-right font-sans">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[#151f30] text-slate-200">
            {workers.map((worker) => {
              const helmet = helmets.find(h => h.helmetId === worker.assignedHelmetId);
              const safetyStatus = helmet?.safety.status || 'SAFE';
              const isOffline = helmet?.connectivity === 'OFFLINE';
              const isCheckedIn = Boolean(worker.currentWorkZone);

              return (
                <tr 
                  key={worker.workerId}
                  className="hover:bg-[#111a2a] transition-colors"
                >
                  {/* Worker Name */}
                  <td className="py-3.5 px-4 font-medium text-slate-100">
                    <div>{worker.name}</div>
                    {worker.checkInTime && isCheckedIn && (
                      <div className="text-[10px] text-slate-500 font-mono flex items-center space-x-1 mt-0.5">
                        <Clock className="w-2.5 h-2.5" />
                        <span>In: {new Date(worker.checkInTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                      </div>
                    )}
                  </td>

                  {/* Code */}
                  <td className="py-3.5 px-4 text-slate-400 font-mono text-[11px]">
                    {worker.code}
                  </td>

                  {/* Role */}
                  <td className="py-3.5 px-4 text-slate-300">
                    {worker.role}
                  </td>

                  {/* Shift */}
                  <td className="py-3.5 px-4 text-center text-slate-300 font-mono">
                    {worker.shift}
                  </td>

                  {/* Assigned Zone (Default Scheduled) */}
                  <td className="py-3.5 px-4 text-slate-400">
                    <span className="text-slate-300">{worker.assignedZone}</span>
                  </td>

                  {/* Current Work Zone (Live Checked In) */}
                  <td className="py-3.5 px-4">
                    {isCheckedIn ? (
                      <span className="inline-flex items-center space-x-1.5 px-2 py-0.5 rounded-md bg-[#0e1d2c] border border-cyan-800/50 text-cyan-300 font-medium text-[11px]">
                        <span className="w-1.5 h-1.5 rounded-full bg-cyan-400 animate-pulse" />
                        <span>{worker.currentWorkZone}</span>
                      </span>
                    ) : (
                      <span className="inline-flex items-center space-x-1 px-2 py-0.5 rounded-md bg-[#161a22] text-slate-500 font-mono text-[10px]">
                        <span>Checked Out</span>
                      </span>
                    )}
                  </td>

                  {/* Helmet ID */}
                  <td className="py-3.5 px-4">
                    <button
                      onClick={() => onInspectHelmet(worker.assignedHelmetId)}
                      className="font-mono text-cyan-400 hover:text-cyan-300 hover:underline font-semibold cursor-pointer"
                    >
                      {worker.assignedHelmetId}
                    </button>
                  </td>

                  {/* Safety Status */}
                  <td className="py-3.5 px-4 text-center">
                    <div className="inline-flex justify-center">
                      {isOffline ? (
                        <span className="bg-[#18202c] border border-[#2b394e] text-slate-400 text-[10px] font-bold px-2 py-0.5 rounded-full flex items-center space-x-1 font-mono">
                          <WifiOff className="w-2.5 h-2.5" />
                          <span>OFFLINE</span>
                        </span>
                      ) : safetyStatus === 'DANGER' ? (
                        <span className="bg-[#2d0f12] border border-[#7f1d1d] text-[#f87171] text-[10px] font-bold px-2 py-0.5 rounded-full flex items-center space-x-1 font-mono animate-pulse">
                          <AlertTriangle className="w-2.5 h-2.5" />
                          <span>DANGER</span>
                        </span>
                      ) : safetyStatus === 'WARNING' ? (
                        <span className="bg-[#291b07] border border-[#78350f] text-[#fbbf24] text-[10px] font-bold px-2 py-0.5 rounded-full flex items-center space-x-1 font-mono">
                          <AlertTriangle className="w-2.5 h-2.5" />
                          <span>WARNING</span>
                        </span>
                      ) : (
                        <span className="bg-[#0b241b] border border-[#164e3b] text-[#34d399] text-[10px] font-bold px-2 py-0.5 rounded-full flex items-center space-x-1 font-mono">
                          <ShieldCheck className="w-2.5 h-2.5" />
                          <span>SAFE</span>
                        </span>
                      )}
                    </div>
                  </td>

                  {/* Actions */}
                  <td className="py-3.5 px-4 text-right">
                    <div className="inline-flex items-center space-x-1.5">
                      <button
                        onClick={() => openKioskForWorker(worker.assignedHelmetId)}
                        className="px-2 py-1 rounded bg-[#131f30] hover:bg-[#1a2c44] text-amber-300 text-[11px] font-medium flex items-center space-x-1 transition cursor-pointer"
                        title="Change worker current work zone"
                      >
                        <ArrowRightLeft className="w-3 h-3" />
                        <span>Change Zone</span>
                      </button>

                      {isCheckedIn ? (
                        <button
                          onClick={() => checkOutWorker(worker.assignedHelmetId)}
                          className="px-2 py-1 rounded bg-[#1d1416] hover:bg-[#2c1c20] text-rose-300 text-[11px] font-medium flex items-center space-x-1 transition cursor-pointer"
                          title="Check out worker from mine zone"
                        >
                          <LogOut className="w-3 h-3" />
                          <span>Check Out</span>
                        </button>
                      ) : (
                        <button
                          onClick={() => openKioskForWorker(worker.assignedHelmetId)}
                          className="px-2 py-1 rounded bg-[#0e221b] hover:bg-[#153429] text-emerald-300 text-[11px] font-medium flex items-center space-x-1 transition cursor-pointer"
                          title="Check in worker to a mine zone"
                        >
                          <LogIn className="w-3 h-3" />
                          <span>Check In</span>
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Kiosk Modal */}
      <WorkerCheckInModal
        isOpen={checkInModalOpen}
        onClose={() => setCheckInModalOpen(false)}
        workers={workers}
        initialHelmetId={selectedKioskHelmetId}
        onCheckIn={checkInWorker}
        onCheckOut={checkOutWorker}
        onChangeZone={changeWorkerZone}
      />
    </div>
  );
};
