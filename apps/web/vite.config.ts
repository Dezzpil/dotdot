/// <reference types="vitest/config" />
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react()],
  base: './',
  server: {
    // dev: the API runs separately (npm start in apps/api or docker compose)
    proxy: { '/api': process.env.API_URL ?? 'http://localhost:3000' },
  },
  build: { target: 'es2022', sourcemap: false },
  test: { environment: 'happy-dom', setupFiles: ['src/test/setup.ts'] },
});
