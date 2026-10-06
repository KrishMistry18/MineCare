/**
 * MineCare - Structured Production Logger & Secret Redactor
 *
 * Emits JSON-structured access and error logs with request IDs, response durations,
 * and user contexts. Automatically redacts database credentials, passwords, and JWTs.
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
  /token/i,
  /authorization/i,
  /secret/i,
  /database_url/i,
  /service_role/i,
  /apikey/i,
  /jwt/i,
];

export class StructuredLogger {
  /**
   * Sanitizes object to remove credentials, tokens, and secrets
   */
  public static redact(obj: unknown): unknown {
    if (obj === null || obj === undefined) return obj;

    if (typeof obj === 'string') {
      // Redact PostgreSQL connection strings
      if (obj.includes('postgres://') || obj.includes('postgresql://')) {
        return obj.replace(/:([^:@]+)@/, `:${REDACTED}@`);
      }
      // Redact Bearer tokens
      if (obj.startsWith('Bearer ')) {
        return `Bearer ${REDACTED}`;
      }
      return obj;
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

  private static emit(level: LogEntry['level'], entry: Omit<LogEntry, 'timestamp' | 'level'>): void {
    const fullEntry: LogEntry = {
      timestamp: new Date().toISOString(),
      level,
      ...entry,
      ...(entry.meta ? { meta: this.redact(entry.meta) as Record<string, unknown> } : {}),
    };

    const serialized = JSON.stringify(fullEntry);
    if (level === 'ERROR') {
      console.error(serialized);
    } else if (level === 'WARN') {
      console.warn(serialized);
    } else {
      console.log(serialized);
    }
  }
}
