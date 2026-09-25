/**
 * MineCare - Compact Simulation Console
 * Integrated natively on the Dashboard right-hand panel.
 * Matching Lovable reference exactly without covering the UI.
 */

import React, { useState } from 'react';
import { Cpu } from 'lucide-react';
import { useTelemetry } from '../../context/TelemetryContext';
import type { ScenarioType } from '../../types/telemetry';

export const SimulationConsole: React.FC = () => {
  const { helmets, triggerScenario } = useTelemetry();
  const [selectedHelmetId, setSelectedHelmetId] = useState<string>('MC-001');
  const [selectedScenario, setSelectedScenario] = useState<ScenarioType>('HIGH_GAS');
  const [isTriggered, setIsTriggered] = useState<boolean>(false);
  const [activeScenarios, setActiveScenarios] = useState<Record<string, ScenarioType>>({
    'MC-001': 'SAFE',
  });

  const scenarios: { type: ScenarioType; label: string; caption: string; badgeColor: string }[] = [
    { type: 'SAFE', label: 'Normal / Safe', caption: 'All sensor readings within prototype safe baseline thresholds.', badgeColor: 'border-emerald-500/40 text-emerald-400 bg-emerald-950/40' },
    { type: 'HIGH_TEMPERATURE', label: 'High temperature', caption: 'DHT22 temperature climbs past 40°C prototype limit.', badgeColor: 'border-amber-500/40 text-amber-400 bg-amber-950/40' },
    { type: 'HIGH_GAS', label: 'High gas', caption: 'MQ-2 raw value climbs past 800.', badgeColor: 'border-amber-500/40 text-amber-400 bg-amber-950/40' },
    { type: 'FALL_DETECTED', label: 'Fall detected', caption: 'Total acceleration exceeds 15.0 m/s² prototype threshold.', badgeColor: 'border-rose-500/40 text-rose-400 bg-rose-950/40' },
    { type: 'SOS_ACTIVATED', label: 'SOS activated', caption: 'Worker emergency push button pressed.', badgeColor: 'border-rose-500/40 text-rose-400 bg-rose-950/40' },
    { type: 'MULTIPLE_ALERTS', label: 'Multiple compound alerts', caption: 'Simultaneous severe gas accumulation and SOS push button.', badgeColor: 'border-rose-500/40 text-rose-400 bg-rose-950/40' },
    { type: 'HELMET_OFFLINE', label: 'Helmet offline', caption: 'Drops heartbeat packets, triggering an offline timeout alert.', badgeColor: 'border-slate-500/40 text-slate-400 bg-slate-900/60' },
    { type: 'RECOVERY', label: 'Recovery', caption: 'Normalizes sensor parameters and restores SAFE baseline status.', badgeColor: 'border-cyan-500/40 text-cyan-400 bg-cyan-950/40' },
  ];

  const currentScenarioObj = scenarios.find(s => s.type === selectedScenario) || scenarios[2];
  const activeScenarioType = activeScenarios[selectedHelmetId] || 'SAFE';
  const activeScenarioObj = scenarios.find(s => s.type === activeScenarioType) || scenarios[0];

  const handleRun = () => {
    triggerScenario(selectedScenario, selectedHelmetId);
    setActiveScenarios(prev => ({
      ...prev,
      [selectedHelmetId]: selectedScenario === 'RECOVERY' ? 'SAFE' : selectedScenario,
    }));
    setIsTriggered(true);
    setTimeout(() => setIsTriggered(false), 1400);
  };

  return (
    <div className="bg-[#0c131f] border border-[#182335] rounded-xl p-4 space-y-3 font-sans">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <div className="flex items-center space-x-2">
            <Cpu className="w-4 h-4 text-cyan-400" />
            <h3 className="font-bold text-slate-100 text-sm">
              Simulation console
            </h3>
          </div>
          <p className="text-xs text-slate-400 mt-0.5">
            Drives the mock telemetry source only. No hardware is connected.
          </p>
        </div>
        {/* Active scenario status badge */}
        <div className="flex flex-col items-end">
          <span className="text-[10px] text-slate-400 uppercase font-mono tracking-wider">Active</span>
          <span className={`text-[10px] font-mono px-2 py-0.5 rounded border font-semibold ${activeScenarioObj.badgeColor}`}>
            {activeScenarioObj.label}
          </span>
        </div>
      </div>

      {/* Selectors Row */}
      <div className="grid grid-cols-2 gap-2 pt-1">
        {/* Helmet Picker */}
        <div>
          <label className="block text-[10px] font-mono text-slate-400 mb-1">Target Helmet</label>
          <select
            value={selectedHelmetId}
            onChange={(e) => setSelectedHelmetId(e.target.value)}
            className="w-full bg-[#070b12] border border-[#1b273b] rounded-lg px-2.5 py-1.5 text-xs text-slate-200 focus:outline-none focus:border-cyan-500 font-mono"
          >
            {helmets.map(h => (
              <option key={h.helmetId} value={h.helmetId}>
                {h.helmetId} ({h.safety.status})
              </option>
            ))}
          </select>
        </div>

        {/* Scenario Picker */}
        <div>
          <label className="block text-[10px] font-mono text-slate-400 mb-1">Select Scenario</label>
          <select
            value={selectedScenario}
            onChange={(e) => setSelectedScenario(e.target.value as ScenarioType)}
            className="w-full bg-[#070b12] border border-[#1b273b] rounded-lg px-2.5 py-1.5 text-xs text-slate-200 focus:outline-none focus:border-cyan-500"
          >
            {scenarios.map(s => (
              <option key={s.type} value={s.type}>
                {s.label}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Run Scenario Button */}
      <div className="pt-1 flex items-center justify-between gap-3">
        <button
          onClick={handleRun}
          className={`w-full sm:w-auto px-4 py-1.5 text-white text-xs font-medium rounded-lg transition-colors cursor-pointer ${
            isTriggered 
              ? 'bg-emerald-600 hover:bg-emerald-500' 
              : 'bg-[#0284c7] hover:bg-[#0369a1]'
          }`}
        >
          {isTriggered ? `Triggered on ${selectedHelmetId}` : `Run scenario on ${selectedHelmetId}`}
        </button>
        <span className="text-[11px] text-slate-400 font-mono hidden sm:inline">
          Target: <strong className="text-slate-200">{selectedHelmetId}</strong>
        </span>
      </div>

      {/* Scenario Explanatory Caption */}
      <div className="text-[11px] text-slate-400 font-mono pt-0.5">
        {currentScenarioObj.caption}
      </div>
    </div>
  );
};
