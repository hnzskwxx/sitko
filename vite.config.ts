import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';

export default defineConfig({
  root: path.resolve(import.meta.dirname, 'web'),
  plugins: [react()],
  build: {
    outDir: path.resolve(import.meta.dirname, 'dist/web'),
    emptyOutDir: true,
    sourcemap: false,
  },
  resolve: { alias: { '@shared': path.resolve(import.meta.dirname, 'shared') } },
});
