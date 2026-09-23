/**
 * MineCare - Central Authentication Context
 *
 * Manages authentic user session, permissions, token persistence,
 * and seamless session restoration.
 */

import React, { createContext, useContext, useEffect, useState, useCallback } from 'react';
import { authService } from '../services/api';
import type { DbUserProfile, UserRole } from '../backend/types';

interface AuthContextType {
  user: DbUserProfile | null;
  role: UserRole | null;
  token: string | null;
  isLoading: boolean;
  isAuthenticated: boolean;
  login: (email: string, password?: string) => Promise<void>;
  logout: () => Promise<void>;
  error: string | null;
  clearError: () => void;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<DbUserProfile | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  // Restore session on mount
  useEffect(() => {
    let isMounted = true;

    async function restoreSession() {
      try {
        const session = await authService.getSession();
        if (isMounted) {
          if (session && session.user) {
            setUser(session.user);
            setToken(session.token);
          } else {
            setUser(null);
            setToken(null);
          }
        }
      } catch {
        if (isMounted) {
          setUser(null);
          setToken(null);
        }
      }
 finally {
        if (isMounted) {
          setIsLoading(false);
        }
      }
    }

    restoreSession();

    return () => {
      isMounted = false;
    };
  }, []);

  const login = useCallback(async (email: string, password?: string) => {
    setIsLoading(true);
    setError(null);
    try {
      const response = await authService.login(email, password);
      setUser(response.user);
      setToken(response.token);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Invalid credentials or login failed';
      setError(msg);
      throw err;
    } finally {
      setIsLoading(false);
    }
  }, []);

  const logout = useCallback(async () => {
    setIsLoading(true);
    try {
      await authService.logout();
    } finally {
      setUser(null);
      setToken(null);
      setIsLoading(false);
    }
  }, []);

  const clearError = useCallback(() => {
    setError(null);
  }, []);

  const value: AuthContextType = {
    user,
    role: user?.role || null,
    token,
    isLoading,
    isAuthenticated: Boolean(user && user.active),
    login,
    logout,
    error,
    clearError,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};

export const useAuth = (): AuthContextType => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};
