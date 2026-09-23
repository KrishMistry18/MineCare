/**
 * MineCare - Individual Helmet Telemetry Modal
 * Opens when clicking on any helmet card or link.
 */

import React from 'react';
import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  ReferenceLine,
  CartesianGrid
} from 'recharts';
import { 
  X, 
  Wind, 
  Activity, 
  HardHat
} from 'lucide-react';
import { useTelemetry } from '../../context/TelemetryContext';
import { INITIAL_WORKERS } from '../../data/mockData';
import { PROTOTYPE_THRESHOLDS } from '../../types/safety';

interface TelemetryModalProps {
  helmetId: string | null;
  onClose: () => void;
}

export const TelemetryModal: React.FC<TelemetryModalProps> = ({ helmetId, onClose }) => {
  const { helmets, getTelemetryHistory } = useTelemetry();

  if (!helmetId) return null;

  const helmet = helmets.find(h => h.helmetId === helmetId);
  const worker = INITIAL_WORKERS.find(w => w.assignedHelmetId === helmetId);
  const historyData = getTelemetryHistory(helmetId).slice(-40);

  if (!helmet) return null;

  const { telemetry, safety } = helmet;

  return (
    <div 
      className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div 
        className="bg-[#0c131f] border border-[#1e2a3c] rounded-2xl w-full max-w-4xl max-h-[90vh] flex flex-col shadow-2xl overflow-hidden font-sans"
        onClick={(e) => e.stopPropagation()}
      >
        
        {/* Header */}
        <div className="p-4 bg-[#090f19] border-b border-[#182335] flex items-center justify-between">
          <div className="flex items-center space-x-3">
            <div className="w-9 h-9 rounded-lg bg-cyan-950/80 border border-cyan-500/40 flex items-center justify-center text-cyan-400">
              <HardHat className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center space-x-2">
                <span className="font-bold text-white font-mono text-base">{helmet.helmetId}</span>
                <span className="text-slate-500">•</span>
                <span className="text-sm text-slate-300 font-medium">{worker?.name}</span>
                <span className="text-slate-500">•</span>
                <span className="text-xs text-slate-400">{worker?.role}</span>
              </div>
              <div className="text-xs text-slate-400 mt-0.5">
                {helmet.assignedShaft} · Battery {worker?.battery}% · RSSI {telemetry.rssi} dBm
              </div>
            </div>
          </div>

          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-[#152030] transition cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Modal Body */}
        <div className="p-4 overflow-y-auto space-y-4">
          
          {/* Quick Metrics Bar */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div className="p-3 rounded-lg bg-[#070b12] border border-[#162234]">
              <div className="text-[10px] font-mono text-slate-400 uppercase">TEMP (DHT22)</div>
              <div className={`text-lg font-bold font-mono mt-0.5 ${telemetry.dht22.temperature > 40 ? 'text-amber-400' : 'text-slate-100'}`}>
                {telemetry.dht22.temperature.toFixed(1)} °C
              </div>
            </div>

            <div className="p-3 rounded-lg bg-[#070b12] border border-[#162234]">
              <div className="text-[10px] font-mono text-slate-400 uppercase">HUMIDITY</div>
              <div className="text-lg font-bold font-mono text-slate-100 mt-0.5">
                {Math.round(telemetry.dht22.humidity)} %
              </div>
            </div>

            <div className="p-3 rounded-lg bg-[#070b12] border border-[#162234]">
              <div className="text-[10px] font-mono text-slate-400 uppercase">GAS (RAW ADC)</div>
              <div className={`text-lg font-bold font-mono mt-0.5 ${telemetry.mq2.rawGasValue > 800 ? 'text-amber-400' : 'text-slate-100'}`}>
                {telemetry.mq2.rawGasValue}
              </div>
            </div>

            <div className="p-3 rounded-lg bg-[#070b12] border border-[#162234]">
              <div className="text-[10px] font-mono text-slate-400 uppercase">ACCEL (MPU6050)</div>
              <div className={`text-lg font-bold font-mono mt-0.5 ${telemetry.mpu6050.totalAcceleration > 15 ? 'text-red-400' : 'text-slate-100'}`}>
                {telemetry.mpu6050.totalAcceleration.toFixed(1)} m/s²
              </div>
            </div>
          </div>

          {/* Actuator Outputs Confirmation */}
          <div className="p-3 rounded-lg bg-[#070b12] border border-[#162234] flex items-center justify-between text-xs font-mono">
            <span className="text-slate-400">HARDWARE ACTUATOR STATES:</span>
            <div className="flex items-center space-x-2">
              <span className={`px-2 py-0.5 rounded ${safety.outputs.greenLed ? 'bg-emerald-500/20 text-emerald-300 font-bold border border-emerald-500/40' : 'text-slate-600'}`}>
                GRN LED (D0): {safety.outputs.greenLed ? 'ON' : 'OFF'}
              </span>
              <span className={`px-2 py-0.5 rounded ${safety.outputs.redLed ? 'bg-red-500/20 text-red-300 font-bold border border-red-500/40' : 'text-slate-600'}`}>
                RED LED (D4): {safety.outputs.redLed ? 'ON' : 'OFF'}
              </span>
              <span className={`px-2 py-0.5 rounded ${safety.outputs.buzzer ? 'bg-red-600 text-white font-extrabold animate-bounce' : 'text-slate-600'}`}>
                BUZZER (D3): {safety.outputs.buzzer ? 'SOUNDING' : 'OFF'}
              </span>
            </div>
          </div>

          {/* Live Waveform 1: Micro-Climate & Gas */}
          <div className="bg-[#070b12] border border-[#162234] rounded-xl p-3.5 space-y-2">
            <div className="text-xs font-bold text-slate-200 font-mono flex items-center space-x-2">
              <Wind className="w-3.5 h-3.5 text-cyan-400" />
              <span>Atmospheric Gas Concentration Trend (0-1023 ADC)</span>
            </div>
            <div className="h-48 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={historyData} margin={{ top: 5, right: 10, left: -10, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#151f30" />
                  <XAxis dataKey="timeFormatted" stroke="#475569" tick={{ fontSize: 9, fill: '#64748b' }} />
                  <YAxis domain={[100, 1024]} stroke="#fbbf24" tick={{ fontSize: 9, fill: '#fbbf24' }} />
                  <Tooltip contentStyle={{ backgroundColor: '#090f19', borderColor: '#1e2b40', fontSize: '10px' }} />
                  <ReferenceLine y={PROTOTYPE_THRESHOLDS.highGasRawThreshold} stroke="#ef4444" strokeDasharray="3 3" />
                  <Line type="monotone" dataKey="rawGasValue" name="GAS (RAW)" stroke="#fbbf24" strokeWidth={2} dot={false} isAnimationActive={false} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </div>

          {/* Live Waveform 2: Acceleration & Fall Vector */}
          <div className="bg-[#070b12] border border-[#162234] rounded-xl p-3.5 space-y-2">
            <div className="text-xs font-bold text-slate-200 font-mono flex items-center space-x-2">
              <Activity className="w-3.5 h-3.5 text-red-400" />
              <span>MPU6050 Total Resultant Acceleration (m/s²)</span>
            </div>
            <div className="h-48 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={historyData} margin={{ top: 5, right: 10, left: -10, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#151f30" />
                  <XAxis dataKey="timeFormatted" stroke="#475569" tick={{ fontSize: 9, fill: '#64748b' }} />
                  <YAxis domain={[0, 26]} stroke="#94a3b8" tick={{ fontSize: 9, fill: '#94a3b8' }} />
                  <Tooltip contentStyle={{ backgroundColor: '#090f19', borderColor: '#1e2b40', fontSize: '10px' }} />
                  <ReferenceLine y={PROTOTYPE_THRESHOLDS.fallAccelerationThreshold} stroke="#ef4444" strokeDasharray="3 3" />
                  <Line type="monotone" dataKey="totalAcceleration" name="ACCEL (m/s²)" stroke="#ef4444" strokeWidth={2} dot={false} isAnimationActive={false} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </div>

        </div>

        {/* Modal Footer */}
        <div className="p-3 bg-[#090f19] border-t border-[#182335] flex items-center justify-between text-xs text-slate-400">
          <span className="text-[11px] font-mono">
            Status: <strong className="text-white">{safety.status}</strong> · Threshold logic: PROTOTYPE
          </span>
          <button
            onClick={onClose}
            className="px-4 py-1.5 bg-[#182438] hover:bg-[#22334e] text-slate-200 rounded-lg text-xs font-medium transition cursor-pointer"
          >
            Close
          </button>
        </div>

      </div>
    </div>
  );
};
