import { defineConfig } from 'vite';

// The backend runs on :8787. In dev we proxy /api and /ws to it so the
// frontend can use same-origin paths (no CORS headaches, easy to deploy
// behind one reverse proxy in production).
export default defineConfig({
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://localhost:8787',
        changeOrigin: true,
        rewrite: (p) => p.replace(/^\/api/, ''),
      },
      '/ws': {
        target: 'ws://localhost:8787',
        ws: true,
      },
    },
  },
  build: { target: 'es2020' },
});
