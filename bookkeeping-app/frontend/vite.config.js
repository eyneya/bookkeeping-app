import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);

// Mounts the Express backend as Vite middleware so the entire app
// (frontend + API) runs in a single dev server process — no separate
// backend process, no port 3001, no fragile shell `&` backgrounding.
function expressMiddleware() {
  return {
    name: 'express-middleware',
    configureServer(server) {
      const apiApp = require('../backend/server.js');
      server.middlewares.use((req, res, next) => {
        if (req.url.startsWith('/api')) {
          apiApp(req, res, next);
        } else {
          next();
        }
      });
    },
  };
}

export default defineConfig({
  plugins: [react(), expressMiddleware()],
  server: {
    host: true,
  },
});
