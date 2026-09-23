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

  const scenarios: { type: ScenarioType; label: string; caption: string }[] = [
    { type: 'SAFE', label: 'Normal / Safe', caption: 'All sensor readings within prototype safe baseline thresholds.' },
    { type: 'HIGH_TEMPERATURE', label: 'High temperature', caption: 'DHT22 temperature climbs past 40°C prototype limit.' },
    { type: 'HIGH_GAS', label: 'High gas', caption: 'MQ-2 raw value climbs past 800.' },
    { type: 'FALL_DETECTED', label: 'Fall detected', caption: 'Total acceleration exceeds 15.0 m/s² prototype threshold.' },
    { type: 'SOS_ACTIVATED', label: 'SOS activated', caption: 'Worker emergency push button pressed.' },
    { type: 'MULTIPLE_ALERTS', label: 'Multiple compound alerts', caption: 'Simultaneous severe gas accumulation and SOS push button.' },
    { type: 'HELMET_OFFLINE', label: 'Helmet offline', caption: 'Drops heartbeat packets, triggering an offline timeout alert.' },
    { type: 'RECOVERY', label: 'Recovery', caption: 'Normalizes sensor parameters and restores SAFE baseline status.' },
  ];

  const currentScenarioObj = scenarios.find(s => s.type === selectedScenario) || scenarios[2];

  const handleRun = () => {
    triggerScenario(selectedScenario, selectedHelmetId);
    setIsTriggered(true);
    setTimeout(() => setIsTriggered(false), 1400);
  };

  return (
    <div className="bg-[#0c131f] border border-[#182335] rounded-xl p-4 space-y-3 font-sans">
      {/* Header */}
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

      {/* Selectors Row */}
      <div className="grid grid-cols-2 gap-2 pt-1">
        {/* Helmet Picker */}
        <select
          value={selectedHelmetId}
          onChange={(e) => setSelectedHelmetId(e.target.value)}
          className="bg-[#070b12] border border-[#1b273b] rounded-lg px-2.5 py-1.5 text-xs text-slate-200 focus:outline-none focus:border-cyan-500 font-mono"
        >
          {helmets.map(h => (
            <option key={h.helmetId} value={h.helmetId}>
              {h.helmetId}
            </option>
          ))}
        </select>

        {/* Scenario Picker */}
        <select
          value={selectedScenario}
          onChange={(e) => setSelectedScenario(e.target.value as ScenarioType)}
          className="bg-[#070b12] border border-[#1b273b] rounded-lg px-2.5 py-1.5 text-xs text-slate-200 focus:outline-none focus:border-cyan-500"
        >
          {scenarios.map(s => (
            <option key={s.type} value={s.type}>
              {s.label}
            </option>
          ))}
        </select>
      </div>

      {/* Run Scenario Button */}
      <div className="pt-1">
        <button
          onClick={handleRun}
          className={`w-full sm:w-auto px-4 py-1.5 text-white text-xs font-medium rounded-lg transition-colors cursor-pointer ${
            isTriggered 
              ? 'bg-emerald-600 hover:bg-emerald-500' 
              : 'bg-[#0284c7] hover:bg-[#0369a1]'
          }`}
        >
          {isTriggered ? 'Scenario active' : 'Run scenario'}
        </button>
      </div>

      {/* Scenario Explanatory Caption */}
      <div className="text-[11px] text-slate-400 font-mono pt-0.5">
        {currentScenarioObj.caption}
      </div>
    </div>
  );
};
