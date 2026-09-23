/**
 * MineCare - Individual Smart Helmet Telemetry Card
 * Matching Lovable reference design 1:1.
 */

import React from 'react';
import { 
  Thermometer, 
  Droplets, 
  Wind, 
  Activity, 
  Battery
} from 'lucide-react';
import type { HelmetDevice } from '../../types/helmet';
import { INITIAL_WORKERS } from '../../data/mockData';

interface HelmetCardProps {
  helmet: HelmetDevice;
  onClick?: (helmetId: string) => void;
}

export const HelmetCard: React.FC<HelmetCardProps> = ({ helmet, onClick }) => {
  const worker = INITIAL_WORKERS.find(w => w.assignedHelmetId === helmet.helmetId);
  const { telemetry, safety, connectivity } = helmet;

  const isDanger = safety.status === 'DANGER';
  const isWarning = safety.status === 'WARNING';
  const isOffline = connectivity === 'OFFLINE';

  const batteryPercent = worker ? `${worker.battery}%` : '70%';

  return (
    <div
      onClick={() => onClick && onClick(helmet.helmetId)}
      className={`bg-[#0c131f] border rounded-xl p-4 space-y-3.5 transition-all duration-150 cursor-pointer ${
        isDanger
          ? 'border-red-500/70 bg-red-950/10 shadow-[0_0_15px_rgba(239,68,68,0.1)]'
          : isWarning
          ? 'border-amber-500/60 bg-amber-950/10'
          : 'border-[#182335] hover:border-[#283850]'
      }`}
    >
      {/* Top Row: Helmet ID, Worker, Status Badge */}
      <div className="flex items-start justify-between">
        <div>
          <div className="font-bold text-slate-100 text-sm font-mono tracking-tight">
            {helmet.helmetId}
          </div>
          <div className="text-xs text-slate-400 mt-0.5">
            {worker?.name} · {worker?.role}
          </div>
        </div>

        <div>
          {isOffline ? (
            <span className="bg-[#18202c] border border-[#2b394e] text-slate-400 text-[10px] font-bold px-2 py-0.5 rounded-full flex items-center space-x-1 font-mono">
              <span>•</span>
              <span>OFFLINE</span>
            </span>
          ) : isDanger ? (
            <span className="bg-[#2d0f12] border border-[#7f1d1d] text-[#f87171] text-[10px] font-bold px-2 py-0.5 rounded-full flex items-center space-x-1 font-mono animate-pulse">
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

      {/* 2x2 Sensor Metrics Grid */}
      <div className="grid grid-cols-2 gap-y-3 gap-x-4 pt-1">
        {/* Metric 1: TEMP */}
        <div>
          <div className="flex items-center space-x-1 text-[10px] font-mono text-slate-400 uppercase tracking-wider">
            <Thermometer className="w-3 h-3 text-slate-400" />
            <span>TEMP</span>
          </div>
          <div className={`text-base font-bold font-mono mt-0.5 ${telemetry.dht22.temperature > 40 ? 'text-amber-400' : 'text-slate-100'}`}>
            {telemetry.dht22.temperature > -100 ? `${telemetry.dht22.temperature.toFixed(1)} °C` : 'N/A'}
          </div>
        </div>

        {/* Metric 2: HUMIDITY */}
        <div>
          <div className="flex items-center space-x-1 text-[10px] font-mono text-slate-400 uppercase tracking-wider">
            <Droplets className="w-3 h-3 text-slate-400" />
            <span>HUMIDITY</span>
          </div>
          <div className="text-base font-bold font-mono text-slate-100 mt-0.5">
            {telemetry.dht22.humidity > -100 ? `${Math.round(telemetry.dht22.humidity)} %` : 'N/A'}
          </div>
        </div>

        {/* Metric 3: GAS (RAW) */}
        <div>
          <div className="flex items-center space-x-1 text-[10px] font-mono text-slate-400 uppercase tracking-wider">
            <Wind className="w-3 h-3 text-slate-400" />
            <span>GAS (RAW)</span>
          </div>
          <div className={`text-base font-bold font-mono mt-0.5 ${telemetry.mq2.rawGasValue > 800 ? 'text-amber-400' : 'text-slate-100'}`}>
            {telemetry.mq2.rawGasValue}
          </div>
        </div>

        {/* Metric 4: ACCEL */}
        <div>
          <div className="flex items-center space-x-1 text-[10px] font-mono text-slate-400 uppercase tracking-wider">
            <Activity className="w-3 h-3 text-slate-400" />
            <span>ACCEL</span>
          </div>
          <div className={`text-base font-bold font-mono mt-0.5 ${telemetry.mpu6050.totalAcceleration > 15 ? 'text-red-400 font-extrabold' : 'text-slate-100'}`}>
            {telemetry.mpu6050.totalAcceleration.toFixed(1)} m/s²
          </div>
        </div>
      </div>

      {/* Footer: Mine Zone & Battery */}
      <div className="border-t border-[#162132] pt-2.5 flex items-center justify-between text-xs text-slate-400 font-sans">
        <span className="truncate max-w-[170px] text-[11px]">
          {helmet.assignedShaft}
        </span>
        <div className="flex items-center space-x-1 text-[11px] font-mono text-slate-400">
          <Battery className="w-3.5 h-3.5" />
          <span>{batteryPercent}</span>
        </div>
      </div>
    </div>
  );
};
