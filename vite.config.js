import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  root: 'renderer',
  base: './',
  plugins: [react()],
  server: {
    port: 5173,
  },
  build: {
    outDir: path.resolve(__dirname, 'dist', 'renderer'),
    emptyOutDir: true,
  },
  resolve: {
    extensions: ['.js', '.jsx'],
  },
});