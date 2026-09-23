/**
 * MineCare - Workers Page
 * Matching Lovable reference screenshot 5 & 6 (clean 16-worker status table).
 */

import React from 'react';
import { useTelemetry } from '../../context/TelemetryContext';
import { INITIAL_WORKERS } from '../../data/mockData';

interface WorkersPageProps {
  onInspectHelmet: (helmetId: string) => void;
}

export const WorkersPage: React.FC<WorkersPageProps> = ({ onInspectHelmet }) => {
  const { helmets } = useTelemetry();

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-white tracking-tight">
          Workers
        </h1>
        <p className="text-xs text-slate-400 mt-1">
          Each worker is assigned one helmet. Status reflects the latest telemetry frame.
        </p>
      </div>

      {/* Workers Table */}
      <div className="bg-[#0c131f] border border-[#182335] rounded-xl overflow-x-auto shadow-sm">
        <table className="w-full text-left text-xs font-sans">
          <thead className="bg-[#090f19] text-slate-400 border-b border-[#182335] text-[11px] font-medium">
            <tr>
              <th className="py-3.5 px-4">Worker</th>
              <th className="py-3.5 px-4 font-mono">Code</th>
              <th className="py-3.5 px-4">Role</th>
              <th className="py-3.5 px-4 text-center">Shift</th>
              <th className="py-3.5 px-4">Zone</th>
              <th className="py-3.5 px-4 font-mono">Helmet</th>
              <th className="py-3.5 px-4 text-right">Status</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[#151f30] text-slate-200">
            {INITIAL_WORKERS.map((worker) => {
              const helmet = helmets.find(h => h.helmetId === worker.assignedHelmetId);
              const safetyStatus = helmet?.safety.status || 'SAFE';
              const isOffline = helmet?.connectivity === 'OFFLINE';

              return (
                <tr 
                  key={worker.workerId}
                  className="hover:bg-[#111a2a] transition-colors"
                >
                  <td className="py-3.5 px-4 font-medium text-slate-100">
                    {worker.name}
                  </td>
                  <td className="py-3.5 px-4 text-slate-400 font-mono text-[11px]">
                    {worker.code}
                  </td>
                  <td className="py-3.5 px-4 text-slate-300">
                    {worker.role}
                  </td>
                  <td className="py-3.5 px-4 text-center text-slate-300 font-mono">
                    {worker.shift}
                  </td>
                  <td className="py-3.5 px-4 text-slate-400">
                    {worker.zone}
                  </td>
                  <td className="py-3.5 px-4">
                    <button
                      onClick={() => onInspectHelmet(worker.assignedHelmetId)}
                      className="font-mono text-sky-400 hover:text-sky-300 hover:underline font-semibold"
                    >
                      {worker.assignedHelmetId}
                    </button>
                  </td>
                  <td className="py-3.5 px-4 text-right">
                    <div className="inline-flex justify-end">
                      {isOffline ? (
                        <span className="bg-[#18202c] border border-[#2b394e] text-slate-400 text-[10px] font-bold px-2 py-0.5 rounded-full flex items-center space-x-1 font-mono">
                          <span>•</span>
                          <span>OFFLINE</span>
                        </span>
                      ) : safetyStatus === 'DANGER' ? (
                        <span className="bg-[#2d0f12] border border-[#7f1d1d] text-[#f87171] text-[10px] font-bold px-2 py-0.5 rounded-full flex items-center space-x-1 font-mono animate-pulse">
                          <span>•</span>
                          <span>DANGER</span>
                        </span>
                      ) : safetyStatus === 'WARNING' ? (
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
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
};
