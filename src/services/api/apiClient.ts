/**
 * MineCare - Centralized API Client
 *
 * Communicates with the MineCare versioned backend API (/api/v1/*).
 * Provides resilient fallbacks and structured error handling.
 */

const BASE_URL =
  typeof window !== 'undefined' && import.meta.env?.VITE_API_URL
    ? String(import.meta.env.VITE_API_URL).trim().replace(/\/+$/, '')
    : '';

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
  public requestId?: string;

  constructor(message: string, status: number, details?: unknown, requestId?: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.details = details;
    this.requestId = requestId;
  }
}

type ApiErrorListener = (error: ApiError) => void;
const errorListeners: Set<ApiErrorListener> = new Set();

export function onApiError(listener: ApiErrorListener): () => void {
  errorListeners.add(listener);
  return () => {
    errorListeners.delete(listener);
  };
}

function notifyError(error: ApiError): void {
  errorListeners.forEach((listener) => {
    try {
      listener(error);
    } catch {
      // ignore handler errors
    }
  });
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

    const requestId =
      response.headers.get('x-request-id') ||
      response.headers.get('X-Request-ID') ||
      undefined;

    if (!response.ok) {
      let errorDetails: any = null;
      try {
        errorDetails = await response.json();
      } catch {
        // Ignore json parse error for non-json responses
      }

      const reqId = requestId || (errorDetails?.error?.requestId as string | undefined);
      const errorMessage =
        (typeof errorDetails?.error?.message === 'string' && errorDetails.error.message) ||
        (typeof errorDetails?.message === 'string' && errorDetails.message) ||
        `API request failed: ${response.status} ${response.statusText}`;

      const apiErr = new ApiError(
        errorMessage,
        response.status,
        errorDetails,
        reqId
      );
      notifyError(apiErr);
      throw apiErr;

    }

    return (await response.json()) as T;
  } catch (error) {
    if (error instanceof ApiError) {
      throw error;
    }
    const netErr = new ApiError(
      error instanceof Error ? error.message : 'Network error connecting to backend API',
      0,
      error
    );
    notifyError(netErr);
    throw netErr;
  }
}
