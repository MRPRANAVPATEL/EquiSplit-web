import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'prompt',
      includeAssets: ['icons/favicon-32.png', 'icons/apple-touch-icon.png'],
      manifest: {
        id: '/',
        name: 'EquiSplit',
        short_name: 'EquiSplit',
        description: 'Record shared expenses and see exactly who pays whom.',
        start_url: '/',
        scope: '/',
        display: 'standalone',
        theme_color: '#f5f5ed',
        background_color: '#f5f5ed',
        icons: [
          { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
          { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
          { src: '/icons/maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{html,js,css,png,woff2,webmanifest}'],
        navigateFallbackAllowlist: [/^\/(?:index\.html)?(?:\?.*)?$/],
        cleanupOutdatedCaches: true,
        clientsClaim: true,
        skipWaiting: false,
        inlineWorkboxRuntime: true,
      },
    }),
  ],
  build: { target: ['safari16', 'chrome107', 'firefox104', 'edge107'] },
});
