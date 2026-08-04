import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [sveltekit()],
  server: {
    port: 5173,
    // Proxy API calls to the backend in dev so cookies/CORS are simple.
    proxy: {
      '/api': { target: 'http://localhost:8080', changeOrigin: true },
      '/up': { target: 'http://localhost:8080', changeOrigin: true },
    },
  },
});
