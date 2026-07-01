import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      injectRegister: false,
      includeAssets: ['favicon-32.png', 'apple-touch-icon.png', 'icon.svg'],
      manifest: {
        name: '暗棋象棋',
        short_name: '暗棋象棋',
        description: '局域网联机暗棋象棋 - Hidden Piece Chinese Chess',
        theme_color: '#0f3460',
        background_color: '#1a1a2e',
        display: 'standalone',
        orientation: 'portrait',
        lang: 'zh-CN',
        start_url: '/',
        icons: [
          { src: '/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: '/icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        // The game is real-time and needs the live server; only cache the app
        // shell (HTML/JS/CSS), never the socket or API requests.
        navigateFallback: '/index.html',
        globPatterns: ['**/*.{js,css,html,svg,png,ico}'],
      },
      devOptions: {
        enabled: false,
      },
    }),
  ],
  server: {
    port: 5173,
    proxy: {
      '/socket.io': {
        target: 'http://localhost:3030',
        ws: true,
      },
    },
  },
  build: {
    outDir: 'dist',
  },
});
