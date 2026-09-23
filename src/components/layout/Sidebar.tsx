/**
 * MineCare - Persistent Left Sidebar
 * Exact visual match to Lovable reference implementation.
 */

import React, { useState, useEffect } from 'react';
import { 
  LayoutDashboard, 
  HardHat, 
  Users, 
  Bell, 
  BarChart2, 
  Cpu, 
  Radio
} from 'lucide-react';
import { useTelemetry } from '../../context/TelemetryContext';

export type NavRoute = 
  | '/'
  | '/fleet'
  | '/workers'
  | '/alerts'
  | '/analytics'
  | '/system';

interface SidebarProps {
  currentRoute: NavRoute;
  onRouteChange: (route: NavRoute) => void;
}

export const Sidebar: React.FC<SidebarProps> = ({ currentRoute, onRouteChange }) => {
  const { alerts, activeDangerCount } = useTelemetry();
  const unacknowledgedCount = alerts.filter(a => !a.acknowledged).length;

  const [streamingTime, setStreamingTime] = useState<string>('');

  useEffect(() => {
    const update = () => {
      const now = new Date();
      setStreamingTime(now.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit' }));
    };
    update();
    const interval = setInterval(update, 1000);
    return () => clearInterval(interval);
  }, []);

  const navItems: { route: NavRoute; label: string; icon: React.ElementType; badge?: string | null }[] = [
    {
      route: '/',
      label: 'Dashboard',
      icon: LayoutDashboard,
    },
    {
      route: '/fleet',
      label: 'Helmets',
      icon: HardHat,
    },
    {
      route: '/workers',
      label: 'Workers',
      icon: Users,
    },
    {
      route: '/alerts',
      label: 'Alerts',
      icon: Bell,
      badge: unacknowledgedCount > 0 ? `${unacknowledgedCount}` : null,
    },
    {
      route: '/analytics',
      label: 'Analytics',
      icon: BarChart2,
    },
    {
      route: '/system',
      label: 'System health',
      icon: Cpu,
    },
  ];

  return (
    <aside className="w-60 bg-[#080d16] border-r border-[#151f30] flex flex-col justify-between shrink-0 select-none h-screen sticky top-0">
      <div className="p-4 space-y-6">
        {/* Brand Header */}
        <div className="flex items-center space-x-3 px-2">
          <div className="w-8 h-8 rounded-lg bg-cyan-950/90 border border-cyan-500/40 flex items-center justify-center text-cyan-400 shrink-0">
            <HardHat className="w-4 h-4" />
          </div>
          <div>
            <div className="font-bold text-white text-sm tracking-tight">
              MineCare
            </div>
            <div className="text-[9px] uppercase tracking-wider text-slate-400 font-mono font-medium">
              SAFETY OPERATIONS
            </div>
          </div>
        </div>

        {/* Navigation List */}
        <nav className="space-y-1">
          {navItems.map((item) => {
            const Icon = item.icon;
            const isActive = currentRoute === item.route;

            return (
              <button
                key={item.route}
                onClick={() => onRouteChange(item.route)}
                className={`w-full flex items-center justify-between px-3 py-2 rounded-lg text-xs font-medium transition-colors ${
                  isActive
                    ? 'bg-[#131d2c] text-white'
                    : 'text-slate-400 hover:text-slate-200 hover:bg-[#0c1420]'
                }`}
              >
                <div className="flex items-center space-x-3">
                  <Icon className={`w-4 h-4 ${isActive ? 'text-cyan-400' : 'text-slate-400'}`} />
                  <span>{item.label}</span>
                </div>

                {item.badge && (
                  <span className={`text-[10px] px-1.5 py-0.2 rounded-full font-bold ${
                    activeDangerCount > 0 
                      ? 'bg-red-500 text-white animate-pulse' 
                      : 'bg-amber-500/20 text-amber-300 border border-amber-500/40'
                  }`}>
                    {item.badge}
                  </span>
                )}
              </button>
            );
          })}
        </nav>
      </div>

      {/* Bottom Source Indicator Card */}
      <div className="p-3 m-3 rounded-lg bg-[#0d1420] border border-[#1a2538] text-xs space-y-1.5">
        <div className="flex items-center space-x-1.5 text-slate-400 text-[10px] font-mono uppercase tracking-wider">
          <Radio className="w-3 h-3 text-cyan-400" />
          <span>SOURCE</span>
        </div>
        <div className="text-slate-200 text-xs font-medium">
          Mock telemetry (simulated)
        </div>
        <div className="flex items-center space-x-1.5 text-[11px] text-emerald-400 font-mono">
          <span className="w-2 h-2 rounded-full bg-emerald-400 inline-block animate-pulse" />
          <span>Streaming • {streamingTime}</span>
        </div>
      </div>
    </aside>
  );
};
