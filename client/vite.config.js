import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      injectRegister: false,
      includeAssets: ['favicon-32.png', 'apple-touch-icon.png'],
      manifest: {
        name: '奶棋',
        short_name: '奶棋',
        description: '局域网联机奶棋',
        theme_color: '#07182f',
        background_color: '#07182f',
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
