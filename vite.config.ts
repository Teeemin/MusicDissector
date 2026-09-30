import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { VitePWA } from 'vite-plugin-pwa'

// https://vite.dev/config/
export default defineConfig({
  // Workers start only after a user action and are missed by the initial HTML
  // dependency crawl. Discover them now: late optimization triggers a full dev
  // page reload, which discards the user's session-only File and audio buffers.
  optimizeDeps: {
    include: ['music-metadata', 'essentia.js/dist/essentia.js-core.es.js', 'onnxruntime-web/all'],
  },
  worker: { format: 'es' },
  server: {
    port: 5173,
    strictPort: true,
  },
  plugins: [
    react(),
    VitePWA({
      registerType: 'prompt',
      includeAssets: ['favicon.svg', 'icons/*.png'],
      manifest: {
        id: './',
        name: 'StemLab',
        short_name: 'StemLab',
        description: '내 기기에서 즐기는 나만의 음악 플레이어',
        lang: 'ko',
        start_url: './',
        scope: './',
        display: 'standalone',
        background_color: '#FFFFFF',
        theme_color: '#FFFFFF',
        categories: ['music'],
        icons: [
          { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
          { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
          { src: 'icons/maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        // Includes Essentia's local ESM WASM asset for offline analysis.
        maximumFileSizeToCacheInBytes: 32 * 1024 * 1024,
        globPatterns: ['**/*.{js,mjs,wasm,css,html,svg,png,webmanifest}'],
        navigateFallback: 'index.html',
        cleanupOutdatedCaches: true,
        // Only the app shell is precached. User audio stays in local blob URLs.
      },
    }),
  ],
})
