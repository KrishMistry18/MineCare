import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
function backendApiPlugin(): Plugin {
  return {
    name: 'minecare-backend-api',
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        if (req.url && req.url.startsWith('/api/v1/')) {
          const { BackendApp } = await import('./src/backend/app');
          const app = BackendApp.getInstance();
          const handled = await app.handleRequest(req, res);
          if (handled) return;
        }
        next();
      });
    },
  };
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    tailwindcss(),
    react(),
    backendApiPlugin(),
  ],
})

