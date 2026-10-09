/**
 * MineCare - Production Backend Server Entry
 *
 * Runs the MineCare REST API as an independent process on PORT (default 3001).
 * Initializes connection pooling, verifies PostgreSQL health, applies migrations,
 * and handles graceful shutdown.
 */

import { createServer } from 'http';
import { BackendApp } from '../src/backend/app';
import { PostgresDatabaseRepository } from '../src/backend/db/repositories/PostgresDatabaseRepository';
import { migrator } from '../src/backend/db/migrator';
import { connectionManager } from '../src/backend/db/connection';
import { getBackendConfig } from '../src/backend/config/env';
import { RealtimePublisher } from '../src/backend/realtime/RealtimePublisher';
import { StructuredLogger } from '../src/backend/security/StructuredLogger';
import { RequestIdManager } from '../src/backend/security/RequestId';
import { ApiError } from '../src/backend/security/ApiError';

const config = getBackendConfig();
const port = Number(process.env.PORT || config.port || 3001);
const host = process.env.HOST || config.host || '0.0.0.0';

async function bootstrap() {
  console.log('============================================================');
  console.log(`[MineCare Backend] Initializing in ${config.nodeEnv.toUpperCase()} mode...`);
  console.log('============================================================');

  // 1. Verify PostgreSQL Database connectivity
  const dbHealthy = await connectionManager.testConnection();
  if (!dbHealthy) {
    if (config.isProduction) {
      console.error(
        '[MineCare Backend] FATAL: Production PostgreSQL connection failed. ' +
        'Check DATABASE_URL or SUPABASE_URL credentials. Halting startup.'
      );
      process.exit(1);
    } else {
      console.warn(
        '[MineCare Backend] PostgreSQL unavailable at DATABASE_URL. ' +
        'Initialized in-process PostgreSQL instance for development.'
      );
    }
  }

  // 2. Apply canonical migrations
  console.log('[MineCare Backend] Verifying database schema migrations...');
  await migrator.runMigrations();

  // 3. In non-production or when explicitly instructed, seed canonical demo fleet
  if (!config.isProduction || process.env.SEED_DEMO_DATA === 'true') {
    await migrator.seedDemoData();
  }

  // 4. Initialize BackendApp with PostgreSQL repository
  const postgresRepo = PostgresDatabaseRepository.getInstance();
  const app = BackendApp.getInstance(postgresRepo);

  const server = createServer(async (req, res) => {
    try {
      const handled = await app.handleRequest(req, res);
      if (!handled) {
        const requestId = RequestIdManager.resolveRequestId(req, res);
        res.statusCode = 404;
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify(ApiError.notFound(requestId, `Not Found: ${req.url || '/'}`)));
      }
    } catch (err: unknown) {
      const requestId = RequestIdManager.resolveRequestId(req, res);
      StructuredLogger.error({
        requestId,
        message: 'Internal server error handling HTTP request',
        meta: { error: err instanceof Error ? err.message : String(err) },
      });
      res.statusCode = 500;
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify(ApiError.internal(requestId, err, config.isProduction)));
    }

  });

  server.listen(port, host, () => {
    console.log(`[MineCare Backend] Server running on http://${host}:${port}`);
    console.log(`[MineCare Backend] API Endpoints available at http://${host}:${port}/api/v1/`);
    console.log(`[MineCare Backend] Database Engine: ${connectionManager.isPgMem() ? 'PostgreSQL (pg-mem)' : 'Supabase PostgreSQL'}`);
    console.log(`[MineCare Backend] Auth Authority: Supabase Auth + JWT`);
  });

  // Graceful shutdown
  const shutdown = async (signal: string) => {
    console.log(`\n[MineCare Backend] Received ${signal}. Draining connections and shutting down...`);
    BackendApp.resetInstance();
    RealtimePublisher.resetInstance();
    server.close(async () => {
      await connectionManager.closePool();
      console.log('[MineCare Backend] Cleanup complete. Process exiting gracefully.');
      process.exit(0);
    });

    setTimeout(() => {
      console.error('[MineCare Backend] Force exiting after timeout.');
      process.exit(1);
    }, 5000).unref();
  };

  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
}

bootstrap().catch((err) => {
  console.error('[MineCare Backend] Fatal bootstrap failure:', err);
  process.exit(1);
});
