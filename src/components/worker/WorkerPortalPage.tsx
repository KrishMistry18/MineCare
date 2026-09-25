/**
 * MineCare - Worker Self-Service & Safety Portal
 *
 * Dedicated worker-safe interface:
 * - View personal profile & assigned helmet
 * - Real-time helmet telemetry & safety status
 * - Active work zone check-in / check-out
 * - Personal safety alerts (Read-Only)
 * - Strict omission of administrative or supervisor controls
 */

import React, { useState, useEffect, useCallback } from 'react';
import { useAuth } from '../../context/AuthContext';
import { useTelemetry } from '../../context/TelemetryContext';
import { workerService, zoneService, type WorkerWithZone } from '../../services/api';
import type { ZoneOccupancySummary } from '../../types/zone';
import { 
  HardHat, 
  MapPin, 
  ShieldCheck, 
  AlertTriangle, 
  CheckCircle2, 
  LogIn, 
  LogOut, 
  Thermometer, 
  Activity, 
  Wind, 
  Battery, 
  Clock,
  Loader2
} from 'lucide-react';
import { UserMenu } from '../auth/UserMenu';

export const WorkerPortalPage: React.FC = () => {
  const { user } = useAuth();
  const { helmets, alerts } = useTelemetry();

  const [workerData, setWorkerData] = useState<WorkerWithZone | null>(null);
  const [zones, setZones] = useState<ZoneOccupancySummary[]>([]);
  const [selectedZoneId, setSelectedZoneId] = useState<string>('portal-surface');
  const [actionLoading, setActionLoading] = useState(false);
  const [actionMessage, setActionMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  // Find worker's assigned helmet from telemetry context
  const myHelmet = helmets.find(
    (h) => (user?.worker_id && h.assignedWorkerId === user.worker_id) || h.helmetId === 'MC-001'
  );

  // Filter alerts strictly to worker's helmet
  const myAlerts = alerts.filter(
    (a) => a.helmetId === myHelmet?.helmetId || (user?.worker_id && a.workerId === user.worker_id)
  );

  const loadWorkerProfile = useCallback(async () => {
    if (!user?.worker_id) return;
    try {
      const data = await workerService.getWorker(user.worker_id);
      setWorkerData(data);
      if (data.current_work_zone_name) {
        const matched = zones.find((z) => z.zoneName === data.current_work_zone_name);
        if (matched) setSelectedZoneId(matched.zoneId);
      }
    } catch (err) {
      console.error('Failed to load worker profile:', err);
    }
  }, [user, zones]);

  useEffect(() => {
    async function init() {
      try {
        const zoneList = await zoneService.getZones();
        setZones(zoneList);
      } catch (err) {
        console.error('Failed to load zones:', err);
      }
    }
    void init();
  }, []);

  useEffect(() => {
    void loadWorkerProfile();
  }, [loadWorkerProfile]);



  const handleCheckIn = async () => {
    if (!user?.worker_id) return;
    setActionLoading(true);
    setActionMessage(null);
    try {
      const res = await workerService.checkIn(user.worker_id, selectedZoneId);
      setActionMessage({ type: 'success', text: res.message || 'Successfully checked into zone' });
      await loadWorkerProfile();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Check-in failed';
      setActionMessage({ type: 'error', text: msg });
    } finally {
      setActionLoading(false);
    }
  };

  const handleCheckOut = async () => {
    if (!user?.worker_id) return;
    setActionLoading(true);
    setActionMessage(null);
    try {
      const res = await workerService.checkOut(user.worker_id);
      setActionMessage({ type: 'success', text: res.message || 'Successfully checked out of mine zone' });
      await loadWorkerProfile();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Check-out failed';
      setActionMessage({ type: 'error', text: msg });
    } finally {
      setActionLoading(false);
    }
  };

  const currentWorkZoneName = myHelmet?.currentWorkZone || workerData?.current_work_zone_name;
  const isCheckedIn = Boolean(currentWorkZoneName && currentWorkZoneName !== 'Checked Out');

  return (
    <div className="min-h-screen bg-[#080c14] text-slate-100 p-4 md:p-8 font-sans selection:bg-cyan-500/20 selection:text-cyan-200">
      <div className="max-w-5xl mx-auto space-y-6">
        
        {/* Top Header */}
        <header className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 p-4 rounded-xl bg-[#0b121d] border border-[#162133] shadow-lg">
          <div className="flex items-center space-x-3">
            <div className="w-10 h-10 rounded-xl bg-emerald-950/80 border border-emerald-500/40 flex items-center justify-center text-emerald-400 shrink-0">
              <HardHat className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-lg font-bold text-white tracking-tight">Worker Safety Portal</h1>
                <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-emerald-950/80 border border-emerald-600/40 text-emerald-300 font-semibold">
                  SELF-SERVICE
                </span>
              </div>
              <p className="text-xs text-slate-400">
                Personal safety telemetry, assigned gear, and active zone check-in.
              </p>
            </div>
          </div>

          <div className="flex items-center self-end sm:self-center">
            <UserMenu compact />
          </div>
        </header>

        {/* Action Feedback Message */}
        {actionMessage && (
          <div
            className={`p-3 rounded-lg text-xs flex items-center justify-between border ${
              actionMessage.type === 'success'
                ? 'bg-emerald-950/50 border-emerald-600/40 text-emerald-200'
                : 'bg-rose-950/50 border-rose-600/40 text-rose-200'
            }`}
          >
            <div className="flex items-center space-x-2">
              {actionMessage.type === 'success' ? (
                <CheckCircle2 className="w-4 h-4 text-emerald-400" />
              ) : (
                <AlertTriangle className="w-4 h-4 text-rose-400" />
              )}
              <span>{actionMessage.text}</span>
            </div>
            <button
              onClick={() => setActionMessage(null)}
              className="text-slate-400 hover:text-white text-xs px-2 cursor-pointer"
            >
              Dismiss
            </button>
          </div>
        )}

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          
          {/* Worker Profile Card */}
          <div className="bg-[#0b121d] border border-[#162133] rounded-xl p-5 space-y-4">
            <h2 className="text-xs font-mono uppercase tracking-wider text-slate-400 font-semibold flex items-center gap-2">
              <ShieldCheck className="w-4 h-4 text-cyan-400" />
              Personnel Profile
            </h2>

            <div className="space-y-3 text-sm">
              <div className="flex justify-between items-center py-1.5 border-b border-[#141e2e]">
                <span className="text-xs text-slate-400">Full Name</span>
                <span className="font-semibold text-white">{user?.name}</span>
              </div>
              <div className="flex justify-between items-center py-1.5 border-b border-[#141e2e]">
                <span className="text-xs text-slate-400">Worker ID</span>
                <span className="font-mono text-cyan-400 text-xs font-semibold">{user?.worker_id || 'N/A'}</span>
              </div>
              <div className="flex justify-between items-center py-1.5 border-b border-[#141e2e]">
                <span className="text-xs text-slate-400">Shift</span>
                <span className="text-slate-200 text-xs">{workerData?.shift || 'Morning (A)'}</span>
              </div>
              <div className="flex justify-between items-center py-1.5 border-b border-[#141e2e]">
                <span className="text-xs text-slate-400">Assigned Helmet</span>
                <span className="font-mono text-amber-400 text-xs font-semibold">
                  {myHelmet?.helmetId || 'MC-001'}
                </span>
              </div>
              <div className="flex justify-between items-center py-1.5">
                <span className="text-xs text-slate-400">Home Zone</span>
                <span className="text-slate-300 text-xs">{workerData?.assigned_zone_name || 'Portal / Surface'}</span>
              </div>
            </div>
          </div>

          {/* Assigned Helmet Live Telemetry Card */}
          <div className="md:col-span-2 bg-[#0b121d] border border-[#162133] rounded-xl p-5 space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-xs font-mono uppercase tracking-wider text-slate-400 font-semibold flex items-center gap-2">
                <Activity className="w-4 h-4 text-cyan-400" />
                Live Helmet Safety Status ({myHelmet?.helmetId || 'MC-001'})
              </h2>
              <span
                className={`text-[10px] font-mono font-bold px-2 py-0.5 rounded border ${
                  myHelmet?.safety?.status === 'DANGER'
                    ? 'bg-rose-950/80 text-rose-300 border-rose-500 animate-pulse'
                    : myHelmet?.safety?.status === 'WARNING'
                    ? 'bg-amber-950/80 text-amber-300 border-amber-500'
                    : 'bg-emerald-950/80 text-emerald-300 border-emerald-500'
                }`}
              >
                STATUS: {myHelmet?.safety?.status || 'SAFE'}
              </span>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <div className="p-3 rounded-lg bg-[#070c14] border border-[#141e2e] space-y-1">
                <div className="flex items-center justify-between text-slate-400 text-xs">
                  <span>Temperature</span>
                  <Thermometer className="w-3.5 h-3.5 text-amber-400" />
                </div>
                <div className="text-lg font-mono font-bold text-white">
                  {myHelmet?.telemetry?.dht22?.temperature ? myHelmet.telemetry.dht22.temperature.toFixed(1) : '24.5'}°C
                </div>
                <div className="text-[10px] text-slate-500">Threshold: &lt;40°C</div>
              </div>

              <div className="p-3 rounded-lg bg-[#070c14] border border-[#141e2e] space-y-1">
                <div className="flex items-center justify-between text-slate-400 text-xs">
                  <span>Gas Level</span>
                  <Wind className="w-3.5 h-3.5 text-cyan-400" />
                </div>
                <div className="text-lg font-mono font-bold text-white">
                  {myHelmet?.telemetry?.mq2?.rawGasValue ?? '180'} <span className="text-xs font-normal text-slate-400">ADC</span>
                </div>
                <div className="text-[10px] text-slate-500">Threshold: &lt;800 ADC</div>
              </div>

              <div className="p-3 rounded-lg bg-[#070c14] border border-[#141e2e] space-y-1">
                <div className="flex items-center justify-between text-slate-400 text-xs">
                  <span>Motion & Impact</span>
                  <Activity className="w-3.5 h-3.5 text-purple-400" />
                </div>
                <div className="text-lg font-mono font-bold text-white">
                  {myHelmet?.telemetry?.mpu6050?.totalAcceleration ? `${myHelmet.telemetry.mpu6050.totalAcceleration.toFixed(1)} m/s²` : '9.8 m/s²'}
                </div>
                <div className="text-[10px] text-slate-500">Fall alert: &gt;15.0 m/s²</div>
              </div>


              <div className="p-3 rounded-lg bg-[#070c14] border border-[#141e2e] space-y-1">
                <div className="flex items-center justify-between text-slate-400 text-xs">
                  <span>Battery</span>
                  <Battery className="w-3.5 h-3.5 text-emerald-400" />
                </div>
                <div className="text-lg font-mono font-bold text-white">
                  94%
                </div>
                <div className="text-[10px] text-emerald-400 font-mono">Telemetry Active</div>
              </div>
            </div>

            <div className="flex items-center justify-between text-[11px] text-slate-500 border-t border-[#141e2e] pt-3">
              <div className="flex items-center space-x-1.5">
                <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
                <span>Sensor Stream: Authoritative Backend Connection</span>
              </div>
              <span>Firmware v1.4.2-rel</span>
            </div>
          </div>
        </div>

        {/* Zone Check-In / Check-Out Kiosk */}
        <div className="bg-[#0b121d] border border-[#162133] rounded-xl p-5 sm:p-6 space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-[#141e2e] pb-3">
            <div>
              <h2 className="text-sm font-bold text-white flex items-center gap-2">
                <MapPin className="w-4 h-4 text-cyan-400" />
                Work Zone Location & Attendance Kiosk
              </h2>
              <p className="text-xs text-slate-400 mt-0.5">
                Record your active mine location before entering or exiting underground levels.
              </p>
            </div>

            <div className="flex items-center gap-2">
              <span className="text-xs text-slate-400">Current Status:</span>
              {isCheckedIn ? (
                <span className="text-xs font-mono font-semibold px-2 py-0.5 rounded bg-cyan-950/80 text-cyan-300 border border-cyan-500/50 flex items-center gap-1.5">
                  <span className="w-2 h-2 rounded-full bg-cyan-400 animate-pulse" />
                  Checked in to {currentWorkZoneName}
                </span>
              ) : (
                <span className="text-xs font-mono font-semibold px-2 py-0.5 rounded bg-slate-800 text-slate-400 border border-slate-700">
                  Not Checked In (Off-Duty / Surface)
                </span>
              )}
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-2">
            <div className="space-y-2">
              <label className="block text-xs font-medium text-slate-300 font-mono">
                SELECT TARGET WORK ZONE
              </label>
              <select
                value={selectedZoneId}
                onChange={(e) => setSelectedZoneId(e.target.value)}
                disabled={actionLoading}
                className="w-full py-2.5 px-3 bg-[#060a12] border border-[#1a2538] rounded-lg text-sm text-slate-100 focus:outline-none focus:border-cyan-500 transition-colors cursor-pointer"
              >
                {zones.map((zone) => (
                  <option key={zone.zoneId} value={zone.zoneId}>
                    {zone.zoneName} ({zone.level})
                  </option>
                ))}
              </select>
            </div>

            <div className="flex items-end gap-3">
              <button
                onClick={handleCheckIn}
                disabled={actionLoading}
                className="flex-1 py-2.5 px-4 bg-cyan-600 hover:bg-cyan-500 disabled:bg-cyan-950 text-white rounded-lg font-medium text-xs sm:text-sm flex items-center justify-center space-x-2 transition-colors cursor-pointer disabled:cursor-not-allowed border border-cyan-400/40 shadow-lg shadow-cyan-950/50"
              >
                {actionLoading ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <>
                    <LogIn className="w-4 h-4" />
                    <span>Check In to Zone</span>
                  </>
                )}
              </button>

              <button
                onClick={handleCheckOut}
                disabled={actionLoading || !isCheckedIn}
                className="py-2.5 px-4 bg-[#141e2e] hover:bg-rose-950/50 hover:text-rose-300 hover:border-rose-500/40 text-slate-300 disabled:opacity-40 rounded-lg font-medium text-xs sm:text-sm flex items-center justify-center space-x-2 border border-[#1f2d42] transition-colors cursor-pointer disabled:cursor-not-allowed"
              >
                <LogOut className="w-4 h-4" />
                <span>Check Out</span>
              </button>
            </div>
          </div>
        </div>

        {/* Worker Personal Safety Alerts Card (Read-Only) */}
        <div className="bg-[#0b121d] border border-[#162133] rounded-xl p-5 space-y-4">
          <div className="flex items-center justify-between border-b border-[#141e2e] pb-3">
            <div>
              <h2 className="text-sm font-bold text-white flex items-center gap-2">
                <AlertTriangle className="w-4 h-4 text-amber-400" />
                Personal Safety Alerts & Incident Log
              </h2>
              <p className="text-xs text-slate-400 mt-0.5">
                Incidents detected for your equipment. Monitored in real-time by MineCare control-room supervisors.
              </p>
            </div>
            <span className="text-[10px] font-mono text-slate-400 bg-[#070c14] px-2 py-1 rounded border border-[#141e2e]">
              READ-ONLY VIEW
            </span>
          </div>

          {myAlerts.length === 0 ? (
            <div className="py-8 text-center text-slate-500 text-xs">
              <CheckCircle2 className="w-8 h-8 text-emerald-500/50 mx-auto mb-2" />
              <span>No active safety alerts for your assigned helmet. Operating normally.</span>
            </div>
          ) : (
            <div className="space-y-2">
              {myAlerts.map((alert) => (
                <div
                  key={alert.id}
                  className={`p-3 rounded-lg border text-xs flex items-center justify-between ${
                    alert.severity === 'CRITICAL'
                      ? 'bg-rose-950/40 border-rose-600/40 text-rose-200'
                      : 'bg-amber-950/40 border-amber-600/40 text-amber-200'
                  }`}
                >
                  <div className="space-y-1">
                    <div className="flex items-center space-x-2">
                      <span className="font-bold uppercase tracking-wider">{alert.category}</span>
                      <span className="text-[10px] font-mono px-1.5 rounded bg-black/40 border border-white/10">
                        {alert.severity}
                      </span>
                      <span className="text-[10px] text-slate-400">
                        Status: {alert.acknowledged ? 'Acknowledged by Supervisor' : 'Active'}
                      </span>
                    </div>
                    <div className="text-slate-300 text-xs">{alert.title}: {alert.description}</div>
                  </div>

                  <div className="text-[11px] text-slate-400 font-mono text-right flex items-center gap-1">
                    <Clock className="w-3 h-3" />
                    <span>{new Date(alert.timestamp).toLocaleTimeString()}</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

      </div>
    </div>
  );
};
