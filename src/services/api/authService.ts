/**
 * MineCare - Authentication & Admin API Service
 *
 * Interacts with /api/v1/auth/* and /api/v1/admin/* endpoints.
 */

import { apiRequest, setAuthToken, getAuthToken } from './apiClient';
import type { DbUserProfile, UserRole, DbAuditLog } from '../../backend/types';

export interface LoginResponse {
  success: boolean;
  token: string;
  user: DbUserProfile;
  expiresAt: number;
}

export interface SessionResponse {
  authenticated: boolean;
  user: DbUserProfile;
  token: string;
}

export const authService = {
  /**
   * Log in user with credentials and persist session token
   */
  async login(email: string, password?: string): Promise<LoginResponse> {
    const data = await apiRequest<LoginResponse>('/api/v1/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    });

    if (data.token) {
      setAuthToken(data.token);
    }
    return data;
  },

  /**
   * Log out active session
   */
  async logout(): Promise<void> {
    const token = getAuthToken();
    try {
      if (token) {
        await apiRequest('/api/v1/auth/logout', {
          method: 'POST',
          body: JSON.stringify({ token }),
        });
      }
    } catch {
      // Continue client cleanup even if network fails
    } finally {
      setAuthToken(null);
    }
  },

  /**
   * Validate existing session token against backend
   */
  async getSession(): Promise<SessionResponse | null> {
    const token = getAuthToken();
    if (!token) return null;

    try {
      const data = await apiRequest<SessionResponse>('/api/v1/auth/session');
      return data;
    } catch {
      setAuthToken(null);
      return null;
    }
  },

  /**
   * ADMIN: List all user profiles
   */
  async getUsers(): Promise<DbUserProfile[]> {
    return apiRequest<DbUserProfile[]>('/api/v1/admin/users');
  },

  /**
   * ADMIN: Create new user profile
   */
  async createUser(payload: {
    name: string;
    email: string;
    role: UserRole;
    worker_id?: string;
  }): Promise<{ success: boolean; profile: DbUserProfile }> {
    return apiRequest<{ success: boolean; profile: DbUserProfile }>('/api/v1/admin/users', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  },

  /**
   * ADMIN: Change user role
   */
  async updateUserRole(
    userId: string,
    role: UserRole
  ): Promise<{ success: boolean; profile: DbUserProfile }> {
    return apiRequest<{ success: boolean; profile: DbUserProfile }>(
      `/api/v1/admin/users/${userId}/role`,
      {
        method: 'PUT',
        body: JSON.stringify({ role }),
      }
    );
  },

  /**
   * ADMIN: Retrieve audit logs
   */
  async getAuditLogs(limit: number = 50): Promise<DbAuditLog[]> {
    return apiRequest<DbAuditLog[]>(`/api/v1/admin/audit-logs?limit=${limit}`);
  },
};
