/**
 * MineCare - Analytics Page
 * Real Recharts sensor trends and safety metrics from telemetry history.
 */

import React, { useState } from 'react';
import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  ReferenceLine,
  CartesianGrid,
  Legend,
  BarChart,
  Bar
} from 'recharts';
import { 
  Thermometer, 
  Wind, 
  Activity, 
  ShieldCheck
} from 'lucide-react';
import { useTelemetry } from '../../context/TelemetryContext';
import { PROTOTYPE_THRESHOLDS } from '../../types/safety';

export const AnalyticsPage: React.FC = () => {
  const { helmets, selectedHelmetId, setSelectedHelmetId, getTelemetryHistory } = useTelemetry();
  const [timeRange, setTimeRange] = useState<'15m' | '1h' | '6h' | '24h' | '7d'>('1h');

  const helmet = helmets.find(h => h.helmetId === selectedHelmetId) || helmets[0];
  const historyData = helmet ? getTelemetryHistory(helmet.helmetId) : [];

  // Summary safety stats
  const safeCount = helmets.filter(h => h.safety.status === 'SAFE').length;
  const warningCount = helmets.filter(h => h.safety.status === 'WARNING').length;
  const dangerCount = helmets.filter(h => h.safety.status === 'DANGER').length;

  const safetyDistribution = [
    { name: 'Safe', count: safeCount, fill: '#10b981' },
    { name: 'Warning', count: warningCount, fill: '#f59e0b' },
    { name: 'Danger', count: dangerCount, fill: '#ef4444' },
  ];

  return (
    <div className="space-y-6 font-sans">
      {/* Header and Time Filters */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-white tracking-tight">
            Analytics
          </h1>
          <p className="text-xs text-slate-400 mt-1">
            Safety and sensor trends from live simulated telemetry.
          </p>
        </div>

        {/* Time Filter Buttons */}
        <div className="flex items-center space-x-1 bg-[#0c131f] p-1 rounded-lg border border-[#182335] text-xs self-start sm:self-auto font-sans">
          {[
            { id: '15m', label: '15 minutes' },
            { id: '1h', label: '1 hour' },
            { id: '6h', label: '6 hours' },
            { id: '24h', label: '24 hours' },
            { id: '7d', label: '7 days' },
          ].map(t => (
            <button
              key={t.id}
              onClick={() => setTimeRange(t.id as any)}
              className={`px-2.5 py-1 rounded-md transition-colors text-xs ${
                timeRange === t.id
                  ? 'bg-[#182438] text-white font-medium shadow-sm'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>

      {/* Target Helmet Selector Bar */}
      <div className="bg-[#0c131f] border border-[#182335] rounded-xl p-3 flex items-center justify-between">
        <div className="flex items-center space-x-2 text-xs">
          <span className="text-slate-400 font-medium">Inspecting Waveform Telemetry:</span>
          <select
            value={helmet.helmetId}
            onChange={(e) => setSelectedHelmetId(e.target.value)}
            className="bg-[#070b12] border border-[#1e2a3c] rounded-lg px-2.5 py-1 text-xs text-cyan-400 font-mono font-bold focus:outline-none focus:border-cyan-500"
          >
            {helmets.map(h => (
              <option key={h.helmetId} value={h.helmetId}>
                {h.helmetId} — {h.assignedShaft}
              </option>
            ))}
          </select>
        </div>

        <div className="text-[11px] font-mono text-slate-400">
          History Samples: <strong className="text-slate-200">{historyData.length}</strong>
        </div>
      </div>

      {/* Trends Charts Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        
        {/* Chart 1: Temperature & Humidity Trend */}
        <div className="bg-[#0c131f] border border-[#182335] rounded-xl p-4 space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-2 text-xs font-bold text-slate-200 uppercase tracking-wide font-mono">
              <Thermometer className="w-4 h-4 text-amber-400" />
              <span>Temperature & Humidity Trend</span>
            </div>
            <span className="text-[10px] font-mono text-amber-400">Limit: &gt; 40.0°C</span>
          </div>

          <div className="h-60 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={historyData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#151f30" />
                <XAxis dataKey="timeFormatted" stroke="#475569" tick={{ fontSize: 10, fill: '#64748b' }} />
                <YAxis yAxisId="temp" domain={[15, 55]} stroke="#f59e0b" tick={{ fontSize: 10, fill: '#f59e0b' }} />
                <YAxis yAxisId="hum" orientation="right" domain={[30, 90]} stroke="#38bdf8" tick={{ fontSize: 10, fill: '#38bdf8' }} />
                <Tooltip
                  contentStyle={{ backgroundColor: '#090f19', borderColor: '#1e2b40', borderRadius: '8px', fontSize: '11px', fontFamily: 'monospace' }}
                  labelStyle={{ color: '#94a3b8' }}
                />
                <Legend wrapperStyle={{ fontSize: '11px', fontFamily: 'monospace', paddingTop: '4px' }} />
                <ReferenceLine yAxisId="temp" y={PROTOTYPE_THRESHOLDS.highTemperatureThreshold} stroke="#ef4444" strokeDasharray="3 3" />
                <Line yAxisId="temp" type="monotone" dataKey="temperature" name="Temp (°C)" stroke="#f59e0b" strokeWidth={2} dot={false} isAnimationActive={false} />
                <Line yAxisId="hum" type="monotone" dataKey="humidity" name="Humidity (%)" stroke="#38bdf8" strokeWidth={1.5} dot={false} isAnimationActive={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Chart 2: MQ-2 RAW Gas Value Trend */}
        <div className="bg-[#0c131f] border border-[#182335] rounded-xl p-4 space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-2 text-xs font-bold text-slate-200 uppercase tracking-wide font-mono">
              <Wind className="w-4 h-4 text-cyan-400" />
              <span>MQ-2 Gas Sensor Raw Reading (ADC)</span>
            </div>
            <span className="text-[10px] font-mono text-amber-400">Limit: &gt; 800</span>
          </div>

          <div className="h-60 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={historyData} margin={{ top: 10, right: 10, left: -10, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#151f30" />
                <XAxis dataKey="timeFormatted" stroke="#475569" tick={{ fontSize: 10, fill: '#64748b' }} />
                <YAxis domain={[100, 1024]} stroke="#fbbf24" tick={{ fontSize: 10, fill: '#fbbf24' }} />
                <Tooltip
                  contentStyle={{ backgroundColor: '#090f19', borderColor: '#1e2b40', borderRadius: '8px', fontSize: '11px', fontFamily: 'monospace' }}
                  labelStyle={{ color: '#94a3b8' }}
                />
                <Legend wrapperStyle={{ fontSize: '11px', fontFamily: 'monospace', paddingTop: '4px' }} />
                <ReferenceLine y={PROTOTYPE_THRESHOLDS.highGasRawThreshold} stroke="#ef4444" strokeDasharray="3 3" />
                <Line type="monotone" dataKey="rawGasValue" name="GAS (RAW)" stroke="#fbbf24" strokeWidth={2} dot={false} isAnimationActive={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Chart 3: MPU6050 Acceleration Trend */}
        <div className="bg-[#0c131f] border border-[#182335] rounded-xl p-4 space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-2 text-xs font-bold text-slate-200 uppercase tracking-wide font-mono">
              <Activity className="w-4 h-4 text-red-400" />
              <span>Total Acceleration Magnitude (m/s²)</span>
            </div>
            <span className="text-[10px] font-mono text-red-400">Fall Limit: &gt; 15.0 m/s²</span>
          </div>

          <div className="h-60 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={historyData} margin={{ top: 10, right: 10, left: -10, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#151f30" />
                <XAxis dataKey="timeFormatted" stroke="#475569" tick={{ fontSize: 10, fill: '#64748b' }} />
                <YAxis domain={[0, 26]} stroke="#94a3b8" tick={{ fontSize: 10, fill: '#94a3b8' }} />
                <Tooltip
                  contentStyle={{ backgroundColor: '#090f19', borderColor: '#1e2b40', borderRadius: '8px', fontSize: '11px', fontFamily: 'monospace' }}
                  labelStyle={{ color: '#94a3b8' }}
                />
                <Legend wrapperStyle={{ fontSize: '11px', fontFamily: 'monospace', paddingTop: '4px' }} />
                <ReferenceLine y={PROTOTYPE_THRESHOLDS.fallAccelerationThreshold} stroke="#ef4444" strokeDasharray="3 3" />
                <Line type="monotone" dataKey="totalAcceleration" name="ACCEL (m/s²)" stroke="#ef4444" strokeWidth={2} dot={false} isAnimationActive={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Chart 4: Fleet Safety Distribution */}
        <div className="bg-[#0c131f] border border-[#182335] rounded-xl p-4 space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-2 text-xs font-bold text-slate-200 uppercase tracking-wide font-mono">
              <ShieldCheck className="w-4 h-4 text-emerald-400" />
              <span>Fleet Safety Status Breakdown</span>
            </div>
            <span className="text-[10px] font-mono text-slate-400">Total: 16 Helmets</span>
          </div>

          <div className="h-60 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={safetyDistribution} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#151f30" />
                <XAxis dataKey="name" stroke="#64748b" tick={{ fontSize: 11, fill: '#94a3b8' }} />
                <YAxis stroke="#64748b" tick={{ fontSize: 10, fill: '#94a3b8' }} />
                <Tooltip
                  contentStyle={{ backgroundColor: '#090f19', borderColor: '#1e2b40', borderRadius: '8px', fontSize: '11px', fontFamily: 'monospace' }}
                  labelStyle={{ color: '#94a3b8' }}
                />
                <Bar dataKey="count" name="Helmets" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

      </div>
    </div>
  );
};
