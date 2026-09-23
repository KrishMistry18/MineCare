/**
 * MineCare - Dedicated Alerts Management Page
 * Lifecycle: TRIGGERED -> ACKNOWLEDGED -> RESOLVED
 */

import React, { useState } from 'react';
import { 
  ShieldAlert, 
  AlertTriangle, 
  CheckCircle, 
  Clock
} from 'lucide-react';
import { useTelemetry } from '../../context/TelemetryContext';

export const AlertsPage: React.FC = () => {
  const { alerts, acknowledgeAlert, resolveAlert } = useTelemetry();
  const [activeTab, setActiveTab] = useState<'ACTIVE' | 'HISTORY'>('ACTIVE');

  const activeAlerts = alerts.filter(a => !a.resolved);
  const historyAlerts = alerts.filter(a => a.resolved);

  const displayedAlerts = activeTab === 'ACTIVE' ? activeAlerts : historyAlerts;

  return (
    <div className="space-y-6 font-sans">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-white tracking-tight">
          Alerts
        </h1>
        <p className="text-xs text-slate-400 mt-1">
          Raised when a helmet leaves SAFE under the prototype threshold logic.
        </p>
      </div>

      {/* Tabs Switcher: Active (X) vs History (Y) */}
      <div className="flex items-center space-x-2 border-b border-[#182335] pb-2">
        <button
          onClick={() => setActiveTab('ACTIVE')}
          className={`flex items-center space-x-2 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
            activeTab === 'ACTIVE'
              ? 'bg-[#131d2c] text-white border border-[#23354e]'
              : 'text-slate-400 hover:text-slate-200'
          }`}
        >
          <span>Active</span>
          <span className="text-[10px] font-mono px-1.5 py-0.2 rounded-full bg-red-600/80 text-white font-bold">
            {activeAlerts.length}
          </span>
        </button>

        <button
          onClick={() => setActiveTab('HISTORY')}
          className={`flex items-center space-x-2 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
            activeTab === 'HISTORY'
              ? 'bg-[#131d2c] text-white border border-[#23354e]'
              : 'text-slate-400 hover:text-slate-200'
          }`}
        >
          <span>History</span>
          <span className="text-[10px] font-mono px-1.5 py-0.2 rounded-full bg-[#1e2a3c] text-slate-300 font-bold">
            {historyAlerts.length}
          </span>
        </button>
      </div>

      {/* Alerts List */}
      {displayedAlerts.length === 0 ? (
        <div className="bg-[#0c131f] border border-[#182335] rounded-xl p-12 text-center space-y-2">
          <div className="w-10 h-10 rounded-full bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 flex items-center justify-center mx-auto">
            <CheckCircle className="w-5 h-5" />
          </div>
          <div className="font-bold text-slate-200 text-sm">
            {activeTab === 'ACTIVE' ? 'No active alerts' : 'No historical alerts recorded yet'}
          </div>
          <p className="text-xs text-slate-400 max-w-sm mx-auto">
            {activeTab === 'ACTIVE'
              ? 'Every reporting helmet is within prototype thresholds. Trigger a simulation scenario to test alerting.'
              : 'Alerts that have returned to normal or were signed off will appear here.'}
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {displayedAlerts.map(alert => {
            const isCritical = alert.severity === 'CRITICAL';

            return (
              <div
                key={alert.id}
                className={`p-4 rounded-xl border flex flex-col md:flex-row md:items-center justify-between gap-4 transition-all ${
                  isCritical && !alert.resolved
                    ? 'bg-red-950/20 border-red-500/70 shadow-[0_0_15px_rgba(239,68,68,0.08)]'
                    : alert.severity === 'WARNING' && !alert.resolved
                    ? 'bg-amber-950/15 border-amber-500/60'
                    : 'bg-[#0c131f] border-[#182335]'
                }`}
              >
                <div className="flex items-start space-x-3.5">
                  <div className={`w-9 h-9 rounded-lg flex items-center justify-center shrink-0 mt-0.5 ${
                    isCritical 
                      ? 'bg-red-600/20 border border-red-500/50 text-red-400' 
                      : 'bg-amber-600/20 border border-amber-500/50 text-amber-400'
                  }`}>
                    {isCritical ? <ShieldAlert className="w-5 h-5" /> : <AlertTriangle className="w-5 h-5" />}
                  </div>

                  <div className="space-y-1">
                    <div className="flex items-center space-x-2">
                      <span className="font-bold font-mono text-white text-sm">
                        {alert.helmetId}
                      </span>
                      <span className="text-slate-500 text-xs">•</span>
                      <span className="text-xs font-medium text-slate-300">
                        {alert.workerName}
                      </span>
                      <span className="text-slate-500 text-xs">•</span>
                      <span className="text-xs text-slate-400">
                        {alert.shaftLocation}
                      </span>
                    </div>

                    <p className="text-xs text-slate-300 font-medium">
                      {alert.description}
                    </p>

                    <div className="flex flex-wrap items-center gap-3 text-[11px] text-slate-400 font-mono pt-1">
                      <span className="flex items-center space-x-1">
                        <Clock className="w-3 h-3 text-slate-500" />
                        <span>{new Date(alert.timestamp).toLocaleTimeString()}</span>
                      </span>
                      <span>Gas: <strong className="text-amber-400">{alert.readingsSnapshot.rawGasValue}</strong></span>
                      <span>Accel: <strong className="text-red-400">{alert.readingsSnapshot.totalAcceleration.toFixed(1)} m/s²</strong></span>
                      <span>Temp: {alert.readingsSnapshot.temperature.toFixed(1)} °C</span>
                    </div>
                  </div>
                </div>

                {/* Status Badges & Lifecycle Actions */}
                <div className="flex items-center space-x-2.5 self-end md:self-auto shrink-0 font-mono text-xs">
                  {alert.resolved ? (
                    <span className="px-2.5 py-1 rounded-full font-bold bg-[#0b241b] border border-[#164e3b] text-[#34d399] text-[11px]">
                      RESOLVED
                    </span>
                  ) : (
                    <>
                      {alert.acknowledged ? (
                        <span className="px-2.5 py-1 rounded-full font-bold bg-[#291b07] border border-[#78350f] text-[#fbbf24] text-[11px]">
                          ACKNOWLEDGED
                        </span>
                      ) : (
                        <button
                          onClick={() => acknowledgeAlert(alert.id)}
                          className="px-3 py-1.5 bg-[#182438] hover:bg-[#22334e] text-slate-200 border border-[#2b3c56] rounded-lg transition-colors cursor-pointer text-xs"
                        >
                          Acknowledge
                        </button>
                      )}

                      <button
                        onClick={() => resolveAlert(alert.id, 'Resolved from Alerts page')}
                        className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg transition-colors font-medium cursor-pointer text-xs"
                      >
                        Resolve
                      </button>
                    </>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};
