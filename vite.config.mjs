import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [
    react(),
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
