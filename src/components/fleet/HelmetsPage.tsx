/**
 * MineCare - Helmets Fleet Page
 * Matching Lovable reference screenshot 3 & 4 (3-column desktop grid with search & filters).
 */

import React, { useState } from 'react';
import { Search } from 'lucide-react';
import { useTelemetry } from '../../context/TelemetryContext';
import { HelmetCard } from '../dashboard/HelmetCard';
import { INITIAL_WORKERS } from '../../data/mockData';

interface HelmetsPageProps {
  onInspectHelmet: (helmetId: string) => void;
}

export const HelmetsPage: React.FC<HelmetsPageProps> = ({ onInspectHelmet }) => {
  const { helmets } = useTelemetry();
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<'ALL' | 'DANGER' | 'WARNING' | 'SAFE' | 'OFFLINE'>('ALL');

  const filteredHelmets = helmets.filter(h => {
    const worker = INITIAL_WORKERS.find(w => w.assignedHelmetId === h.helmetId);
    const searchLower = search.toLowerCase();
    const matchesSearch = 
      h.helmetId.toLowerCase().includes(searchLower) ||
      (worker?.name.toLowerCase() || '').includes(searchLower) ||
      (worker?.zone.toLowerCase() || '').includes(searchLower);

    const matchesStatus = 
      statusFilter === 'ALL' ||
      (statusFilter === 'OFFLINE' && h.connectivity === 'OFFLINE') ||
      (statusFilter !== 'OFFLINE' && h.safety.status === statusFilter && h.connectivity !== 'OFFLINE');

    return matchesSearch && matchesStatus;
  });

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-white tracking-tight">
          Helmet fleet
        </h1>
        <p className="text-xs text-slate-400 mt-1">
          {helmets.length} simulated helmets streaming telemetry every 2 seconds.
        </p>
      </div>

      {/* Filter and Search Bar */}
      <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3">
        {/* Search */}
        <div className="relative min-w-[280px]">
          <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            placeholder="Search helmet, worker or zone"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full bg-[#0c131f] border border-[#182335] rounded-lg pl-9 pr-3 py-2 text-xs text-slate-200 placeholder-slate-500 focus:outline-none focus:border-cyan-500"
          />
        </div>

        {/* Filter Pills */}
        <div className="flex items-center space-x-1 bg-[#0c131f] p-1 rounded-lg border border-[#182335] text-xs self-start sm:self-auto font-sans">
          {(['ALL', 'DANGER', 'WARNING', 'SAFE', 'OFFLINE'] as const).map(filter => {
            const label = filter === 'ALL' ? 'All' : filter.charAt(0) + filter.slice(1).toLowerCase();
            const isActive = statusFilter === filter;

            return (
              <button
                key={filter}
                onClick={() => setStatusFilter(filter)}
                className={`px-3 py-1 rounded-md transition-colors ${
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

      {/* 3-Column Grid of 16 Helmets */}
      {filteredHelmets.length === 0 ? (
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
      )}
    </div>
  );
};
