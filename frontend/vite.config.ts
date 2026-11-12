import { fileURLToPath, URL } from 'node:url'

import vue from '@vitejs/plugin-vue'
import { defineConfig } from 'vitest/config'

// Local runs keep the backend on localhost; Docker Compose overrides this
// with VITE_PROXY_TARGET=http://backend:8000.
const proxyTarget = process.env.VITE_PROXY_TARGET ?? 'http://127.0.0.1:8000'

export default defineConfig({
  plugins: [vue()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  server: {
    port: 5173,
    strictPort: true,
    proxy: {
      // Same-origin in the browser: /api goes to FastAPI, so the HttpOnly
      // session cookie works without CORS. `changeOrigin` stays false on
      // purpose - the backend does not inspect the Host header.
      '/api': {
        target: proxyTarget,
        changeOrigin: false,
      },
    },
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['./tests/setup.ts'],
    include: ['tests/**/*.spec.ts', 'src/**/*.spec.ts'],
  },
})
