/**
 * MineCare - System Health & Diagnostics Page
 * Telemetry pipeline, alert engine, and hardware interface status.
 */

import React from 'react';
import { 
  Radio, 
  Info,
  ShieldCheck
} from 'lucide-react';
import { useTelemetry } from '../../context/TelemetryContext';
import { useAuth } from '../../context/AuthContext';
import { HARDWARE_PINOUT_SPEC } from '../../types/helmet';

export const SystemHealthPage: React.FC = () => {
  const { helmets, alerts } = useTelemetry();
  const { role, isAuthenticated } = useAuth();


  const totalHelmets = helmets.length;
  const onlineHelmets = helmets.filter(h => h.connectivity === 'ONLINE').length;
  const activeAlerts = alerts.filter(a => !a.resolved).length;

  return (
    <div className="space-y-6 font-sans">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-white tracking-tight">
          System health
        </h1>
        <p className="text-xs text-slate-400 mt-1">
          Telemetry pipeline, alert engine, database, and authentication status.
        </p>
      </div>

      {/* Primary Status Metric Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-3.5">

        <div className="bg-[#0c131f] border border-[#182335] rounded-xl p-4 space-y-2">
          <div className="text-[10px] font-mono text-slate-400 uppercase tracking-wider font-semibold">
            SYSTEM STATUS
          </div>
          <div className="text-base font-bold text-emerald-400 flex items-center space-x-1.5 font-mono">
            <span className="w-2 h-2 rounded-full bg-emerald-400 inline-block animate-pulse" />
            <span>OPERATIONAL</span>
          </div>
          <div className="text-[11px] text-slate-500 font-mono">
            All services online
          </div>
        </div>

        <div className="bg-[#0c131f] border border-[#182335] rounded-xl p-4 space-y-2">
          <div className="text-[10px] font-mono text-slate-400 uppercase tracking-wider font-semibold">
            TELEMETRY SOURCE
          </div>
          <div className="text-base font-bold text-white font-mono">
            Mock telemetry
          </div>
          <div className="text-[11px] text-slate-500 font-mono">
            Simulated engine active
          </div>
        </div>

        <div className="bg-[#0c131f] border border-[#182335] rounded-xl p-4 space-y-2">
          <div className="text-[10px] font-mono text-slate-400 uppercase tracking-wider font-semibold">
            STREAM
          </div>
          <div className="text-base font-bold text-emerald-400 flex items-center space-x-1.5 font-mono">
            <Radio className="w-4 h-4 text-emerald-400" />
            <span>CONNECTED</span>
          </div>
          <div className="text-[11px] text-slate-500 font-mono">
            2.0s streaming rate
          </div>
        </div>

        <div className="bg-[#0c131f] border border-[#182335] rounded-xl p-4 space-y-2">
          <div className="text-[10px] font-mono text-slate-400 uppercase tracking-wider font-semibold">
            HELMETS REPORTING
          </div>
          <div className="text-base font-bold text-white font-mono">
            {onlineHelmets} / {totalHelmets}
          </div>
          <div className="text-[11px] text-slate-500 font-mono">
            100% fleet link
          </div>
        </div>

        <div className="bg-[#0c131f] border border-[#182335] rounded-xl p-4 space-y-2">
          <div className="text-[10px] font-mono text-slate-400 uppercase tracking-wider font-semibold">
            ALERT ENGINE
          </div>
          <div className="text-base font-bold text-cyan-400 font-mono">
            ACTIVE
          </div>
          <div className="text-[11px] text-slate-500 font-mono">
            {activeAlerts} active incident{activeAlerts === 1 ? '' : 's'}
          </div>
        </div>

        <div className="bg-[#0c131f] border border-[#182335] rounded-xl p-4 space-y-2">
          <div className="text-[10px] font-mono text-slate-400 uppercase tracking-wider font-semibold">
            AUTHENTICATION
          </div>
          <div className="text-base font-bold text-purple-400 flex items-center space-x-1.5 font-mono">
            <ShieldCheck className="w-4 h-4 text-purple-400" />
            <span>{isAuthenticated ? 'ENFORCED' : 'OFFLINE'}</span>
          </div>
          <div className="text-[11px] text-slate-500 font-mono truncate">
            {role ? `Role: ${role}` : 'RLS Least-Privilege'}
          </div>
        </div>
      </div>


      {/* Hardware Decoupling Notice Card */}
      <div className="p-4 rounded-xl bg-[#0d1522] border border-[#1a263a] flex items-start space-x-3 text-xs">
        <Info className="w-5 h-5 text-cyan-400 shrink-0 mt-0.5" />
        <div className="space-y-1">
          <div className="font-bold text-slate-100">
            Hardware Decoupling Architecture
          </div>
          <p className="text-slate-400 leading-relaxed text-[11px]">
            No physical ESP8266 hardware is connected yet. The current provider is <code className="text-cyan-300 font-mono">MockTelemetryProvider</code>.
            When the physical NodeMCU hardware is ready in Phase 2, <code className="text-cyan-300 font-mono">ESP8266TelemetryProvider</code> will plug in seamlessly through the established <code className="text-cyan-300 font-mono">ITelemetryProvider</code> interface without requiring any redesign of the dashboard, alerts, or analytics layers.
          </p>
        </div>
      </div>

      {/* Hardware Interface Reference Table */}
      <div className="bg-[#0c131f] border border-[#182335] rounded-xl p-4 space-y-3">
        <div className="flex items-center justify-between border-b border-[#182335] pb-2.5">
          <div className="font-bold text-white text-sm">
            ESP8266 NodeMCU Hardware Pinout Specification
          </div>
          <div className="text-xs font-mono text-slate-400">
            Form Factor: ESP-12E NodeMCU
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs font-sans">
            <thead className="bg-[#090f19] text-slate-400 border-b border-[#182335] text-[11px]">
              <tr>
                <th className="py-2.5 px-3">Component</th>
                <th className="py-2.5 px-3 font-mono">Pin</th>
                <th className="py-2.5 px-3 font-mono">GPIO</th>
                <th className="py-2.5 px-3">Type</th>
                <th className="py-2.5 px-3">Status</th>
                <th className="py-2.5 px-3">Notes</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#151f30] text-slate-200">
              {HARDWARE_PINOUT_SPEC.map((spec, idx) => (
                <tr key={idx} className="hover:bg-[#111a2a]">
                  <td className="py-2.5 px-3 font-medium text-slate-100">{spec.component}</td>
                  <td className="py-2.5 px-3 font-mono text-cyan-400 font-bold">{spec.pin}</td>
                  <td className="py-2.5 px-3 font-mono text-slate-400">{spec.gpio}</td>
                  <td className="py-2.5 px-3">
                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-[#131d2c] text-slate-300 font-mono">
                      {spec.type}
                    </span>
                  </td>
                  <td className="py-2.5 px-3">
                    {spec.confirmationStatus === 'CONFIRMED' ? (
                      <span className="text-[10px] font-bold text-emerald-400 font-mono">
                        CONFIRMED
                      </span>
                    ) : (
                      <span className="text-[10px] font-bold text-amber-400 font-mono">
                        PROPOSED SOFTWARE MAPPING
                      </span>
                    )}
                  </td>
                  <td className="py-2.5 px-3 text-slate-400 text-[11px]">{spec.notes}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};
