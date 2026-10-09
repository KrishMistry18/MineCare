/**
 * MineCare - Standardized Production API Error Envelope
 *
 * Implements safe, uniform error responses without leaking internal stack traces,
 * database connection strings, or filesystem paths.
 *
 * Output format:
 * {
 *   "error": {
 *     "code": "VALIDATION_ERROR",
 *     "message": "...",
 *     "requestId": "..."
 *   },
 *   "code": "VALIDATION_ERROR",
 *   "message": "...",
 *   "requestId": "..."
 * }
 */

export interface ApiErrorBody {
  error: {
    code: string;
    message: string;
    requestId: string;
    details?: unknown;
    timestamp: string;
  };
  code: string;
  message: string;
  requestId: string;
}

export class ApiError {
  public static create(
    code: string,
    message: string,
    requestId: string,
    details?: unknown
  ): ApiErrorBody {
    const timestamp = new Date().toISOString();
    return {
      error: {
        code,
        message,
        requestId,
        ...(details !== undefined ? { details } : {}),
        timestamp,
      },
      code,
      message,
      requestId,
    };
  }

  public static badRequest(requestId: string, message: string, details?: unknown): ApiErrorBody {
    return this.create('VALIDATION_ERROR', message, requestId, details);
  }

  public static unauthorized(requestId: string, message = 'Unauthorized: Authentication required'): ApiErrorBody {
    return this.create('UNAUTHORIZED', message, requestId);
  }

  public static forbidden(requestId: string, message = 'Forbidden: Access denied'): ApiErrorBody {
    return this.create('FORBIDDEN', message, requestId);
  }

  public static notFound(requestId: string, message = 'Resource not found'): ApiErrorBody {
    return this.create('NOT_FOUND', message, requestId);
  }

  public static payloadTooLarge(
    requestId: string,
    message = 'Payload Too Large: Request exceeds maximum permitted size'
  ): ApiErrorBody {
    return this.create('PAYLOAD_TOO_LARGE', message, requestId);
  }

  public static uriTooLong(
    requestId: string,
    message = 'URI Too Long: Requested URL exceeds length limit'
  ): ApiErrorBody {
    return this.create('URI_TOO_LONG', message, requestId);
  }

  public static rateLimited(
    requestId: string,
    retryAfterSeconds: number,
    message = 'Too Many Requests: Rate limit exceeded'
  ): ApiErrorBody {
    return this.create('RATE_LIMITED', message, requestId, { retryAfterSeconds });
  }

  public static conflict(requestId: string, message = 'Conflict: Resource already exists'): ApiErrorBody {
    return this.create('CONFLICT', message, requestId);
  }

  public static methodNotAllowed(
    requestId: string,
    message = 'Method Not Allowed: HTTP method not supported for this endpoint'
  ): ApiErrorBody {
    return this.create('METHOD_NOT_ALLOWED', message, requestId);
  }

  public static unsupportedMediaType(
    requestId: string,
    message = 'Unsupported Media Type: Request payload format not accepted'
  ): ApiErrorBody {
    return this.create('UNSUPPORTED_MEDIA_TYPE', message, requestId);
  }

  public static unprocessableEntity(
    requestId: string,
    message = 'Unprocessable Entity: Semantic validation failed',
    details?: unknown
  ): ApiErrorBody {
    return this.create('UNPROCESSABLE_ENTITY', message, requestId, details);
  }

  public static serviceUnavailable(
    requestId: string,
    message = 'Service Unavailable: Required dependency unavailable'
  ): ApiErrorBody {
    return this.create('SERVICE_UNAVAILABLE', message, requestId);
  }

  public static internal(requestId: string, internalErr?: unknown, isProduction = false): ApiErrorBody {
    if (isProduction) {
      return this.create('INTERNAL_SERVER_ERROR', 'An unexpected internal server error occurred', requestId);
    }
    const rawMessage = internalErr instanceof Error ? internalErr.message : String(internalErr || 'Internal error');
    // Ensure credentials or connection strings are never leaked even in non-production
    const message = rawMessage
      .replace(/postgres(?:ql)?:\/\/[^\s"']+/gi, '[REDACTED_DATABASE_URL]')
      .replace(/Bearer\s+[A-Za-z0-9._~+/-]+=*/gi, 'Bearer [REDACTED]')
      .replace(/eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]*/g, '[REDACTED_JWT]');
    return this.create('INTERNAL_SERVER_ERROR', message, requestId);
  }
}

