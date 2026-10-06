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
    const message = internalErr instanceof Error ? internalErr.message : String(internalErr || 'Internal error');
    return this.create('INTERNAL_SERVER_ERROR', message, requestId);
  }
}
