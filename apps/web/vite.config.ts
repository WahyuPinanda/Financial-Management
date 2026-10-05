import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  optimizeDeps: { include: ['@sawit/shared'], force: true },
  build: { commonjsOptions: { include: [/node_modules/, /packages[\\/]shared/] } },
  server: { port: 5173, strictPort: true, proxy: { '/api': 'http://127.0.0.1:3001' } },
});
