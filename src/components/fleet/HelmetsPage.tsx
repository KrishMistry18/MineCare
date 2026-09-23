/**
 * MineCare - Helmets Fleet Page
 * Supports both [ GRID ] (helmet telemetry cards) and [ MINE MAP ] (underground schematic).
 */

import React, { useState, useEffect } from 'react';
import { Search, LayoutGrid, Map, Filter } from 'lucide-react';
import { useTelemetry } from '../../context/TelemetryContext';
import { HelmetCard } from '../dashboard/HelmetCard';
import { MineMap } from './MineMap';

interface HelmetsPageProps {
  onInspectHelmet: (helmetId: string) => void;
  initialView?: 'GRID' | 'MAP';
  initialZone?: string | null;
}

export const HelmetsPage: React.FC<HelmetsPageProps> = ({ 
  onInspectHelmet,
  initialView = 'GRID',
  initialZone = null,
}) => {
  const { 
    helmets, 
    workers, 
    zoneOccupancies, 
    selectedZone, 
    setSelectedZone,
    changeWorkerZone,
    checkOutWorker
  } = useTelemetry();

  const [viewMode, setViewMode] = useState<'GRID' | 'MAP'>(initialZone ? 'MAP' : initialView);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<'ALL' | 'DANGER' | 'WARNING' | 'SAFE' | 'OFFLINE'>('ALL');

  useEffect(() => {
    if (initialZone) {
      setSelectedZone(initialZone);
    }
  }, [initialZone, setSelectedZone]);

  const searchLower = search.toLowerCase();

  const filteredHelmets = helmets.filter(h => {
    const worker = workers.find(w => w.assignedHelmetId === h.helmetId);
    const activeZone = worker?.currentWorkZone || worker?.assignedZone || '';

    const matchesSearch = 
      h.helmetId.toLowerCase().includes(searchLower) ||
      (worker?.name.toLowerCase() || '').includes(searchLower) ||
      activeZone.toLowerCase().includes(searchLower);

    const matchesStatus = 
      statusFilter === 'ALL' ||
      (statusFilter === 'OFFLINE' && h.connectivity === 'OFFLINE') ||
      (statusFilter !== 'OFFLINE' && h.safety.status === statusFilter && h.connectivity !== 'OFFLINE');

    return matchesSearch && matchesStatus;
  });

  return (
    <div className="space-y-6">
      {/* Header & View Switcher */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-white tracking-tight">
            Helmet fleet & Mine Map
          </h1>
          <p className="text-xs text-slate-400 mt-1">
            {helmets.length} simulated helmets streaming telemetry · Zone-based underground occupancy.
          </p>
        </div>

        {/* View Switcher: [ GRID ] [ MINE MAP ] */}
        <div className="flex items-center space-x-1 bg-[#0c131f] p-1 rounded-xl border border-[#182335] text-xs self-start sm:self-auto font-sans shadow-xs">
          <button
            onClick={() => setViewMode('GRID')}
            className={`px-3 py-1.5 rounded-lg transition-all flex items-center space-x-1.5 font-bold font-mono tracking-wider cursor-pointer ${
              viewMode === 'GRID'
                ? 'bg-cyan-500 text-slate-950 shadow-sm'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <LayoutGrid className="w-3.5 h-3.5" />
            <span>GRID</span>
          </button>

          <button
            onClick={() => setViewMode('MAP')}
            className={`px-3 py-1.5 rounded-lg transition-all flex items-center space-x-1.5 font-bold font-mono tracking-wider cursor-pointer ${
              viewMode === 'MAP'
                ? 'bg-cyan-500 text-slate-950 shadow-sm'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <Map className="w-3.5 h-3.5" />
            <span>MINE MAP</span>
          </button>
        </div>
      </div>

      {/* Filter and Search Bar */}
      <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3">
        {/* Search */}
        <div className="relative min-w-[280px]">
          <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            placeholder="Search helmet (MC-001), worker or zone..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full bg-[#0c131f] border border-[#182335] rounded-lg pl-9 pr-3 py-2 text-xs text-slate-200 placeholder-slate-500 focus:outline-none focus:border-cyan-500"
          />
        </div>

        {/* Filter Pills */}
        <div className="flex items-center space-x-1 bg-[#0c131f] p-1 rounded-lg border border-[#182335] text-xs self-start sm:self-auto font-sans">
          <div className="px-2 text-slate-500 flex items-center">
            <Filter className="w-3 h-3" />
          </div>
          {(['ALL', 'DANGER', 'WARNING', 'SAFE', 'OFFLINE'] as const).map(filter => {
            const label = filter === 'ALL' ? 'All' : filter.charAt(0) + filter.slice(1).toLowerCase();
            const isActive = statusFilter === filter;

            return (
              <button
                key={filter}
                onClick={() => setStatusFilter(filter)}
                className={`px-3 py-1 rounded-md transition-colors cursor-pointer ${
                  isActive
                    ? 'bg-[#182438] text-white font-medium shadow-sm'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                {label}
              </button>
            );
          })}
        </div>
      </div>

      {/* Content: Either MINE MAP or GRID */}
      {viewMode === 'MAP' ? (
        <MineMap
          zoneOccupancies={zoneOccupancies}
          workers={workers}
          helmets={helmets}
          searchQuery={search}
          statusFilter={statusFilter}
          selectedZoneName={selectedZone}
          onSelectZone={setSelectedZone}
          onInspectHelmet={onInspectHelmet}
          onChangeWorkerZone={changeWorkerZone}
          onCheckOutWorker={checkOutWorker}
        />
      ) : (
        /* 3-Column Grid of 16 Helmets */
        filteredHelmets.length === 0 ? (
          <div className="bg-[#0c131f] border border-[#182335] rounded-xl p-12 text-center text-slate-400 text-sm">
            No helmets match your search or filter criteria.
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3.5">
            {filteredHelmets.map(helmet => (
              <HelmetCard
                key={helmet.helmetId}
                helmet={helmet}
                onClick={onInspectHelmet}
              />
            ))}
          </div>
        )
      )}
    </div>
  );
};
