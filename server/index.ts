/**
 * MineCare - Standalone Backend Server Entry
 *
 * Runs the MineCare REST API as an independent process on PORT (default 3001).
 */

import { createServer } from 'http';
import { BackendApp } from '../src/backend/app';

const port = Number(process.env.PORT || 3001);
const host = process.env.HOST || '0.0.0.0';
const app = BackendApp.getInstance();

const server = createServer(async (req, res) => {
  const handled = await app.handleRequest(req, res);
  if (!handled) {
    res.statusCode = 404;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ error: 'Not Found' }));
  }
});

server.listen(port, host, () => {
  console.log(`[MineCare Backend] Server running on http://${host}:${port}`);
  console.log(`[MineCare Backend] API Endpoints available at http://${host}:${port}/api/v1/`);
});
