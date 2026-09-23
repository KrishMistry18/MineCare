/**
 * MineCare - Industrial Control-Room Administration Console (/admin)
 *
 * Dedicated administrative management:
 * - User & Role Management (Admin, Supervisor, Worker role switching)
 * - Worker Personnel Records & Helmet Linkages
 * - Helmet Fleet Provisioning
 * - Mine Zone Configuration
 * - System Audit Log Trail
 */

import React, { useState, useEffect, useCallback } from 'react';
import { authService, workerService, helmetService, zoneService, type WorkerWithZone } from '../../services/api';
import type { DbUserProfile, UserRole, DbAuditLog, DbHelmet } from '../../backend/types';
import type { ZoneOccupancySummary } from '../../types/zone';
import { 
  ShieldAlert, 
  Users, 
  HardHat, 
  MapPin, 
  History, 
  Plus, 
  CheckCircle2, 
  AlertCircle, 
  Loader2, 
  UserCheck, 
  Search,
  RefreshCw
} from 'lucide-react';

interface HelmetWithWorker extends DbHelmet {
  worker_name?: string | null;
}

export const AdminConsolePage: React.FC = () => {
  const [activeTab, setActiveTab] = useState<'USERS' | 'WORKERS' | 'HELMETS' | 'ZONES' | 'AUDIT'>('USERS');

  // State collections
  const [users, setUsers] = useState<DbUserProfile[]>([]);
  const [workers, setWorkers] = useState<WorkerWithZone[]>([]);
  const [helmets, setHelmets] = useState<HelmetWithWorker[]>([]);
  const [zones, setZones] = useState<ZoneOccupancySummary[]>([]);
  const [auditLogs, setAuditLogs] = useState<DbAuditLog[]>([]);

  const [loading, setLoading] = useState(true);
  const [actionMessage, setActionMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  // New User Form Modal State
  const [showAddUserModal, setShowAddUserModal] = useState(false);
  const [newUserName, setNewUserName] = useState('');
  const [newUserEmail, setNewUserEmail] = useState('');
  const [newUserRole, setNewUserRole] = useState<UserRole>('SUPERVISOR');
  const [newUserWorkerId, setNewUserWorkerId] = useState('');
  const [submittingUser, setSubmittingUser] = useState(false);

  // Filter / Search
  const [searchQuery, setSearchQuery] = useState('');

  const loadAllData = useCallback(async () => {
    try {
      setLoading(true);
      const [u, w, h, z, a] = await Promise.all([
        authService.getUsers().catch(() => []),
        workerService.getWorkers().catch(() => []),
        helmetService.getHelmets().catch(() => []) as Promise<HelmetWithWorker[]>,
        zoneService.getZones().catch(() => []),
        authService.getAuditLogs(100).catch(() => []),
      ]);
      setUsers(u);
      setWorkers(w);
      setHelmets(h);
      setZones(z);
      setAuditLogs(a);
    } catch (err) {
      console.error('Failed to load admin console data:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadAllData();
  }, [loadAllData]);

  const handleRoleChange = async (userId: string, newRole: UserRole) => {
    try {
      setActionMessage(null);
      await authService.updateUserRole(userId, newRole);
      setActionMessage({ type: 'success', text: `User role successfully updated to ${newRole}` });
      await loadAllData();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to update role';
      setActionMessage({ type: 'error', text: msg });
    }
  };

  const handleCreateUser = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newUserName.trim() || !newUserEmail.trim()) return;

    try {
      setSubmittingUser(true);
      setActionMessage(null);
      await authService.createUser({
        name: newUserName.trim(),
        email: newUserEmail.trim(),
        role: newUserRole,
        worker_id: newUserRole === 'WORKER' && newUserWorkerId ? newUserWorkerId : undefined,
      });

      setActionMessage({ type: 'success', text: `User account ${newUserEmail} created successfully` });
      setShowAddUserModal(false);
      setNewUserName('');
      setNewUserEmail('');
      setNewUserRole('SUPERVISOR');
      setNewUserWorkerId('');
      await loadAllData();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to create user account';
      setActionMessage({ type: 'error', text: msg });
    } finally {
      setSubmittingUser(false);
    }
  };

  const filteredUsers = users.filter(
    (u) =>
      u.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      u.email.toLowerCase().includes(searchQuery.toLowerCase()) ||
      u.role.toLowerCase().includes(searchQuery.toLowerCase())
  );

  return (
    <div className="space-y-6 max-w-7xl mx-auto">
      {/* Header Banner */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 p-5 rounded-xl bg-[#0b121d] border border-[#162133] shadow-lg">
        <div className="flex items-center space-x-3">
          <div className="w-10 h-10 rounded-xl bg-purple-950/80 border border-purple-500/40 flex items-center justify-center text-purple-400 shrink-0">
            <ShieldAlert className="w-5 h-5" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-lg font-bold text-white tracking-tight">System Administration Console</h1>
              <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-purple-950/80 border border-purple-600/40 text-purple-300 font-semibold">
                ADMIN ACCESS ONLY
              </span>
            </div>
            <p className="text-xs text-slate-400">
              Manage operators, roles, worker records, helmet provisioning, and inspect security audit trail.
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={() => loadAllData()}
            disabled={loading}
            className="p-2 rounded-lg bg-[#070c14] hover:bg-[#121c2d] border border-[#1a2538] text-slate-400 hover:text-slate-200 text-xs flex items-center gap-1.5 transition-colors cursor-pointer"
            title="Refresh Data"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin text-purple-400' : ''}`} />
            <span>Refresh</span>
          </button>
          <button
            onClick={() => setShowAddUserModal(true)}
            className="px-3 py-2 rounded-lg bg-purple-600 hover:bg-purple-500 text-white font-medium text-xs flex items-center gap-1.5 transition-colors shadow-lg shadow-purple-950/50 cursor-pointer"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>New Operator</span>
          </button>
        </div>
      </div>

      {/* Action Notification */}
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
              <AlertCircle className="w-4 h-4 text-rose-400" />
            )}
            <span>{actionMessage.text}</span>
          </div>
          <button
            onClick={() => setActionMessage(null)}
            className="text-slate-400 hover:text-white text-xs px-2"
          >
            Dismiss
          </button>
        </div>
      )}

      {/* Navigation Tabs */}
      <div className="flex items-center space-x-1 border-b border-[#162133] pb-1 overflow-x-auto">
        <button
          onClick={() => setActiveTab('USERS')}
          className={`px-4 py-2 rounded-lg text-xs font-semibold flex items-center gap-2 transition-all cursor-pointer ${
            activeTab === 'USERS'
              ? 'bg-purple-950/70 border border-purple-500/50 text-white shadow-sm'
              : 'text-slate-400 hover:text-slate-200 hover:bg-[#0c1420]'
          }`}
        >
          <Users className="w-3.5 h-3.5" />
          <span>User Accounts ({users.length})</span>
        </button>

        <button
          onClick={() => setActiveTab('WORKERS')}
          className={`px-4 py-2 rounded-lg text-xs font-semibold flex items-center gap-2 transition-all cursor-pointer ${
            activeTab === 'WORKERS'
              ? 'bg-purple-950/70 border border-purple-500/50 text-white shadow-sm'
              : 'text-slate-400 hover:text-slate-200 hover:bg-[#0c1420]'
          }`}
        >
          <UserCheck className="w-3.5 h-3.5" />
          <span>Worker Records ({workers.length})</span>
        </button>

        <button
          onClick={() => setActiveTab('HELMETS')}
          className={`px-4 py-2 rounded-lg text-xs font-semibold flex items-center gap-2 transition-all cursor-pointer ${
            activeTab === 'HELMETS'
              ? 'bg-purple-950/70 border border-purple-500/50 text-white shadow-sm'
              : 'text-slate-400 hover:text-slate-200 hover:bg-[#0c1420]'
          }`}
        >
          <HardHat className="w-3.5 h-3.5" />
          <span>Helmet Fleet ({helmets.length})</span>
        </button>

        <button
          onClick={() => setActiveTab('ZONES')}
          className={`px-4 py-2 rounded-lg text-xs font-semibold flex items-center gap-2 transition-all cursor-pointer ${
            activeTab === 'ZONES'
              ? 'bg-purple-950/70 border border-purple-500/50 text-white shadow-sm'
              : 'text-slate-400 hover:text-slate-200 hover:bg-[#0c1420]'
          }`}
        >
          <MapPin className="w-3.5 h-3.5" />
          <span>Mine Zones ({zones.length})</span>
        </button>

        <button
          onClick={() => setActiveTab('AUDIT')}
          className={`px-4 py-2 rounded-lg text-xs font-semibold flex items-center gap-2 transition-all cursor-pointer ${
            activeTab === 'AUDIT'
              ? 'bg-purple-950/70 border border-purple-500/50 text-white shadow-sm'
              : 'text-slate-400 hover:text-slate-200 hover:bg-[#0c1420]'
          }`}
        >
          <History className="w-3.5 h-3.5" />
          <span>Audit Trail ({auditLogs.length})</span>
        </button>
      </div>

      {/* Tab 1: User Management */}
      {activeTab === 'USERS' && (
        <div className="space-y-4">
          <div className="flex items-center justify-between gap-4">
            <div className="relative flex-1 max-w-sm">
              <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search operators by name, email, or role..."
                className="w-full pl-8 pr-3 py-1.5 bg-[#060a12] border border-[#1a2538] rounded-lg text-xs text-slate-100 placeholder-slate-500 focus:outline-none focus:border-purple-500"
              />
            </div>
            <span className="text-xs text-slate-400 font-mono">
              Showing {filteredUsers.length} of {users.length} accounts
            </span>
          </div>

          <div className="bg-[#0b121d] border border-[#162133] rounded-xl overflow-hidden shadow-lg">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="bg-[#070c14] border-b border-[#162133] text-slate-400 font-mono uppercase text-[10px]">
                    <th className="py-3 px-4">Profile ID</th>
                    <th className="py-3 px-4">Operator Name</th>
                    <th className="py-3 px-4">Email</th>
                    <th className="py-3 px-4">Linked Worker ID</th>
                    <th className="py-3 px-4">Current Role</th>
                    <th className="py-3 px-4">Change Role</th>
                    <th className="py-3 px-4">Created At</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#141e2e]">
                  {filteredUsers.map((u) => (
                    <tr key={u.id} className="hover:bg-[#0d1624] transition-colors">
                      <td className="py-3 px-4 font-mono text-purple-400">{u.id}</td>
                      <td className="py-3 px-4 font-semibold text-white">{u.name}</td>
                      <td className="py-3 px-4 text-slate-300 font-mono text-[11px]">{u.email}</td>
                      <td className="py-3 px-4 font-mono text-slate-400">
                        {u.worker_id || <span className="text-slate-600">—</span>}
                      </td>
                      <td className="py-3 px-4">
                        <span
                          className={`font-mono text-[10px] font-bold px-2 py-0.5 rounded border ${
                            u.role === 'ADMIN'
                              ? 'bg-purple-950/80 text-purple-300 border-purple-600/50'
                              : u.role === 'SUPERVISOR'
                              ? 'bg-cyan-950/80 text-cyan-300 border-cyan-600/50'
                              : 'bg-emerald-950/80 text-emerald-300 border-emerald-600/50'
                          }`}
                        >
                          {u.role}
                        </span>
                      </td>
                      <td className="py-3 px-4">
                        <select
                          value={u.role}
                          onChange={(e) => handleRoleChange(u.id, e.target.value as UserRole)}
                          className="bg-[#060a12] border border-[#1a2538] rounded px-2 py-1 text-[11px] text-slate-200 focus:outline-none focus:border-purple-500 font-mono cursor-pointer"
                        >
                          <option value="ADMIN">ADMIN</option>
                          <option value="SUPERVISOR">SUPERVISOR</option>
                          <option value="WORKER">WORKER</option>
                        </select>
                      </td>
                      <td className="py-3 px-4 text-slate-500 font-mono text-[11px]">
                        {new Date(u.created_at).toLocaleDateString()}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* Tab 2: Worker Records */}
      {activeTab === 'WORKERS' && (
        <div className="bg-[#0b121d] border border-[#162133] rounded-xl overflow-hidden shadow-lg">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="bg-[#070c14] border-b border-[#162133] text-slate-400 font-mono uppercase text-[10px]">
                  <th className="py-3 px-4">Worker Code</th>
                  <th className="py-3 px-4">Full Name</th>
                  <th className="py-3 px-4">Shift</th>
                  <th className="py-3 px-4">Assigned Home Zone</th>
                  <th className="py-3 px-4">Active Work Zone</th>
                  <th className="py-3 px-4">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#141e2e]">
                {workers.map((w) => (
                  <tr key={w.id} className="hover:bg-[#0d1624] transition-colors">
                    <td className="py-3 px-4 font-mono text-cyan-400 font-semibold">{w.worker_code}</td>
                    <td className="py-3 px-4 font-semibold text-white">{w.name}</td>
                    <td className="py-3 px-4 text-slate-300">{w.shift}</td>
                    <td className="py-3 px-4 text-slate-300">{w.assigned_zone_name || 'Portal / Surface'}</td>
                    <td className="py-3 px-4">
                      {w.current_work_zone_name ? (
                        <span className="text-cyan-400 font-mono text-[11px] font-medium">
                          {w.current_work_zone_name}
                        </span>
                      ) : (
                        <span className="text-slate-500 italic">Surface / Off-Duty</span>
                      )}
                    </td>
                    <td className="py-3 px-4">
                      <span className="text-emerald-400 text-[10px] font-mono font-bold px-1.5 py-0.5 rounded bg-emerald-950/60 border border-emerald-600/30">
                        ACTIVE
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Tab 3: Helmets Fleet */}
      {activeTab === 'HELMETS' && (
        <div className="bg-[#0b121d] border border-[#162133] rounded-xl overflow-hidden shadow-lg">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="bg-[#070c14] border-b border-[#162133] text-slate-400 font-mono uppercase text-[10px]">
                  <th className="py-3 px-4">Helmet Code</th>
                  <th className="py-3 px-4">Serial Number</th>
                  <th className="py-3 px-4">Assigned Worker</th>
                  <th className="py-3 px-4">Safety Status</th>
                  <th className="py-3 px-4">Connectivity</th>
                  <th className="py-3 px-4">Battery</th>
                  <th className="py-3 px-4">Firmware</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#141e2e]">
                {helmets.map((h) => (
                  <tr key={h.id} className="hover:bg-[#0d1624] transition-colors">
                    <td className="py-3 px-4 font-mono text-amber-400 font-bold">{h.helmet_code}</td>
                    <td className="py-3 px-4 font-mono text-slate-400">{h.serial_number}</td>
                    <td className="py-3 px-4 text-slate-200 font-medium">{h.worker_name || 'Unassigned'}</td>
                    <td className="py-3 px-4">
                      <span
                        className={`text-[10px] font-mono font-bold px-1.5 py-0.5 rounded border ${
                          h.status === 'DANGER'
                            ? 'bg-rose-950/80 text-rose-300 border-rose-500'
                            : h.status === 'WARNING'
                            ? 'bg-amber-950/80 text-amber-300 border-amber-500'
                            : 'bg-emerald-950/80 text-emerald-300 border-emerald-500'
                        }`}
                      >
                        {h.status}
                      </span>
                    </td>
                    <td className="py-3 px-4">
                      <span className="flex items-center gap-1.5 text-[11px] font-mono text-emerald-400">
                        <span className="w-2 h-2 rounded-full bg-emerald-400" />
                        Online
                      </span>
                    </td>
                    <td className="py-3 px-4 font-mono text-slate-300">{h.battery_level}%</td>
                    <td className="py-3 px-4 font-mono text-slate-500 text-[11px]">{h.firmware_version}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Tab 4: Mine Zones */}
      {activeTab === 'ZONES' && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {zones.map((zone) => (
            <div key={zone.zoneId} className="p-5 rounded-xl bg-[#0b121d] border border-[#162133] space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="font-bold text-white text-sm flex items-center gap-2">
                  <MapPin className="w-4 h-4 text-cyan-400" />
                  {zone.zoneName}
                </h3>
                <span className="text-[10px] font-mono font-bold px-2 py-0.5 rounded border bg-cyan-950/80 text-cyan-300 border-cyan-600/50">
                  {zone.level}
                </span>
              </div>

              <p className="text-xs text-slate-400">{zone.description}</p>

              <div className="grid grid-cols-2 gap-2 text-xs font-mono pt-2 border-t border-[#141e2e]">
                <div>
                  <span className="text-slate-500 text-[10px] block">DEPTH</span>
                  <span className="text-slate-200 font-bold">{zone.depthMeters}m Below Surface</span>
                </div>
                <div>
                  <span className="text-slate-500 text-[10px] block">CURRENT OCCUPANCY</span>
                  <span className="text-cyan-400 font-bold">{zone.workerCount} Active Personnel</span>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Tab 5: Security Audit Trail */}
      {activeTab === 'AUDIT' && (
        <div className="bg-[#0b121d] border border-[#162133] rounded-xl overflow-hidden shadow-lg">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="bg-[#070c14] border-b border-[#162133] text-slate-400 font-mono uppercase text-[10px]">
                  <th className="py-3 px-4">Timestamp</th>
                  <th className="py-3 px-4">Action</th>
                  <th className="py-3 px-4">Actor Email</th>
                  <th className="py-3 px-4">Actor Role</th>
                  <th className="py-3 px-4">Target Entity</th>
                  <th className="py-3 px-4">Details</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#141e2e]">
                {auditLogs.map((log) => (
                  <tr key={log.id} className="hover:bg-[#0d1624] transition-colors">
                    <td className="py-3 px-4 font-mono text-slate-400 text-[11px] whitespace-nowrap">
                      {new Date(log.created_at).toLocaleString()}
                    </td>
                    <td className="py-3 px-4">
                      <span className="font-mono text-[10px] font-bold px-1.5 py-0.5 rounded bg-purple-950/70 text-purple-300 border border-purple-600/40">
                        {log.action}
                      </span>
                    </td>
                    <td className="py-3 px-4 font-mono text-slate-300 text-[11px]">{log.user_email}</td>
                    <td className="py-3 px-4">
                      <span className="font-mono text-[10px] text-slate-300 font-semibold">{log.role}</span>
                    </td>
                    <td className="py-3 px-4 font-mono text-slate-400 text-[11px]">
                      {log.target_type} ({log.target_id})
                    </td>
                    <td className="py-3 px-4 text-slate-400 font-mono text-[10px] max-w-xs truncate">
                      {log.details ? JSON.stringify(log.details) : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Add User Modal */}
      {showAddUserModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-fadeIn">
          <div className="bg-[#0b121d] border border-[#1a2538] rounded-xl max-w-md w-full p-6 shadow-2xl space-y-4">
            <div className="flex items-center justify-between border-b border-[#162133] pb-3">
              <h3 className="font-bold text-white text-sm flex items-center gap-2">
                <Users className="w-4 h-4 text-purple-400" />
                Provision Operator Account
              </h3>
              <button
                onClick={() => setShowAddUserModal(false)}
                className="text-slate-400 hover:text-white text-xs"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleCreateUser} className="space-y-3.5">
              <div>
                <label className="block text-xs font-mono text-slate-300 mb-1">FULL NAME</label>
                <input
                  type="text"
                  value={newUserName}
                  onChange={(e) => setNewUserName(e.target.value)}
                  placeholder="e.g. John Doe"
                  required
                  className="w-full px-3 py-2 bg-[#060a12] border border-[#1a2538] rounded-lg text-xs text-white focus:outline-none focus:border-purple-500"
                />
              </div>

              <div>
                <label className="block text-xs font-mono text-slate-300 mb-1">EMAIL ADDRESS</label>
                <input
                  type="email"
                  value={newUserEmail}
                  onChange={(e) => setNewUserEmail(e.target.value)}
                  placeholder="e.g. john.doe@minecare.local"
                  required
                  className="w-full px-3 py-2 bg-[#060a12] border border-[#1a2538] rounded-lg text-xs text-white focus:outline-none focus:border-purple-500"
                />
              </div>

              <div>
                <label className="block text-xs font-mono text-slate-300 mb-1">SYSTEM ROLE</label>
                <select
                  value={newUserRole}
                  onChange={(e) => setNewUserRole(e.target.value as UserRole)}
                  className="w-full px-3 py-2 bg-[#060a12] border border-[#1a2538] rounded-lg text-xs text-white focus:outline-none focus:border-purple-500"
                >
                  <option value="SUPERVISOR">SUPERVISOR (Control Room Operator)</option>
                  <option value="WORKER">WORKER (Mine Personnel)</option>
                  <option value="ADMIN">ADMIN (Full System Administrator)</option>
                </select>
              </div>

              {newUserRole === 'WORKER' && (
                <div>
                  <label className="block text-xs font-mono text-slate-300 mb-1">LINKED WORKER ID</label>
                  <select
                    value={newUserWorkerId}
                    onChange={(e) => setNewUserWorkerId(e.target.value)}
                    className="w-full px-3 py-2 bg-[#060a12] border border-[#1a2538] rounded-lg text-xs text-white focus:outline-none focus:border-purple-500"
                  >
                    <option value="">Select Worker Record...</option>
                    {workers.map((w) => (
                      <option key={w.id} value={w.id}>
                        {w.worker_code} — {w.name} ({w.shift})
                      </option>
                    ))}
                  </select>
                </div>
              )}

              <div className="flex items-center justify-end gap-2 pt-3 border-t border-[#162133]">
                <button
                  type="button"
                  onClick={() => setShowAddUserModal(false)}
                  className="px-3 py-2 rounded-lg bg-[#070c14] border border-[#1a2538] text-slate-400 hover:text-white text-xs cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submittingUser}
                  className="px-4 py-2 rounded-lg bg-purple-600 hover:bg-purple-500 text-white font-medium text-xs flex items-center gap-1.5 transition-colors cursor-pointer"
                >
                  {submittingUser ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Plus className="w-3.5 h-3.5" />}
                  <span>Create Account</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
