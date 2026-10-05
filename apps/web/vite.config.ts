import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';

const sharedDirectory = fileURLToPath(new URL('../../packages/shared/src/', import.meta.url));

export default defineConfig({
  plugins: [
    react(),
    {
      name: 'reload-shared-calculations',
      configureServer(server) {
        server.watcher.add(sharedDirectory);
        server.watcher.on('change', (path) => {
          if (path.startsWith(sharedDirectory) && path.endsWith('.js')) void server.restart();
        });
      },
    },
  ],
  optimizeDeps: { include: ['@sawit/shared'], force: true },
  build: { commonjsOptions: { include: [/node_modules/, /packages[\\/]shared/] } },
  server: { port: 5173, strictPort: true, proxy: { '/api': 'http://127.0.0.1:3001' } },
});
