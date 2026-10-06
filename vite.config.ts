import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
function backendApiPlugin(): Plugin {
  return {
    name: 'minecare-backend-api',
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        if (req.url && req.url.startsWith('/api/v1/')) {
          try {
            const { BackendApp } = await import('./src/backend/app');
            const app = BackendApp.getInstance();
            const handled = await app.handleRequest(req, res);
            if (handled) return;
          } catch (err: unknown) {
            console.error('[Vite Backend Middleware Error]', err instanceof Error ? err.message : String(err));
            if (!res.headersSent) {
              res.statusCode = 500;
              res.setHeader('Content-Type', 'application/json');
              res.end(JSON.stringify({ error: 'Internal Server Error', message: 'An unexpected internal error occurred.' }));
            }
            return;
          }
        }
        next();
      });
    },
  };
}

// https://vite.dev/config/
export default defineConfig(({ command }) => {
  const isBuild = command === 'build';
  return {
    define: isBuild
      ? {
          'import.meta.env.DEV': 'false',
          'import.meta.env.PROD': 'true',
        }
      : {},
    plugins: [
      tailwindcss(),
      react(),
      backendApiPlugin(),
    ],
  };
});

