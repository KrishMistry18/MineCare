/**
 * MineCare - Industrial Safety Control-Room Login Page
 *
 * Implements authoritative authentication via Supabase / Backend API.
 * Strict credential verification, error states, and session persistence.
 */

import React, { useState } from 'react';
import { useAuth } from '../../context/AuthContext';
import { HardHat, Lock, Mail, AlertTriangle, Loader2, ArrowRight, ShieldCheck } from 'lucide-react';

interface LoginPageProps {
  onSuccess?: () => void;
}

export const LoginPage: React.FC<LoginPageProps> = ({ onSuccess }) => {
  const { login, error: authContextError, clearError } = useAuth();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [localError, setLocalError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLocalError(null);
    clearError();

    if (!email.trim()) {
      setLocalError('Please enter your operational email address.');
      return;
    }

    if (!password) {
      setLocalError('Please enter your access password.');
      return;
    }

    try {
      setLoading(true);
      await login(email.trim(), password);
      if (onSuccess) {
        onSuccess();
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Invalid credentials. Access denied.';
      setLocalError(msg);
    } finally {
      setLoading(false);
    }
  };

  const handleQuickFill = (demoEmail: string) => {
    setEmail(demoEmail);
    setPassword('MineCare#2026!');
    setLocalError(null);
    clearError();
  };

  const displayError = localError || authContextError;

  return (
    <div className="min-h-screen bg-[#080c14] text-slate-100 flex flex-col justify-center items-center p-4 relative overflow-hidden font-sans selection:bg-cyan-500/20 selection:text-cyan-200">
      {/* Background ambient grid styling */}
      <div className="absolute inset-0 bg-[linear-gradient(to_right,#0d1624_1px,transparent_1px),linear-gradient(to_bottom,#0d1624_1px,transparent_1px)] bg-[size:4rem_4rem] [mask-image:radial-gradient(ellipse_60%_50%_at_50%_50%,#000_70%,transparent_100%)] opacity-40 pointer-events-none" />

      {/* Top Console Status Accent */}
      <div className="absolute top-4 left-4 right-4 flex items-center justify-between text-xs font-mono text-slate-500 border-b border-[#141e2e] pb-2">
        <div className="flex items-center space-x-2">
          <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
          <span>MINECARE AUTHORIZATION GATEWAY v3.0</span>
        </div>
        <div className="hidden sm:flex items-center space-x-2 text-[11px] text-slate-400">
          <ShieldCheck className="w-3.5 h-3.5 text-cyan-400" />
          <span>POSTGRESQL ROW LEVEL SECURITY ENFORCED</span>
        </div>
      </div>

      <div className="w-full max-w-md relative z-10">
        {/* Branding Header */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-cyan-950/80 border border-cyan-500/40 text-cyan-400 shadow-lg shadow-cyan-950/50 mb-4">
            <HardHat className="w-7 h-7" />
          </div>
          <h1 className="text-2xl font-bold tracking-tight text-white flex items-center justify-center gap-2">
            MINECARE
            <span className="text-xs px-2 py-0.5 rounded font-mono font-medium bg-cyan-950/60 border border-cyan-500/30 text-cyan-300">
              OPERATIONS
            </span>
          </h1>
          <p className="text-xs text-slate-400 mt-1.5 font-medium">
            Smart Mine Safety Helmet Telemetry & Operations Console
          </p>
        </div>

        {/* Authentication Card */}
        <div className="bg-[#0b121d] border border-[#182436] rounded-xl p-6 sm:p-8 shadow-2xl shadow-black/80 backdrop-blur-sm relative">
          <div className="mb-6">
            <h2 className="text-base font-semibold text-white">Operator Sign In</h2>
            <p className="text-xs text-slate-400 mt-0.5">
              Authenticate with your credentials to access telemetry and mission-critical controls.
            </p>
          </div>

          {/* Error Banner */}
          {displayError && (
            <div className="mb-5 p-3 rounded-lg bg-rose-950/50 border border-rose-600/50 text-rose-200 text-xs flex items-start space-x-2.5 animate-fadeIn">
              <AlertTriangle className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
              <div className="flex-1">
                <span className="font-semibold">Authentication Error: </span>
                <span>{displayError}</span>
              </div>
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-xs font-medium text-slate-300 mb-1.5 font-mono">
                OPERATIONAL EMAIL
              </label>
              <div className="relative">
                <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-slate-400">
                  <Mail className="w-4 h-4" />
                </div>
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="operator@minecare.local"
                  required
                  disabled={loading}
                  className="w-full pl-9 pr-3 py-2 bg-[#060a12] border border-[#1b263b] rounded-lg text-sm text-slate-100 placeholder-slate-500 focus:outline-none focus:border-cyan-500/80 focus:ring-1 focus:ring-cyan-500/50 transition-colors"
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-300 mb-1.5 font-mono">
                SECURITY PASSWORD
              </label>
              <div className="relative">
                <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-slate-400">
                  <Lock className="w-4 h-4" />
                </div>
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••••••"
                  required
                  disabled={loading}
                  className="w-full pl-9 pr-3 py-2 bg-[#060a12] border border-[#1b263b] rounded-lg text-sm text-slate-100 placeholder-slate-500 focus:outline-none focus:border-cyan-500/80 focus:ring-1 focus:ring-cyan-500/50 transition-colors"
                />
              </div>
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full mt-2 py-2.5 px-4 bg-cyan-600 hover:bg-cyan-500 disabled:bg-cyan-900/50 text-white rounded-lg font-medium text-sm flex items-center justify-center space-x-2 shadow-lg shadow-cyan-900/40 hover:shadow-cyan-700/50 transition-all cursor-pointer disabled:cursor-not-allowed border border-cyan-400/30"
            >
              {loading ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin text-white" />
                  <span>Authorizing Session...</span>
                </>
              ) : (
                <>
                  <span>Sign In to Console</span>
                  <ArrowRight className="w-4 h-4" />
                </>
              )}
            </button>
          </form>

          {/* Local Development Quick Role Switcher */}
          <div className="mt-6 pt-5 border-t border-[#162133]">
            <div className="text-[11px] font-mono text-slate-400 uppercase tracking-wider mb-2.5 flex items-center justify-between">
              <span>Development Test Accounts</span>
              <span className="text-[10px] text-cyan-400/80">Click to autofill</span>
            </div>
            <div className="grid grid-cols-3 gap-2">
              <button
                type="button"
                onClick={() => handleQuickFill('admin@minecare.local')}
                className="p-2 rounded bg-[#070c14] hover:bg-[#121c2d] border border-[#1a2538] hover:border-purple-500/50 text-left transition-all group"
              >
                <div className="text-[10px] font-bold text-purple-400 font-mono">ADMIN</div>
                <div className="text-[9px] text-slate-400 truncate group-hover:text-slate-200">admin@minecare.local</div>
              </button>
              <button
                type="button"
                onClick={() => handleQuickFill('supervisor@minecare.local')}
                className="p-2 rounded bg-[#070c14] hover:bg-[#121c2d] border border-[#1a2538] hover:border-cyan-500/50 text-left transition-all group"
              >
                <div className="text-[10px] font-bold text-cyan-400 font-mono">SUPERVISOR</div>
                <div className="text-[9px] text-slate-400 truncate group-hover:text-slate-200">supervisor@minecare.local</div>
              </button>
              <button
                type="button"
                onClick={() => handleQuickFill('worker.marak@minecare.local')}
                className="p-2 rounded bg-[#070c14] hover:bg-[#121c2d] border border-[#1a2538] hover:border-emerald-500/50 text-left transition-all group"
              >
                <div className="text-[10px] font-bold text-emerald-400 font-mono">WORKER</div>
                <div className="text-[9px] text-slate-400 truncate group-hover:text-slate-200">worker.marak@minecare.local</div>
              </button>
            </div>
          </div>
        </div>

        {/* Security Notice Footer */}
        <div className="text-center mt-6 text-[11px] text-slate-500">
          Industrial Safety Telemetry System • Authorized Personnel Only
        </div>
      </div>
    </div>
  );
};
