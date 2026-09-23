/**
 * MineCare - Zone Occupancy Dashboard Widget
 *
 * Displays live worker occupancy across all 4 mine zones.
 * Allows supervisors to click any zone to navigate directly to the filtered mine map.
 */

import React from 'react';
import { 
  Layers, 
  ArrowRight, 
  ShieldCheck, 
  AlertTriangle, 
  WifiOff, 
  Users 
} from 'lucide-react';
import type { ZoneOccupancySummary } from '../../types/zone';

interface ZoneOccupancyWidgetProps {
  zoneOccupancies: ZoneOccupancySummary[];
  onNavigateToZoneMap: (zoneName?: string) => void;
}

export const ZoneOccupancyWidget: React.FC<ZoneOccupancyWidgetProps> = ({
  zoneOccupancies,
  onNavigateToZoneMap,
}) => {
  const totalOccupancy = zoneOccupancies.reduce((acc, z) => acc + z.workerCount, 0);

  return (
    <div className="bg-[#0c131f] border border-[#182335] rounded-xl p-4 space-y-3 font-sans select-none">
      
      {/* Widget Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center space-x-2">
          <Layers className="w-4 h-4 text-cyan-400" />
          <h3 className="font-bold text-white text-sm tracking-tight">
            Zone Occupancy
          </h3>
          <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-[#152030] text-slate-300">
            {totalOccupancy} Active
          </span>
        </div>

        <button
          onClick={() => onNavigateToZoneMap()}
          className="text-xs text-cyan-400 hover:text-cyan-300 font-medium hover:underline flex items-center space-x-1 cursor-pointer"
        >
          <span>Mine Map</span>
          <ArrowRight className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* Zone Occupancy List */}
      <div className="space-y-2">
        {zoneOccupancies.map((zone) => {
          const hasDanger = zone.dangerCount > 0;
          const hasWarning = zone.warningCount > 0;

          return (
            <div
              key={zone.zoneId}
              onClick={() => onNavigateToZoneMap(zone.zoneName)}
              className={`p-3 rounded-xl border text-xs transition-all cursor-pointer ${
                hasDanger
                  ? 'bg-red-950/20 border-red-500/70 hover:border-red-400'
                  : hasWarning
                  ? 'bg-amber-950/15 border-amber-500/60 hover:border-amber-400'
                  : 'bg-[#080e18] border-[#162335] hover:border-[#273d5c] hover:bg-[#0c1524]'
              }`}
            >
              <div className="flex items-center justify-between">
                <div>
                  <div className="font-semibold text-slate-100 flex items-center space-x-2">
                    <span>{zone.zoneName}</span>
                    {hasDanger && (
                      <span className="text-[9px] px-1.5 py-0.2 rounded font-mono font-bold bg-red-600 text-white animate-pulse">
                        HAZARD
                      </span>
                    )}
                  </div>
                  <div className="text-[10px] font-mono text-slate-400 mt-0.5">
                    {zone.level} · Depth: {zone.depthMeters}m
                  </div>
                </div>

                <div className="text-right">
                  <div className="font-mono font-bold text-white text-sm flex items-center justify-end space-x-1">
                    <Users className="w-3.5 h-3.5 text-slate-400" />
                    <span>{zone.workerCount} {zone.workerCount === 1 ? 'worker' : 'workers'}</span>
                  </div>

                  {/* Micro Status Badges */}
                  <div className="flex items-center space-x-1.5 justify-end mt-1 text-[10px] font-mono">
                    {zone.safeCount > 0 && (
                      <span className="text-emerald-400 flex items-center space-x-0.5">
                        <ShieldCheck className="w-2.5 h-2.5" />
                        <span>{zone.safeCount}</span>
                      </span>
                    )}

                    {zone.warningCount > 0 && (
                      <span className="text-amber-400 flex items-center space-x-0.5">
                        <AlertTriangle className="w-2.5 h-2.5" />
                        <span>{zone.warningCount}</span>
                      </span>
                    )}

                    {zone.dangerCount > 0 && (
                      <span className="text-red-400 font-bold flex items-center space-x-0.5">
                        <AlertTriangle className="w-2.5 h-2.5" />
                        <span>{zone.dangerCount}</span>
                      </span>
                    )}

                    {zone.offlineCount > 0 && (
                      <span className="text-slate-500 flex items-center space-x-0.5">
                        <WifiOff className="w-2.5 h-2.5" />
                        <span>{zone.offlineCount}</span>
                      </span>
                    )}
                  </div>
                </div>
              </div>

              {/* Occupancy Proportion Bar */}
              <div className="mt-2 w-full bg-[#131d2c] rounded-full h-1.5 overflow-hidden flex">
                {zone.workerCount > 0 && (
                  <>
                    <div 
                      style={{ width: `${(zone.safeCount / zone.workerCount) * 100}%` }} 
                      className="bg-emerald-500 h-full"
                    />
                    <div 
                      style={{ width: `${(zone.warningCount / zone.workerCount) * 100}%` }} 
                      className="bg-amber-500 h-full"
                    />
                    <div 
                      style={{ width: `${(zone.dangerCount / zone.workerCount) * 100}%` }} 
                      className="bg-red-500 h-full"
                    />
                    <div 
                      style={{ width: `${(zone.offlineCount / zone.workerCount) * 100}%` }} 
                      className="bg-slate-600 h-full"
                    />
                  </>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};
