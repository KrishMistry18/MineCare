/**
 * MineCare - Structured Production Logger & Secret Redactor
 *
 * Emits JSON-structured access, operational, and error logs with request IDs,
 * response durations, and user contexts. Automatically redacts database credentials,
 * passwords, JWTs, device tokens, and API keys.
 */

export interface LogEntry {
  timestamp: string;
  level: 'INFO' | 'WARN' | 'ERROR' | 'DEBUG';
  requestId: string;
  method?: string;
  route?: string;
  status?: number;
  durationMs?: number;
  userId?: string;
  role?: string;
  errorCode?: string;
  message?: string;
  meta?: Record<string, unknown>;
}

const REDACTED = '[REDACTED]';

const SENSITIVE_KEY_PATTERNS = [
  /password/i,
  /passwd/i,
  /token/i,
  /authorization/i,
  /secret/i,
  /database_url/i,
  /service_role/i,
  /service_role_key/i,
  /anon_key/i,
  /apikey/i,
  /api_key/i,
  /jwt/i,
  /device_token/i,
  /access_token/i,
  /refresh_token/i,
  /private_key/i,
  /credentials/i,
  /cookie/i,
];

// Regex for string-level secrets
const POSTGRES_URL_REGEX = /(postgres(?:ql)?:\/\/[^:]+:)[^@]+(@)/gi;
const BEARER_TOKEN_REGEX = /Bearer\s+[a-zA-Z0-9._~+/-]+=*/gi;
const JWT_PATTERN_REGEX = /eyJ[a-zA-Z0-9_-]{8,}\.[a-zA-Z0-9_-]{8,}\.[a-zA-Z0-9_-]*/g;
const DEVICE_TOKEN_REGEX = /mc_(?:dev|live)_[a-zA-Z0-9_-]+/g;

export class StructuredLogger {
  private static recentLogs: LogEntry[] = [];
  private static listeners: Set<(entry: LogEntry) => void> = new Set();
  private static silent: boolean = false;

  /**
   * Sanitizes object to remove credentials, tokens, secrets, and URLs with passwords
   */
  public static redact(obj: unknown): unknown {
    if (obj === null || obj === undefined) return obj;

    if (typeof obj === 'string') {
      let result = obj;

      // 1. Redact PostgreSQL connection strings
      if (POSTGRES_URL_REGEX.test(result)) {
        result = result.replace(POSTGRES_URL_REGEX, `$1${REDACTED}$2`);
      }

      // 2. Redact Bearer tokens
      if (BEARER_TOKEN_REGEX.test(result)) {
        result = result.replace(BEARER_TOKEN_REGEX, `Bearer ${REDACTED}`);
      }

      // 3. Redact raw JWT tokens
      if (JWT_PATTERN_REGEX.test(result)) {
        result = result.replace(JWT_PATTERN_REGEX, REDACTED);
      }

      // 4. Redact hardware device credentials
      if (DEVICE_TOKEN_REGEX.test(result)) {
        result = result.replace(DEVICE_TOKEN_REGEX, REDACTED);
      }

      return result;
    }

    if (Array.isArray(obj)) {
      return obj.map((item) => this.redact(item));
    }

    if (typeof obj === 'object') {
      const sanitized: Record<string, unknown> = {};
      for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
        const isSensitive = SENSITIVE_KEY_PATTERNS.some((pat) => pat.test(key));
        if (isSensitive) {
          sanitized[key] = REDACTED;
        } else {
          sanitized[key] = this.redact(value);
        }
      }
      return sanitized;
    }

    return obj;
  }

  public static info(entry: Omit<LogEntry, 'timestamp' | 'level'>): void {
    this.emit('INFO', entry);
  }

  public static warn(entry: Omit<LogEntry, 'timestamp' | 'level'>): void {
    this.emit('WARN', entry);
  }

  public static error(entry: Omit<LogEntry, 'timestamp' | 'level'>): void {
    this.emit('ERROR', entry);
  }

  public static debug(entry: Omit<LogEntry, 'timestamp' | 'level'>): void {
    this.emit('DEBUG', entry);
  }

  private static emit(level: LogEntry['level'], entry: Omit<LogEntry, 'timestamp' | 'level'>): void {
    const fullEntry: LogEntry = {
      timestamp: new Date().toISOString(),
      level,
      requestId: entry.requestId || 'req-unknown',
      method: entry.method,
      route: entry.route,
      status: entry.status,
      durationMs: entry.durationMs,
      userId: entry.userId,
      role: entry.role,
      errorCode: entry.errorCode,
      message: entry.message ? String(this.redact(entry.message)) : undefined,
      ...(entry.meta ? { meta: this.redact(entry.meta) as Record<string, unknown> } : {}),
    };

    // Keep bounded history buffer of recent logs (last 500)
    this.recentLogs.push(fullEntry);
    if (this.recentLogs.length > 500) {
      this.recentLogs.shift();
    }

    // Notify any active test/metric listeners
    this.listeners.forEach((listener) => {
      try {
        listener(fullEntry);
      } catch {
        // ignore listener errors
      }
    });

    if (this.silent) {
      return;
    }

    const serialized = JSON.stringify(fullEntry);
    if (level === 'ERROR') {
      console.error(serialized);
    } else if (level === 'WARN') {
      console.warn(serialized);
    } else {
      console.log(serialized);
    }
  }

  // --- Observability Inspection & Test Isolation APIs ---

  public static getRecentLogs(): LogEntry[] {
    return [...this.recentLogs];
  }

  public static clearLogs(): void {
    this.recentLogs = [];
  }

  public static onLog(listener: (entry: LogEntry) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  public static setSilent(silent: boolean): void {
    this.silent = silent;
  }
}
