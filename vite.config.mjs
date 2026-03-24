import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      // Precache all build output (app shell: HTML + JS + CSS + assets)
      includeAssets: ['**/*'],
      manifest: {
        name: 'Notebook',
        short_name: 'Notebook',
        start_url: null,
        description: 'Daily journal and lists',
        theme_color: '#ffffff',
        background_color: '#ffffff',
        display: 'standalone',
        icons: [
          {
            src: 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><text y=".9em" font-size="90">📓</text></svg>',
            sizes: 'any',
            type: 'image/svg+xml',
            purpose: 'any maskable',
          },
        ],
      },
      workbox: {
        // Cache the SPA's index.html for all navigation requests
        navigateFallback: 'index.html',
        // Precache all static assets emitted by Vite
        globPatterns: ['**/*.{js,css,html,ico,svg,png,woff2}'],
        // NetworkFirst for API calls so offline falls back to cached responses
        runtimeCaching: [
          {
            urlPattern: /^\/api\//,
            handler: 'NetworkFirst',
            options: {
              cacheName: 'api-cache',
              networkTimeoutSeconds: 5,
              expiration: {
                maxEntries: 50,
                maxAgeSeconds: 60 * 60 * 24 * 7, // 7 days
              },
              cacheableResponse: {
                statuses: [200],
              },
            },
          },
        ],
      },
    }),
  ],
  server: {
    host: '0.0.0.0',
    port: 3000,
    proxy: {
      '/api': {
        target: 'http://localhost:4000',
        changeOrigin: true,
      },
      // Proxy /socket.io to backend
      '/socket.io': {
        target: 'ws://localhost:4000', // Your backend WS server
        ws: true, // Enable WebSocket proxying
        changeOrigin: true
      }//,
      // Example: Proxy another websocket endpoint
      //'/ws': {
      //  target: 'ws://localhost:8078',
      //  ws: true
      // }
    },
    preview: {
      host: '0.0.0.0',
      port: 3000,
    },
  }
})
