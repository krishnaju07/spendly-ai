import { fileURLToPath, URL } from 'node:url';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

const api = { target: process.env.API_URL ?? 'http://localhost:4000', changeOrigin: false };

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      // the user decides when to reload into a new version (see UpdatePrompt)
      registerType: 'prompt',
      injectRegister: false,
      includeAssets: ['favicon.svg', 'icons/apple-touch-icon.png'],
      manifest: {
        id: '/',
        name: 'Spendly AI',
        short_name: 'Spendly',
        description: 'Every rupee tracked. Every decision smarter.',
        lang: 'en-IN',
        start_url: '/?source=pwa',
        scope: '/',
        display: 'standalone',
        display_override: ['standalone', 'minimal-ui'],
        background_color: '#08090B',
        theme_color: '#08090B',
        categories: ['finance', 'productivity'],
        icons: [
          { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
          { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
          { src: '/icons/maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
          { src: '/icons/icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' },
        ],
        shortcuts: [
          { name: 'Add a transaction', short_name: 'Add', url: '/transactions?new=1', icons: [{ src: '/icons/icon-192.png', sizes: '192x192' }] },
          { name: 'Ask the Money Coach', short_name: 'Coach', url: '/coach', icons: [{ src: '/icons/icon-192.png', sizes: '192x192' }] },
        ],
      },
      workbox: {
        // Only the app shell is cached. API responses carry financial data and are never stored by the service worker.
        globPatterns: ['**/*.{js,css,html,svg,png,ico,woff2,webmanifest}'],
        // only the default typeface ships with the install; the others are fetched (and then cached) when chosen
        globIgnores: ['**/assets/{sora,geist,manrope,bricolage-grotesque}-*.woff2'],
        navigateFallback: '/index.html',
        navigateFallbackDenylist: [/^\/api\//],
        cleanupOutdatedCaches: true,
        // fonts are the only thing cached on the fly: static files, never financial data
        runtimeCaching: [{ urlPattern: ({ request, sameOrigin }) => sameOrigin && request.destination === 'font', handler: 'CacheFirst', options: { cacheName: 'spendly-fonts', expiration: { maxEntries: 16 } } }],
      },
      devOptions: { enabled: false },
    }),
  ],
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
  server: { port: 5173, proxy: { '/api': api } },
  preview: { port: 4173, proxy: { '/api': api } },
  build: { target: 'es2022', chunkSizeWarningLimit: 700 },
});
