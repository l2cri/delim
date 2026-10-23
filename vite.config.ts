/// <reference types="vitest/config" />
/// <reference types="node" />
import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import tailwindcss from '@tailwindcss/vite'
import { VitePWA } from 'vite-plugin-pwa'

// GitHub Pages отдаёт сайт из подкаталога /<repo>/ — база выводится из имени
// репозитория, которое Actions выставляет в GITHUB_REPOSITORY; локально — корень.
const base = process.env.GITHUB_REPOSITORY
  ? `/${process.env.GITHUB_REPOSITORY.split('/')[1]}/`
  : '/'

export default defineConfig({
  base,
  plugins: [
    vue(),
    tailwindcss(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.svg', 'apple-touch-icon.png'],
      manifest: {
        name: 'Делим — сплит общих расходов',
        short_name: 'Делим',
        description:
          'Offline-сплиттер расходов для поездок: минимальный список переводов без сервера и регистраций.',
        lang: 'ru',
        display: 'standalone',
        background_color: '#ffffff',
        theme_color: '#059669',
        start_url: base,
        scope: base,
        icons: [
          { src: 'pwa-192x192.png', sizes: '192x192', type: 'image/png' },
          { src: 'pwa-512x512.png', sizes: '512x512', type: 'image/png' },
          {
            src: 'pwa-maskable-512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
        ],
      },
      // Только precache оболочки: у приложения нет сетевых запросов, runtime-кэширование не нужно.
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,webmanifest}'],
      },
    }),
  ],
  test: {
    environment: 'happy-dom',
  },
})
