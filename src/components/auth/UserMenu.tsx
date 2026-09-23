/**
 * MineCare - Compact Authenticated User Menu
 *
 * Displays active user name, role badge, and logout trigger.
 * Industrial control-room aesthetic.
 */

import React, { useState } from 'react';
import { useAuth } from '../../context/AuthContext';
import { LogOut, Shield, User, Loader2 } from 'lucide-react';

interface UserMenuProps {
  compact?: boolean;
}

export const UserMenu: React.FC<UserMenuProps> = ({ compact = false }) => {
  const { user, role, logout } = useAuth();
  const [loggingOut, setLoggingOut] = useState(false);

  if (!user) return null;

  const handleLogout = async () => {
    try {
      setLoggingOut(true);
      await logout();
    } catch (err) {
      console.error('Logout error:', err);
    } finally {
      setLoggingOut(false);
    }
  };

  const getRoleBadgeClass = () => {
    switch (role) {
      case 'ADMIN':
        return 'bg-purple-950/80 text-purple-300 border-purple-600/50';
      case 'SUPERVISOR':
        return 'bg-cyan-950/80 text-cyan-300 border-cyan-600/50';
      case 'WORKER':
        return 'bg-emerald-950/80 text-emerald-300 border-emerald-600/50';
      default:
        return 'bg-slate-800 text-slate-300 border-slate-700';
    }
  };

  if (compact) {
    return (
      <div className="flex items-center space-x-2">
        <div className="flex flex-col text-right">
          <span className="text-xs font-semibold text-white tracking-tight">{user.name}</span>
          <span className={`text-[9px] font-mono px-1 rounded border inline-block ${getRoleBadgeClass()}`}>
            {role}
          </span>
        </div>
        <button
          onClick={handleLogout}
          disabled={loggingOut}
          title="Sign Out"
          className="p-1.5 rounded-md bg-[#131d2c] hover:bg-rose-950/40 text-slate-400 hover:text-rose-400 border border-[#1b2538] hover:border-rose-500/40 transition-colors"
        >
          {loggingOut ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <LogOut className="w-3.5 h-3.5" />}
        </button>
      </div>
    );
  }

  return (
    <div className="p-3 mx-3 my-2 rounded-lg bg-[#0d1420] border border-[#1a2538] flex items-center justify-between text-xs">
      <div className="flex items-center space-x-2.5 min-w-0">
        <div className="w-7 h-7 rounded-md bg-[#141e2e] border border-[#223147] flex items-center justify-center text-slate-300 shrink-0">
          {role === 'ADMIN' ? <Shield className="w-3.5 h-3.5 text-purple-400" /> : <User className="w-3.5 h-3.5 text-cyan-400" />}
        </div>
        <div className="min-w-0">
          <div className="text-slate-100 font-medium truncate text-xs">
            {user.name}
          </div>
          <div className="flex items-center gap-1.5 mt-0.5">
            <span className={`text-[9px] font-mono font-semibold px-1 py-0.2 rounded border ${getRoleBadgeClass()}`}>
              {role}
            </span>
            {user.worker_id && (
              <span className="text-[9px] font-mono text-slate-400">
                {user.worker_id}
              </span>
            )}
          </div>
        </div>
      </div>

      <button
        onClick={handleLogout}
        disabled={loggingOut}
        className="ml-2 px-2 py-1 rounded bg-[#131d2c] hover:bg-rose-950/50 text-slate-400 hover:text-rose-300 border border-[#1b2538] hover:border-rose-500/40 text-[11px] font-medium flex items-center space-x-1 transition-colors shrink-0"
        title="Logout from MineCare"
      >
        {loggingOut ? (
          <Loader2 className="w-3 h-3 animate-spin" />
        ) : (
          <>
            <LogOut className="w-3 h-3" />
            <span>Logout</span>
          </>
        )}
      </button>
    </div>
  );
};
