/**
 * MineCare - Centralized API Client
 *
 * Communicates with the MineCare versioned backend API (/api/v1/*).
 * Provides resilient fallbacks and structured error handling.
 */

const BASE_URL = typeof window !== 'undefined' ? (import.meta.env?.VITE_API_URL || '') : '';

let currentAuthToken: string | null =
  typeof window !== 'undefined' ? localStorage.getItem('minecare_auth_token') : null;

export function setAuthToken(token: string | null): void {
  currentAuthToken = token;
  if (typeof window !== 'undefined') {
    if (token) {
      localStorage.setItem('minecare_auth_token', token);
    } else {
      localStorage.removeItem('minecare_auth_token');
    }
  }
}

export function getAuthToken(): string | null {
  if (!currentAuthToken && typeof window !== 'undefined') {
    currentAuthToken = localStorage.getItem('minecare_auth_token');
  }
  return currentAuthToken;
}

export class ApiError extends Error {
  public status: number;
  public details?: unknown;

  constructor(message: string, status: number, details?: unknown) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.details = details;
  }
}

export async function apiRequest<T>(
  endpoint: string,
  options: RequestInit = {}
): Promise<T> {
  const url = `${BASE_URL}${endpoint}`;
  const token = getAuthToken();

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...((options.headers as Record<string, string>) || {}),
  };

  try {
    const response = await fetch(url, {
      ...options,
      headers,
    });

    if (!response.ok) {
      let errorDetails: unknown = null;
      try {
        errorDetails = await response.json();
      } catch {
        // Ignore json parse error for non-json responses
      }
      throw new ApiError(
        `API request failed: ${response.status} ${response.statusText}`,
        response.status,
        errorDetails
      );
    }

    return (await response.json()) as T;
  } catch (error) {
    if (error instanceof ApiError) {
      throw error;
    }
    throw new ApiError(
      error instanceof Error ? error.message : 'Network error connecting to backend API',
      0,
      error
    );
  }
}
