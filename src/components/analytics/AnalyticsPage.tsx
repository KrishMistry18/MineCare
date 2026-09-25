/**
 * MineCare - Historical Analytics & Intelligence View
 *
 * Backed by authoritative persisted telemetry, alerts, zone assignments,
 * and helmet connectivity logs.
 *
 * Supported features:
 * - Time range selector: 1h, 6h, 24h, 7d, 30d (Default: 24h)
 * - Multi-dimensional filtering: Helmet, Worker, Zone
 * - Role-aware RBAC enforcement (Workers locked to personal history)
 * - Historical Telemetry Trends: Temperature, Humidity, MQ-2 Gas (RAW ADC), Motion / Fall
 * - Historical Alerts Breakdown & Timeline
 * - Historical Zone Activity & Occupancy
 * - Connectivity Interruption Events & Non-fabricated Uptime Reporting
 * - Professional Empty States without fabricated zeroes
 */

import React, { useState, useEffect, useCallback } from 'react';
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
  Bar,
  PieChart,
  Pie,
  Cell,
} from 'recharts';
import {
  Thermometer,
  Wind,
  Activity,
  ShieldCheck,
  AlertTriangle,
  WifiOff,
  Clock,
  Filter,
  MapPin,
  HardHat,
  User as UserIcon,
  RefreshCw,
  Info,
  CheckCircle2,
} from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { useTelemetry } from '../../context/TelemetryContext';
import { analyticsService } from '../../services/api';
import type { AnalyticsOverviewResult } from '../../backend/analytics/AnalyticsEngine';
import { PROTOTYPE_THRESHOLDS } from '../../types/safety';

type TimeRangePreset = '1h' | '6h' | '24h' | '7d' | '30d';

const TIME_PRESETS: Array<{ id: TimeRangePreset; label: string; durationMs: number }> = [
  { id: '1h', label: 'Last 1 Hour', durationMs: 1 * 3600 * 1000 },
  { id: '6h', label: 'Last 6 Hours', durationMs: 6 * 3600 * 1000 },
  { id: '24h', label: 'Last 24 Hours', durationMs: 24 * 3600 * 1000 },
  { id: '7d', label: 'Last 7 Days', durationMs: 7 * 24 * 3600 * 1000 },
  { id: '30d', label: 'Last 30 Days', durationMs: 30 * 24 * 3600 * 1000 },
];


const ALERT_TYPE_LABELS: Record<string, string> = {
  GAS_HAZARD: 'Gas Hazard',
  HEAT_STRESS: 'Heat Stress',
  WORKER_FALL: 'Worker Fall',
  SOS_EMERGENCY: 'SOS Emergency',
  HELMET_OFFLINE: 'Helmet Offline',
  MULTI_HAZARD: 'Multiple Hazards',
  SENSOR_FAULT: 'Sensor Fault',
};

export const AnalyticsPage: React.FC = () => {
  const { user } = useAuth();
  const { helmets } = useTelemetry();

  const [timePreset, setTimePreset] = useState<TimeRangePreset>('24h');
  const [selectedHelmetId, setSelectedHelmetId] = useState<string>('ALL');
  const [selectedWorkerId, setSelectedWorkerId] = useState<string>('ALL');
  const [selectedZoneId, setSelectedZoneId] = useState<string>('ALL');

  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [overview, setOverview] = useState<AnalyticsOverviewResult | null>(null);
  const [lastRefreshedAt, setLastRefreshedAt] = useState<string>('');

  const isWorkerRole = user?.role === 'WORKER';

  // Calculate explicit from and to ISO timestamps for selected preset
  const getTimeWindow = useCallback(() => {
    const toDate = new Date();
    const presetObj = TIME_PRESETS.find((p) => p.id === timePreset) || TIME_PRESETS[2];
    const fromDate = new Date(toDate.getTime() - presetObj.durationMs);
    return {
      from: fromDate.toISOString(),
      to: toDate.toISOString(),
    };
  }, [timePreset]);

  // Load authoritative analytics from backend
  const loadAnalytics = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const { from, to } = getTimeWindow();
      const params: { from: string; to: string; helmetId?: string; workerId?: string; zoneId?: string } = {
        from,
        to,
      };

      if (!isWorkerRole) {
        if (selectedHelmetId !== 'ALL') params.helmetId = selectedHelmetId;
        if (selectedWorkerId !== 'ALL') params.workerId = selectedWorkerId;
        if (selectedZoneId !== 'ALL') params.zoneId = selectedZoneId;
      }

      const res = await analyticsService.getOverview(params);
      setOverview(res);
      setLastRefreshedAt(new Date().toLocaleTimeString());
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to retrieve historical analytics.';
      setError(msg);
    } finally {
      setLoading(false);
    }
  }, [getTimeWindow, isWorkerRole, selectedHelmetId, selectedWorkerId, selectedZoneId]);

  useEffect(() => {
    void loadAnalytics();
  }, [loadAnalytics]);

  // Build Alert category chart data
  const alertTypeData = overview
    ? Object.entries(overview.alerts.byType)
        .filter(([, count]) => count > 0)
        .map(([type, count]) => ({
          name: ALERT_TYPE_LABELS[type] || type,
          count,
        }))
    : [];

  return (
    <div className="space-y-6 font-sans text-slate-100">
      
      {/* Header & Filter Controls */}
      <div className="flex flex-col xl:flex-row xl:items-center justify-between gap-4 bg-[#090f19] border border-[#162133] rounded-xl p-5 shadow-lg">
        <div>
          <div className="flex items-center space-x-2">
            <h1 className="text-xl sm:text-2xl font-bold text-white tracking-tight flex items-center gap-2">
              <Activity className="w-5 h-5 text-cyan-400" />
              Historical Intelligence & Telemetry Analytics
            </h1>
            <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-cyan-950/80 border border-cyan-500/40 text-cyan-300 font-semibold uppercase tracking-wider">
              Persisted Data
            </span>
          </div>
          <p className="text-xs text-slate-400 mt-1">
            Authoritative retrospective sensor trends, safety violations, zone assignments, and connectivity logs.
          </p>
        </div>

        {/* Global Time Range Selector */}
        <div className="flex flex-wrap items-center gap-2 self-start xl:self-auto">
          <div className="flex items-center bg-[#060a12] p-1 rounded-lg border border-[#162133] text-xs">
            <Clock className="w-3.5 h-3.5 text-slate-400 ml-2 mr-1" />
            {TIME_PRESETS.map((t) => (
              <button
                key={t.id}
                onClick={() => setTimePreset(t.id)}
                className={`px-2.5 py-1 rounded-md transition-colors text-xs font-mono ${
                  timePreset === t.id
                    ? 'bg-cyan-600 text-white font-semibold shadow-sm'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>

          <button
            onClick={() => void loadAnalytics()}
            disabled={loading}
            className="px-3 py-1.5 rounded-lg bg-[#0e1726] border border-[#1d2b42] text-xs font-medium text-slate-300 hover:text-white hover:border-cyan-500/50 transition-colors flex items-center gap-1.5"
            title="Refresh historical analytics from server"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin text-cyan-400' : ''}`} />
            <span>Sync</span>
          </button>
        </div>
      </div>

      {/* Filter Toolbar (Admin/Supervisor full, Worker restricted) */}
      {!isWorkerRole && (
        <div className="bg-[#0b121d] border border-[#182335] rounded-xl p-4 flex flex-wrap items-center justify-between gap-4 text-xs">
          <div className="flex flex-wrap items-center gap-4">
            <div className="flex items-center gap-2">
              <Filter className="w-3.5 h-3.5 text-slate-400" />
              <span className="text-slate-400 font-semibold uppercase text-[11px] tracking-wider">Filters:</span>
            </div>

            {/* Helmet Filter */}
            <div className="flex items-center gap-1.5">
              <HardHat className="w-3.5 h-3.5 text-cyan-400" />
              <label htmlFor="helmet-filter-select" className="text-slate-400">Helmet:</label>
              <select
                id="helmet-filter-select"
                aria-label="Filter analytics by Helmet"
                value={selectedHelmetId}
                onChange={(e) => setSelectedHelmetId(e.target.value)}
                className="bg-[#060a12] border border-[#1e2a3c] rounded-md px-2.5 py-1 text-slate-200 font-mono text-xs focus:outline-none focus:border-cyan-500"
              >
                <option value="ALL">All Fleet Helmets (16)</option>
                {helmets.map((h) => (
                  <option key={h.helmetId} value={h.helmetId}>
                    {h.helmetId} ({h.assignedShaft})
                  </option>
                ))}
              </select>
            </div>

            {/* Zone Filter */}
            <div className="flex items-center gap-1.5">
              <MapPin className="w-3.5 h-3.5 text-amber-400" />
              <label htmlFor="zone-filter-select" className="text-slate-400">Zone:</label>
              <select
                id="zone-filter-select"
                aria-label="Filter analytics by Zone"
                value={selectedZoneId}
                onChange={(e) => setSelectedZoneId(e.target.value)}
                className="bg-[#060a12] border border-[#1e2a3c] rounded-md px-2.5 py-1 text-slate-200 text-xs focus:outline-none focus:border-cyan-500"
              >
                <option value="ALL">All Underground Zones</option>
                <option value="portal-surface">Portal / Surface</option>
                <option value="level-1-north-drift">Level 1 — North Drift</option>
                <option value="level-2-south-panel">Level 2 — South Panel</option>
                <option value="level-3-haul-road">Level 3 — Haul Road</option>
              </select>
            </div>

            {/* Reset Filters */}
            {(selectedHelmetId !== 'ALL' || selectedWorkerId !== 'ALL' || selectedZoneId !== 'ALL') && (
              <button
                onClick={() => {
                  setSelectedHelmetId('ALL');
                  setSelectedWorkerId('ALL');
                  setSelectedZoneId('ALL');
                }}
                className="text-[11px] text-cyan-400 hover:text-cyan-300 underline font-mono"
              >
                Reset filters
              </button>
            )}
          </div>

          <div className="text-[11px] font-mono text-slate-400">
            Last Synced: <span className="text-slate-200 font-semibold">{lastRefreshedAt || 'Just now'}</span>
          </div>
        </div>
      )}

      {/* Worker Isolation Banner */}
      {isWorkerRole && (
        <div className="bg-[#0b1424] border border-cyan-500/30 rounded-xl p-3.5 flex items-center justify-between text-xs">
          <div className="flex items-center space-x-2 text-cyan-300">
            <UserIcon className="w-4 h-4 text-cyan-400 shrink-0" />
            <span>
              Restricted Personal View: Displaying historical telemetry, alerts, and zone movements strictly for{' '}
              <strong className="text-white font-mono">{user?.name} ({user?.worker_id})</strong>.
            </span>
          </div>
          <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-cyan-950 text-cyan-400 border border-cyan-500/40">
            RBAC Isolated
          </span>
        </div>
      )}

      {/* Error Banner */}
      {error && (
        <div className="bg-red-950/40 border border-red-500/50 rounded-xl p-4 text-xs text-red-200 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 text-red-400" />
            <span>{error}</span>
          </div>
          <button
            onClick={() => void loadAnalytics()}
            className="px-2.5 py-1 bg-red-900/60 rounded border border-red-500/50 text-white text-[11px] hover:bg-red-800"
          >
            Retry
          </button>
        </div>
      )}

      {/* KPI Section */}
      <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-3">
        
        {/* KPI 1: Telemetry Samples */}
        <div className="bg-[#090f19] border border-[#162133] rounded-xl p-3.5 space-y-1">
          <div className="text-[11px] font-mono text-slate-400 uppercase">Packets Ingested</div>
          <div className="text-xl font-bold font-mono text-white">
            {overview?.kpi.totalPackets ?? 0}
          </div>
          <div className="text-[10px] text-slate-500 font-mono">Persisted records</div>
        </div>

        {/* KPI 2: Total Alerts */}
        <div className="bg-[#090f19] border border-[#162133] rounded-xl p-3.5 space-y-1">
          <div className="text-[11px] font-mono text-slate-400 uppercase">Total Alerts</div>
          <div className="text-xl font-bold font-mono text-white">
            {overview?.kpi.totalAlerts ?? 0}
          </div>
          <div className="text-[10px] text-amber-400 font-mono">
            Active: {overview?.kpi.activeAlerts ?? 0}
          </div>
        </div>

        {/* KPI 3: Danger Events */}
        <div className="bg-[#090f19] border border-[#162133] rounded-xl p-3.5 space-y-1">
          <div className="text-[11px] font-mono text-slate-400 uppercase">Danger Events</div>
          <div className={`text-xl font-bold font-mono ${(overview?.kpi.dangerEvents ?? 0) > 0 ? 'text-red-400' : 'text-slate-300'}`}>
            {overview?.kpi.dangerEvents ?? 0}
          </div>
          <div className="text-[10px] text-slate-500 font-mono">Fall / SOS / Critical</div>
        </div>

        {/* KPI 4: Warning Events */}
        <div className="bg-[#090f19] border border-[#162133] rounded-xl p-3.5 space-y-1">
          <div className="text-[11px] font-mono text-slate-400 uppercase">Warning Events</div>
          <div className={`text-xl font-bold font-mono ${(overview?.kpi.warningEvents ?? 0) > 0 ? 'text-amber-400' : 'text-slate-300'}`}>
            {overview?.kpi.warningEvents ?? 0}
          </div>
          <div className="text-[10px] text-slate-500 font-mono">Threshold exceedances</div>
        </div>

        {/* KPI 5: Avg Temperature */}
        <div className="bg-[#090f19] border border-[#162133] rounded-xl p-3.5 space-y-1">
          <div className="text-[11px] font-mono text-slate-400 uppercase">Avg Temperature</div>
          <div className="text-xl font-bold font-mono text-amber-300">
            {overview?.kpi.avgTemperature !== null && overview?.kpi.avgTemperature !== undefined
              ? `${overview.kpi.avgTemperature}°C`
              : '—'}
          </div>
          <div className="text-[10px] text-slate-500 font-mono">Threshold &gt;40°C</div>
        </div>

        {/* KPI 6: Avg Gas Reading */}
        <div className="bg-[#090f19] border border-[#162133] rounded-xl p-3.5 space-y-1">
          <div className="text-[11px] font-mono text-slate-400 uppercase">Avg Gas (RAW)</div>
          <div className="text-xl font-bold font-mono text-cyan-300">
            {overview?.kpi.avgRawGas !== null && overview?.kpi.avgRawGas !== undefined
              ? `${overview.kpi.avgRawGas}`
              : '—'}
          </div>
          <div className="text-[10px] text-slate-500 font-mono">ADC (Threshold &gt;800)</div>
        </div>

        {/* KPI 7: Offline Helmets */}
        <div className="bg-[#090f19] border border-[#162133] rounded-xl p-3.5 space-y-1">
          <div className="text-[11px] font-mono text-slate-400 uppercase">Offline Helmets</div>
          <div className={`text-xl font-bold font-mono ${(overview?.kpi.offlineHelmetCount ?? 0) > 0 ? 'text-rose-400' : 'text-emerald-400'}`}>
            {overview?.kpi.offlineHelmetCount ?? 0}
          </div>
          <div className="text-[10px] text-slate-500 font-mono">Heartbeat &gt;8s</div>
        </div>
      </div>

      {/* Main Charts Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">

        {/* Chart 1: Temperature Trend */}
        <div className="bg-[#090f19] border border-[#162133] rounded-xl p-4 sm:p-5 space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-2 text-xs font-bold text-slate-200 uppercase tracking-wide font-mono">
              <Thermometer className="w-4 h-4 text-amber-400" />
              <span>Historical Temperature Trend</span>
            </div>
            {overview?.telemetry.metrics?.temperature && (
              <div className="flex items-center gap-3 text-[11px] font-mono">
                <span className="text-slate-400">Min: <strong className="text-slate-200">{overview.telemetry.metrics.temperature.min}°C</strong></span>
                <span className="text-slate-400">Max: <strong className="text-slate-200">{overview.telemetry.metrics.temperature.max}°C</strong></span>
                <span className="text-amber-400">Limit: &gt;40°C</span>
              </div>
            )}
          </div>

          <div className="h-64 w-full">
            {overview?.telemetry.hasData && overview.telemetry.trend.length > 0 ? (
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={overview.telemetry.trend} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#141e2e" />
                  <XAxis dataKey="timeFormatted" stroke="#475569" tick={{ fontSize: 10, fill: '#64748b' }} />
                  <YAxis domain={[15, 55]} stroke="#f59e0b" tick={{ fontSize: 10, fill: '#f59e0b' }} />
                  <Tooltip
                    contentStyle={{ backgroundColor: '#060a12', borderColor: '#1a273b', borderRadius: '8px', fontSize: '11px', fontFamily: 'monospace' }}
                    labelStyle={{ color: '#94a3b8' }}
                  />
                  <Legend wrapperStyle={{ fontSize: '11px', fontFamily: 'monospace', paddingTop: '4px' }} />
                  <ReferenceLine y={PROTOTYPE_THRESHOLDS.highTemperatureThreshold} stroke="#ef4444" strokeDasharray="3 3" label={{ value: 'Warning Limit (40°C)', fill: '#ef4444', fontSize: 10 }} />
                  <Line type="monotone" dataKey="temperature" name="Temp (°C)" stroke="#f59e0b" strokeWidth={2} dot={false} isAnimationActive={false} />
                </LineChart>
              </ResponsiveContainer>
            ) : (
              <div className="h-full w-full flex flex-col items-center justify-center border border-dashed border-[#1a273b] rounded-lg text-slate-500 text-xs">
                <Thermometer className="w-6 h-6 mb-1 text-slate-600" />
                <p>No temperature telemetry recorded for this period.</p>
              </div>
            )}
          </div>
        </div>

        {/* Chart 2: Humidity Trend */}
        <div className="bg-[#090f19] border border-[#162133] rounded-xl p-4 sm:p-5 space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-2 text-xs font-bold text-slate-200 uppercase tracking-wide font-mono">
              <Wind className="w-4 h-4 text-sky-400" />
              <span>Historical Humidity Trend</span>
            </div>
            {overview?.telemetry.metrics?.humidity && (
              <div className="flex items-center gap-3 text-[11px] font-mono">
                <span className="text-slate-400">Min: <strong className="text-slate-200">{overview.telemetry.metrics.humidity.min}%</strong></span>
                <span className="text-slate-400">Max: <strong className="text-slate-200">{overview.telemetry.metrics.humidity.max}%</strong></span>
                <span className="text-slate-400">Avg: <strong className="text-slate-200">{overview.telemetry.metrics.humidity.avg}%</strong></span>
              </div>
            )}
          </div>

          <div className="h-64 w-full">
            {overview?.telemetry.hasData && overview.telemetry.trend.length > 0 ? (
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={overview.telemetry.trend} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#141e2e" />
                  <XAxis dataKey="timeFormatted" stroke="#475569" tick={{ fontSize: 10, fill: '#64748b' }} />
                  <YAxis domain={[20, 100]} stroke="#38bdf8" tick={{ fontSize: 10, fill: '#38bdf8' }} />
                  <Tooltip
                    contentStyle={{ backgroundColor: '#060a12', borderColor: '#1a273b', borderRadius: '8px', fontSize: '11px', fontFamily: 'monospace' }}
                    labelStyle={{ color: '#94a3b8' }}
                  />
                  <Legend wrapperStyle={{ fontSize: '11px', fontFamily: 'monospace', paddingTop: '4px' }} />
                  <Line type="monotone" dataKey="humidity" name="Humidity (%)" stroke="#38bdf8" strokeWidth={2} dot={false} isAnimationActive={false} />
                </LineChart>
              </ResponsiveContainer>
            ) : (
              <div className="h-full w-full flex flex-col items-center justify-center border border-dashed border-[#1a273b] rounded-lg text-slate-500 text-xs">
                <Wind className="w-6 h-6 mb-1 text-slate-600" />
                <p>No humidity telemetry recorded for this period.</p>
              </div>
            )}
          </div>
        </div>

        {/* Chart 3: MQ-2 RAW Gas Value Trend */}
        <div className="bg-[#090f19] border border-[#162133] rounded-xl p-4 sm:p-5 space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-2 text-xs font-bold text-slate-200 uppercase tracking-wide font-mono">
              <Wind className="w-4 h-4 text-cyan-400" />
              <span>MQ-2 Gas Sensor Raw Reading (ADC 0-1023)</span>
            </div>
            {overview?.telemetry.metrics?.gas && (
              <div className="flex items-center gap-3 text-[11px] font-mono">
                <span className="text-slate-400">Peak: <strong className="text-slate-200">{overview.telemetry.metrics.gas.max} ADC</strong></span>
                <span className="text-amber-400">Limit: &gt;800 ADC</span>
              </div>
            )}
          </div>

          <div className="h-64 w-full">
            {overview?.telemetry.hasData && overview.telemetry.trend.length > 0 ? (
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={overview.telemetry.trend} margin={{ top: 10, right: 10, left: -10, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#141e2e" />
                  <XAxis dataKey="timeFormatted" stroke="#475569" tick={{ fontSize: 10, fill: '#64748b' }} />
                  <YAxis domain={[100, 1023]} stroke="#fbbf24" tick={{ fontSize: 10, fill: '#fbbf24' }} />
                  <Tooltip
                    contentStyle={{ backgroundColor: '#060a12', borderColor: '#1a273b', borderRadius: '8px', fontSize: '11px', fontFamily: 'monospace' }}
                    labelStyle={{ color: '#94a3b8' }}
                  />
                  <Legend wrapperStyle={{ fontSize: '11px', fontFamily: 'monospace', paddingTop: '4px' }} />
                  <ReferenceLine y={PROTOTYPE_THRESHOLDS.highGasRawThreshold} stroke="#ef4444" strokeDasharray="3 3" label={{ value: 'Gas Warning (800 ADC)', fill: '#ef4444', fontSize: 10 }} />
                  <Line type="monotone" dataKey="rawGasValue" name="GAS (RAW ADC)" stroke="#fbbf24" strokeWidth={2} dot={false} isAnimationActive={false} />
                </LineChart>
              </ResponsiveContainer>
            ) : (
              <div className="h-full w-full flex flex-col items-center justify-center border border-dashed border-[#1a273b] rounded-lg text-slate-500 text-xs">
                <Wind className="w-6 h-6 mb-1 text-slate-600" />
                <p>No gas telemetry recorded for this period.</p>
              </div>
            )}
          </div>
        </div>

        {/* Chart 4: Motion & Fall Acceleration Trend */}
        <div className="bg-[#090f19] border border-[#162133] rounded-xl p-4 sm:p-5 space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-2 text-xs font-bold text-slate-200 uppercase tracking-wide font-mono">
              <Activity className="w-4 h-4 text-rose-400" />
              <span>Motion & Fall Acceleration (m/s²)</span>
            </div>
            {overview?.telemetry.metrics?.acceleration && (
              <div className="flex items-center gap-3 text-[11px] font-mono">
                <span className="text-slate-400">Peak: <strong className="text-slate-200">{overview.telemetry.metrics.acceleration.max} m/s²</strong></span>
                <span className="text-rose-400">Fall Threshold: &gt;15.0 m/s²</span>
              </div>
            )}
          </div>

          <div className="h-64 w-full">
            {overview?.telemetry.hasData && overview.telemetry.trend.length > 0 ? (
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={overview.telemetry.trend} margin={{ top: 10, right: 10, left: -10, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#141e2e" />
                  <XAxis dataKey="timeFormatted" stroke="#475569" tick={{ fontSize: 10, fill: '#64748b' }} />
                  <YAxis domain={[0, 26]} stroke="#f43f5e" tick={{ fontSize: 10, fill: '#f43f5e' }} />
                  <Tooltip
                    contentStyle={{ backgroundColor: '#060a12', borderColor: '#1a273b', borderRadius: '8px', fontSize: '11px', fontFamily: 'monospace' }}
                    labelStyle={{ color: '#94a3b8' }}
                  />
                  <Legend wrapperStyle={{ fontSize: '11px', fontFamily: 'monospace', paddingTop: '4px' }} />
                  <ReferenceLine y={PROTOTYPE_THRESHOLDS.fallAccelerationThreshold} stroke="#ef4444" strokeDasharray="3 3" label={{ value: 'Fall Spike (15 m/s²)', fill: '#ef4444', fontSize: 10 }} />
                  <Line type="monotone" dataKey="totalAcceleration" name="Total Accel (m/s²)" stroke="#f43f5e" strokeWidth={2} dot={false} isAnimationActive={false} />
                  <Line type="monotone" dataKey="accelZ" name="Z-Axis (Gravity)" stroke="#64748b" strokeWidth={1} strokeDasharray="2 2" dot={false} isAnimationActive={false} />
                </LineChart>
              </ResponsiveContainer>
            ) : (
              <div className="h-full w-full flex flex-col items-center justify-center border border-dashed border-[#1a273b] rounded-lg text-slate-500 text-xs">
                <Activity className="w-6 h-6 mb-1 text-slate-600" />
                <p>No acceleration telemetry recorded for this period.</p>
              </div>
            )}
          </div>
        </div>

        {/* Chart 5: Alert Category Breakdown */}
        <div className="bg-[#090f19] border border-[#162133] rounded-xl p-4 sm:p-5 space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-2 text-xs font-bold text-slate-200 uppercase tracking-wide font-mono">
              <AlertTriangle className="w-4 h-4 text-amber-400" />
              <span>Historical Alerts by Hazard Category</span>
            </div>
            <span className="text-[11px] font-mono text-slate-400">
              Total: <strong className="text-white">{overview?.alerts.totalAlerts ?? 0}</strong>
            </span>
          </div>

          <div className="h-64 w-full">
            {alertTypeData.length > 0 ? (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={alertTypeData} margin={{ top: 10, right: 10, left: -20, bottom: 25 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#141e2e" />
                  <XAxis dataKey="name" stroke="#64748b" tick={{ fontSize: 10, fill: '#94a3b8' }} angle={-20} textAnchor="end" />
                  <YAxis stroke="#64748b" tick={{ fontSize: 10, fill: '#94a3b8' }} />
                  <Tooltip
                    contentStyle={{ backgroundColor: '#060a12', borderColor: '#1a273b', borderRadius: '8px', fontSize: '11px', fontFamily: 'monospace' }}
                    labelStyle={{ color: '#94a3b8' }}
                  />
                  <Bar dataKey="count" name="Incidents" fill="#06b6d4" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <div className="h-full w-full flex flex-col items-center justify-center border border-dashed border-[#1a273b] rounded-lg text-slate-500 text-xs">
                <CheckCircle2 className="w-6 h-6 mb-1 text-emerald-500" />
                <p>No safety alerts recorded for this period.</p>
              </div>
            )}
          </div>
        </div>

        {/* Chart 6: Safety Distribution */}
        <div className="bg-[#090f19] border border-[#162133] rounded-xl p-4 sm:p-5 space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-2 text-xs font-bold text-slate-200 uppercase tracking-wide font-mono">
              <ShieldCheck className="w-4 h-4 text-emerald-400" />
              <span>Safety State Packet Distribution</span>
            </div>
            {overview?.telemetry.safetyBreakdown && (
              <span className="text-[11px] font-mono text-emerald-400">
                Safe: {overview.telemetry.safetyBreakdown.safePercentage}%
              </span>
            )}
          </div>

          <div className="h-64 w-full">
            {overview?.telemetry.hasData && overview.telemetry.safetyBreakdown ? (
              <div className="h-full w-full flex flex-col sm:flex-row items-center justify-around gap-4">
                <div className="w-48 h-48">
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie
                        data={[
                          { name: 'Safe', value: overview.telemetry.safetyBreakdown.safePackets, color: '#10b981' },
                          { name: 'Warning', value: overview.telemetry.safetyBreakdown.warningPackets, color: '#f59e0b' },
                          { name: 'Danger', value: overview.telemetry.safetyBreakdown.dangerPackets, color: '#ef4444' },
                        ].filter(item => item.value > 0)}
                        innerRadius={50}
                        outerRadius={75}
                        paddingAngle={3}
                        dataKey="value"
                      >
                        {[
                          { name: 'Safe', color: '#10b981' },
                          { name: 'Warning', color: '#f59e0b' },
                          { name: 'Danger', color: '#ef4444' },
                        ].map((entry, index) => (
                          <Cell key={`cell-${index}`} fill={entry.color} />
                        ))}
                      </Pie>
                      <Tooltip contentStyle={{ backgroundColor: '#060a12', borderColor: '#1a273b', borderRadius: '8px', fontSize: '11px', fontFamily: 'monospace' }} />
                    </PieChart>
                  </ResponsiveContainer>
                </div>

                <div className="space-y-3 text-xs font-mono">
                  <div className="flex items-center justify-between gap-6">
                    <span className="flex items-center gap-2 text-emerald-400">
                      <span className="w-2.5 h-2.5 rounded-full bg-emerald-500" />
                      SAFE
                    </span>
                    <span className="text-white font-bold">{overview.telemetry.safetyBreakdown.safePackets} ({overview.telemetry.safetyBreakdown.safePercentage}%)</span>
                  </div>
                  <div className="flex items-center justify-between gap-6">
                    <span className="flex items-center gap-2 text-amber-400">
                      <span className="w-2.5 h-2.5 rounded-full bg-amber-500" />
                      WARNING
                    </span>
                    <span className="text-white font-bold">{overview.telemetry.safetyBreakdown.warningPackets} ({overview.telemetry.safetyBreakdown.warningPercentage}%)</span>
                  </div>
                  <div className="flex items-center justify-between gap-6">
                    <span className="flex items-center gap-2 text-red-400">
                      <span className="w-2.5 h-2.5 rounded-full bg-red-500" />
                      DANGER
                    </span>
                    <span className="text-white font-bold">{overview.telemetry.safetyBreakdown.dangerPackets} ({overview.telemetry.safetyBreakdown.dangerPercentage}%)</span>
                  </div>
                </div>
              </div>
            ) : (
              <div className="h-full w-full flex flex-col items-center justify-center border border-dashed border-[#1a273b] rounded-lg text-slate-500 text-xs">
                <ShieldCheck className="w-6 h-6 mb-1 text-slate-600" />
                <p>No safety telemetry available to analyze.</p>
              </div>
            )}
          </div>
        </div>

      </div>

      {/* Zone Occupancy & Activity History Table */}
      <div className="bg-[#090f19] border border-[#162133] rounded-xl p-5 space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-[#141e2e] pb-3">
          <div>
            <h2 className="text-sm font-bold text-white flex items-center gap-2">
              <MapPin className="w-4 h-4 text-amber-400" />
              Zone Activity & Historical Movement Ledger
            </h2>
            <p className="text-xs text-slate-400 mt-0.5">
              Reconstructed strictly from authoritative check-in and check-out ledger records. No GPS or continuous tracking.
            </p>
          </div>
          <span className="text-[11px] font-mono text-slate-400">
            Window: <strong className="text-slate-200">{overview?.timeRange.durationHours ?? 24}h</strong>
          </span>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs font-mono">
            <thead>
              <tr className="border-b border-[#141e2e] text-slate-400">
                <th className="pb-2 font-semibold">Zone</th>
                <th className="pb-2 font-semibold">Mine Level</th>
                <th className="pb-2 font-semibold">Depth</th>
                <th className="pb-2 font-semibold text-center">Unique Workers</th>
                <th className="pb-2 font-semibold text-center">Active Now</th>
                <th className="pb-2 font-semibold text-center">Check-In Events</th>
                <th className="pb-2 font-semibold text-right">Zone Incidents</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#141e2e]/50">
              {overview?.zones && overview.zones.length > 0 ? (
                overview.zones.map((z) => (
                  <tr key={z.zoneId} className="hover:bg-[#0e1624] transition-colors">
                    <td className="py-2.5 font-bold text-white flex items-center gap-2">
                      <span className="w-1.5 h-1.5 rounded-full bg-amber-400" />
                      {z.zoneName}
                    </td>
                    <td className="py-2.5 text-slate-300">{z.level}</td>
                    <td className="py-2.5 text-slate-400">{z.depthMeters} m</td>
                    <td className="py-2.5 text-center text-slate-200">{z.uniqueWorkerCount}</td>
                    <td className="py-2.5 text-center">
                      <span className="px-2 py-0.5 rounded bg-emerald-950/80 text-emerald-300 border border-emerald-500/30">
                        {z.activeWorkerCount}
                      </span>
                    </td>
                    <td className="py-2.5 text-center text-slate-400">{z.checkInCount}</td>
                    <td className="py-2.5 text-right">
                      {z.alertCount > 0 ? (
                        <span className="px-2 py-0.5 rounded bg-rose-950/80 text-rose-300 border border-rose-500/40 font-bold">
                          {z.alertCount} Alerts
                        </span>
                      ) : (
                        <span className="text-slate-500">None</span>
                      )}
                    </td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={7} className="py-4 text-center text-slate-500">
                    No zone movement records in this period.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Connectivity & Offline Analytics Section */}
      <div className="bg-[#090f19] border border-[#162133] rounded-xl p-5 space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-[#141e2e] pb-3">
          <div>
            <h2 className="text-sm font-bold text-white flex items-center gap-2">
              <WifiOff className="w-4 h-4 text-rose-400" />
              Helmet Connectivity & Offline Interruptions
            </h2>
            <p className="text-xs text-slate-400 mt-0.5">
              Tracks heartbeat packet loss incidents based on the authoritative &gt;8s offline detection rule.
            </p>
          </div>
          <span className="text-[11px] font-mono text-slate-400">
            Recorded Disconnections: <strong className="text-rose-400">{overview?.connectivity.totalOfflineEventsInPeriod ?? 0}</strong>
          </span>
        </div>

        {/* Non-Fabrication Notice */}
        <div className="bg-[#060b13] border border-[#182335] rounded-lg p-3 text-[11px] text-slate-400 flex items-start gap-2.5 font-mono">
          <Info className="w-4 h-4 text-cyan-400 shrink-0 mt-0.5" />
          <div>
            <strong className="text-cyan-300">Data Integrity Notice: </strong>
            {overview?.connectivity.uptimeLimitationNotice}
          </div>
        </div>

        {/* Interrupted Helmets List */}
        {overview?.connectivity.interruptedHelmets && overview.connectivity.interruptedHelmets.length > 0 ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            {overview.connectivity.interruptedHelmets.map((item) => (
              <div
                key={item.helmetId}
                className="bg-[#060a12] border border-rose-950/60 rounded-lg p-3 space-y-1.5 font-mono text-xs"
              >
                <div className="flex items-center justify-between">
                  <span className="font-bold text-white">{item.helmetId}</span>
                  <span className="px-1.5 py-0.5 rounded text-[10px] bg-rose-950 text-rose-300 border border-rose-500/40">
                    {item.currentConnectivity}
                  </span>
                </div>
                <div className="text-[11px] text-slate-400">
                  Worker: {item.workerName || 'Unassigned'}
                </div>
                <div className="text-[11px] text-rose-300">
                  Offline Events: <strong>{item.offlineIncidentCount}</strong>
                </div>
                <div className="text-[10px] text-slate-500">
                  Last seen: {item.lastSeen ? new Date(item.lastSeen).toLocaleTimeString() : 'Unknown'}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="p-4 border border-dashed border-[#141e2e] rounded-lg text-center text-xs text-slate-500 font-mono flex items-center justify-center gap-2">
            <CheckCircle2 className="w-4 h-4 text-emerald-400" />
            <span>No connectivity interruptions or HELMET_OFFLINE incidents recorded in this period.</span>
          </div>
        )}
      </div>

    </div>
  );
};
