/**
 * MineCare - Strict Runtime Input Validation & Sanitization
 *
 * Validates path parameters, query parameters, entity IDs, and request payloads
 * before reaching service or repository layers. Enforces strict types without
 * relying on compile-time TypeScript assertions.
 */

export interface ValidationResult<T = unknown> {
  isValid: boolean;
  errors: string[];
  sanitized?: T;
}

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ENTITY_ID_REGEX = /^[A-Za-z0-9_\-]{3,64}$/;
const EMAIL_REGEX = /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)+$/;

export class InputValidator {
  /**
   * Validates UUID string format
   */
  public static validateUuid(id: unknown): boolean {
    return typeof id === 'string' && UUID_REGEX.test(id.trim());
  }

  /**
   * Validates Entity ID format (helmetId, workerId, zoneId, alertId)
   */
  public static validateEntityId(id: unknown, fieldName = 'id'): ValidationResult<string> {
    if (typeof id !== 'string' || !id.trim()) {
      return { isValid: false, errors: [`${fieldName} is required and must be a non-empty string`] };
    }
    const clean = id.trim();
    if (clean.length < 3 || clean.length > 64) {
      return { isValid: false, errors: [`${fieldName} length must be between 3 and 64 characters`] };
    }
    if (!ENTITY_ID_REGEX.test(clean)) {
      return { isValid: false, errors: [`${fieldName} contains invalid characters; must be alphanumeric, hyphen, or underscore`] };
    }
    return { isValid: true, errors: [], sanitized: clean };
  }

  /**
   * Validates pagination parameters (limit, offset)
   */
  public static validatePagination(
    rawLimit: unknown,
    rawOffset: unknown,
    defaultLimit = 50,
    maxLimit = 1000
  ): ValidationResult<{ limit: number; offset: number }> {
    const errors: string[] = [];
    let limit = defaultLimit;
    let offset = 0;

    if (rawLimit !== undefined && rawLimit !== null && rawLimit !== '') {
      const parsed = Number(rawLimit);
      if (!Number.isInteger(parsed) || isNaN(parsed) || !isFinite(parsed) || parsed < 1) {
        errors.push('limit must be a positive integer');
      } else if (parsed > maxLimit) {
        errors.push(`limit cannot exceed ${maxLimit}`);
      } else {
        limit = parsed;
      }
    }

    if (rawOffset !== undefined && rawOffset !== null && rawOffset !== '') {
      const parsed = Number(rawOffset);
      if (!Number.isInteger(parsed) || isNaN(parsed) || !isFinite(parsed) || parsed < 0) {
        errors.push('offset must be a non-negative integer');
      } else {
        offset = parsed;
      }
    }

    return {
      isValid: errors.length === 0,
      errors,
      sanitized: { limit, offset },
    };
  }

  /**
   * Validates SQL ORDER BY columns against an explicit allowlist to prevent SQL injection
   */
  public static validateSort(
    rawField: unknown,
    rawDirection: unknown,
    allowedFields: string[],
    defaultField = allowedFields[0] || 'created_at'
  ): ValidationResult<{ field: string; direction: 'ASC' | 'DESC' }> {
    const errors: string[] = [];
    let field = defaultField;
    let direction: 'ASC' | 'DESC' = 'DESC';

    if (typeof rawField === 'string' && rawField.trim()) {
      const cleanField = rawField.trim().toLowerCase();
      if (!allowedFields.includes(cleanField)) {
        errors.push(`Invalid sort field '${cleanField}'. Allowed fields: ${allowedFields.join(', ')}`);
      } else {
        field = cleanField;
      }
    }

    if (typeof rawDirection === 'string' && rawDirection.trim()) {
      const cleanDir = rawDirection.trim().toUpperCase();
      if (cleanDir === 'ASC' || cleanDir === 'DESC') {
        direction = cleanDir;
      } else {
        errors.push("Sort direction must be either 'ASC' or 'DESC'");
      }
    }

    return {
      isValid: errors.length === 0,
      errors,
      sanitized: { field, direction },
    };
  }

  /**
   * Validates Zone Check-In & Reassignment payload
   */
  public static validateZoneAssignmentPayload(payload: unknown): ValidationResult<{ zoneId: string }> {
    if (!payload || typeof payload !== 'object') {
      return { isValid: false, errors: ['Request body must be a JSON object'] };
    }
    const data = payload as { zoneId?: unknown };
    const idCheck = this.validateEntityId(data.zoneId, 'zoneId');
    if (!idCheck.isValid || !idCheck.sanitized) {
      return { isValid: false, errors: idCheck.errors };
    }
    return { isValid: true, errors: [], sanitized: { zoneId: idCheck.sanitized } };
  }

  /**
   * Validates Alert Resolution payload
   */
  public static validateAlertResolvePayload(payload: unknown): ValidationResult<{ notes?: string }> {
    if (!payload || typeof payload !== 'object') {
      return { isValid: true, errors: [], sanitized: {} };
    }
    const data = payload as { notes?: unknown; supervisor_notes?: unknown };
    const rawNotes = data.notes ?? data.supervisor_notes;

    if (rawNotes !== undefined && rawNotes !== null) {
      if (typeof rawNotes !== 'string') {
        return { isValid: false, errors: ['notes must be a string'] };
      }
      const clean = rawNotes.trim();
      if (clean.length > 500) {
        return { isValid: false, errors: ['notes cannot exceed 500 characters'] };
      }
      return { isValid: true, errors: [], sanitized: { notes: clean } };
    }

    return { isValid: true, errors: [], sanitized: {} };
  }

  /**
   * Validates Admin User Creation payload
   */
  public static validateAdminUserCreate(payload: unknown): ValidationResult<{
    name: string;
    email: string;
    role: 'ADMIN' | 'SUPERVISOR' | 'WORKER';
    worker_id?: string | null;
  }> {
    const errors: string[] = [];
    if (!payload || typeof payload !== 'object') {
      return { isValid: false, errors: ['Request body must be a JSON object'] };
    }

    const data = payload as { name?: unknown; email?: unknown; role?: unknown; worker_id?: unknown };

    // Name
    if (typeof data.name !== 'string' || !data.name.trim()) {
      errors.push('name is required and must be a non-empty string');
    } else if (data.name.trim().length > 100) {
      errors.push('name cannot exceed 100 characters');
    }

    // Email
    if (typeof data.email !== 'string' || !data.email.trim()) {
      errors.push('email is required and must be a valid email address');
    } else {
      const cleanEmail = data.email.trim().toLowerCase();
      if (cleanEmail.length > 255 || !EMAIL_REGEX.test(cleanEmail)) {
        errors.push('email must be a valid email format under 255 characters');
      }
    }

    // Role
    const roleStr = typeof data.role === 'string' ? data.role.trim().toUpperCase() : '';
    if (!['ADMIN', 'SUPERVISOR', 'WORKER'].includes(roleStr)) {
      errors.push("role is required and must be 'ADMIN', 'SUPERVISOR', or 'WORKER'");
    }

    // Worker ID if role is WORKER
    let worker_id: string | null = null;
    if (roleStr === 'WORKER') {
      if (data.worker_id) {
        const widCheck = this.validateEntityId(data.worker_id, 'worker_id');
        if (!widCheck.isValid) {
          errors.push(...widCheck.errors);
        } else {
          worker_id = widCheck.sanitized || null;
        }
      }
    }

    if (errors.length > 0) {
      return { isValid: false, errors };
    }

    return {
      isValid: true,
      errors: [],
      sanitized: {
        name: (data.name as string).trim(),
        email: (data.email as string).trim().toLowerCase(),
        role: roleStr as 'ADMIN' | 'SUPERVISOR' | 'WORKER',
        worker_id,
      },
    };
  }

  /**
   * Sanitizes string inputs to prevent script injection
   */
  public static sanitizeString(input: string): string {
    return input.replace(/[<>]/g, '');
  }
}
