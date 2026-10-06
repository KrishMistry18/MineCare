/**
 * MineCare - Authoritative Backend Environment Configuration
 *
 * Enforces strict runtime validation of production database and authentication secrets.
 * Loads .env and .env.local automatically across all CLI commands and runtime modules.
 * Fails fast if required PostgreSQL or Supabase credentials are missing.
 */

import fs from 'fs';
import path from 'path';

export interface BackendConfig {
  nodeEnv: 'development' | 'production' | 'test';
  isProduction: boolean;
  isTest: boolean;
  port: number;
  host: string;
  corsOrigin?: string;

  // Database Connection
  databaseUrl?: string;
  supabaseUrl?: string;
  supabaseServiceRoleKey?: string;
  supabaseAnonKey?: string;

  // Supabase Auth / JWT Verification
  supabaseJwtIssuer?: string;
  supabaseJwksUrl?: string;
  supabaseJwtSecret?: string;
}

export interface SafeDatabaseMetadata {
  configured: boolean;
  host?: string;
  port?: string;
  database?: string;
  isSupabase: boolean;
  isLocalhost: boolean;
  connectionMode: 'direct' | 'pooler' | 'local' | 'unknown';
}

export interface SafeConfigDiagnostics {
  envFilePresent: boolean;
  nodeEnv: string;
  database: SafeDatabaseMetadata;
  supabaseUrlConfigured: boolean;
  serviceRoleKeyConfigured: boolean;
  anonKeyConfigured: boolean;
  jwtSecretConfigured: boolean;
}

let cachedConfig: BackendConfig | null = null;
let envLoaded = false;

/**
 * Parses and loads .env and .env.local files into process.env.
 * Does not overwrite non-empty process.env variables unless specified.
 */
export function loadEnvFiles(forceReload = false): void {
  if (envLoaded && !forceReload) {
    return;
  }

  const baseDir = process.cwd();
  const envFiles = ['.env', '.env.local'];

  for (const filename of envFiles) {
    const fullPath = path.resolve(baseDir, filename);
    if (!fs.existsSync(fullPath)) {
      continue;
    }

    try {
      const content = fs.readFileSync(fullPath, 'utf-8');
      const lines = content.split('\n');

      for (const rawLine of lines) {
        const line = rawLine.trim();
        // Ignore blank lines and comment lines
        if (!line || line.startsWith('#')) {
          continue;
        }

        const equalIndex = line.indexOf('=');
        if (equalIndex <= 0) {
          continue;
        }

        const key = line.slice(0, equalIndex).trim();
        let value = line.slice(equalIndex + 1).trim();

        // Strip matching surrounding quotes ('...' or "...")
        if (
          (value.startsWith('"') && value.endsWith('"')) ||
          (value.startsWith("'") && value.endsWith("'"))
        ) {
          value = value.slice(1, -1);
        }

        // Set into process.env if currently unset, empty, or if this .env defines a non-empty value
        if (value.length > 0) {
          // If current process.env[key] is empty, undefined, or file: placeholder, overwrite with .env value
          const currentVal = process.env[key]?.trim();
          if (!currentVal || currentVal.startsWith('file:') || forceReload) {
            process.env[key] = value;
          }
        }
      }
    } catch {
      // ignore read errors
    }
  }

  envLoaded = true;
}

export function getBackendConfig(forceReload = false): BackendConfig {
  if (cachedConfig && !forceReload) {
    return cachedConfig;
  }

  // Ensure .env is read into process.env
  loadEnvFiles(forceReload);

  const rawEnv = typeof process !== 'undefined' ? process.env : {};

  const nodeEnv = (rawEnv.NODE_ENV || 'development').toLowerCase() as 'development' | 'production' | 'test';
  const isProduction = nodeEnv === 'production';
  const isTest = nodeEnv === 'test';

  const port = Number(rawEnv.PORT || 3001);
  const host = rawEnv.HOST || '0.0.0.0';
  const corsOrigin = rawEnv.CORS_ORIGIN?.trim() || undefined;

  const rawDatabaseUrl = rawEnv.DATABASE_URL?.trim() || undefined;
  const databaseUrl =
    rawDatabaseUrl && (rawDatabaseUrl.startsWith('postgres://') || rawDatabaseUrl.startsWith('postgresql://'))
      ? rawDatabaseUrl
      : undefined;

  // Supabase URL: support both SUPABASE_URL and VITE_SUPABASE_URL
  const supabaseUrl = rawEnv.SUPABASE_URL?.trim() || rawEnv.VITE_SUPABASE_URL?.trim() || undefined;
  const supabaseServiceRoleKey = rawEnv.SUPABASE_SERVICE_ROLE_KEY?.trim() || undefined;
  const supabaseAnonKey = rawEnv.SUPABASE_ANON_KEY?.trim() || rawEnv.VITE_SUPABASE_ANON_KEY?.trim() || undefined;

  // JWT / Auth config
  const supabaseJwtSecret = rawEnv.SUPABASE_JWT_SECRET?.trim() || undefined;
  const supabaseJwtIssuer =
    rawEnv.SUPABASE_JWT_ISSUER?.trim() ||
    (supabaseUrl ? `${supabaseUrl.replace(/\/+$/, '')}/auth/v1` : undefined);
  const supabaseJwksUrl =
    rawEnv.SUPABASE_JWKS_URL?.trim() ||
    (supabaseUrl ? `${supabaseUrl.replace(/\/+$/, '')}/auth/v1/.well-known/jwks.json` : undefined);

  // Security Audit: Check for accidental exposure of backend secrets to VITE_
  const dangerousViteKeys = ['VITE_SUPABASE_SERVICE_ROLE_KEY', 'VITE_DATABASE_URL', 'VITE_SUPABASE_JWT_SECRET'];
  for (const dangerousKey of dangerousViteKeys) {
    if (rawEnv[dangerousKey]) {
      throw new Error(
        `[MineCare Security Violation] Critical backend secret '${dangerousKey}' detected with 'VITE_' prefix. ` +
        `This would leak server-side credentials to the browser client. Remove the 'VITE_' prefix immediately.`
      );
    }
  }

  // Production Enforcement: Fail fast if database credentials are missing
  if (isProduction) {
    const hasDatabaseUrl = Boolean(databaseUrl);
    const hasSupabasePair = Boolean(supabaseUrl && supabaseServiceRoleKey);

    if (!hasDatabaseUrl && !hasSupabasePair) {
      throw new Error(
        `[MineCare Configuration Failure] Production environment requires authoritative PostgreSQL credentials. ` +
        `Provide either 'DATABASE_URL' (PostgreSQL connection URI) or 'SUPABASE_URL' + 'SUPABASE_SERVICE_ROLE_KEY'. ` +
        `Silent fallback to in-memory storage is strictly prohibited in production mode.`
      );
    }
  }

  cachedConfig = {
    nodeEnv,
    isProduction,
    isTest,
    port,
    host,
    corsOrigin,
    databaseUrl,
    supabaseUrl,
    supabaseServiceRoleKey,
    supabaseAnonKey,
    supabaseJwtIssuer,
    supabaseJwksUrl,
    supabaseJwtSecret,
  };

  return cachedConfig;
}

export function resetBackendConfig(): void {
  cachedConfig = null;
  envLoaded = false;
}

/**
 * Extracts safe, non-sensitive database metadata for logging and diagnostics.
 * NEVER outputs credentials, passwords, or complete connection strings.
 */
export function getSafeDatabaseMetadata(databaseUrl?: string): SafeDatabaseMetadata {
  if (!databaseUrl) {
    return {
      configured: false,
      isSupabase: false,
      isLocalhost: false,
      connectionMode: 'unknown',
    };
  }

  try {
    const parsed = new URL(databaseUrl);
    const host = parsed.hostname;
    const port = parsed.port || '5432';
    const database = parsed.pathname.replace(/^\//, '') || 'postgres';
    const isSupabase = host.includes('supabase.co') || host.includes('supabase.com');
    const isLocalhost = host === 'localhost' || host === '127.0.0.1';

    let connectionMode: 'direct' | 'pooler' | 'local' | 'unknown' = 'unknown';
    if (isLocalhost) {
      connectionMode = 'local';
    } else if (port === '6543' || parsed.searchParams.get('pgbouncer') === 'true' || host.includes('pooler')) {
      connectionMode = 'pooler';
    } else if (port === '5432' || host.startsWith('db.')) {
      connectionMode = 'direct';
    }

    return {
      configured: true,
      host,
      port,
      database,
      isSupabase,
      isLocalhost,
      connectionMode,
    };
  } catch {
    return {
      configured: true,
      host: 'configured (parse-error)',
      isSupabase: false,
      isLocalhost: false,
      connectionMode: 'unknown',
    };
  }
}

/**
 * Returns safe environment diagnostics without leaking secrets.
 */
export function getSafeEnvDiagnostics(): SafeConfigDiagnostics {
  const config = getBackendConfig();
  const envPath = path.resolve(process.cwd(), '.env');

  return {
    envFilePresent: fs.existsSync(envPath),
    nodeEnv: config.nodeEnv,
    database: getSafeDatabaseMetadata(config.databaseUrl),
    supabaseUrlConfigured: Boolean(config.supabaseUrl),
    serviceRoleKeyConfigured: Boolean(config.supabaseServiceRoleKey),
    anonKeyConfigured: Boolean(config.supabaseAnonKey),
    jwtSecretConfigured: Boolean(config.supabaseJwtSecret),
  };
}
