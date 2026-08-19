import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

export default defineConfig({
  plugins: [react()],
  base: './',
  resolve: {
    alias: {
      '@': path.resolve(__dirname, '.'),
    },
  },
  server: {
    port: 5173,
    strictPort: true,
    watch: {
      ignored: [
        '**/tsconfig.tsbuildinfo',
        '**/release/**',
        '**/dist-electron/**',
        '**/dist/**',
        '**/xnlc-package/lib/**',
        '**/xnlc-package/installer.log',
        '**/.codex/**',
        '**/.xneonlauncher/**',
      ],
      usePolling: false,
    },
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    chunkSizeWarningLimit: 2000,
    // Lazy tabs (instance, network, cloud, settings) pull heavy chunks like
    // emoji-mart/react-markdown. Don't let the entry eagerly preload them —
    // they should download only when the tab is opened.
    modulePreload: false,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes('node_modules')) return

          // Extract the real package name. pnpm store paths look like
          // `node_modules/.pnpm/@emoji-mart+data@1.6.0/node_modules/@emoji-mart/data/...`,
          // so we must take the segments AFTER the last `node_modules` occurrence.
          const segments = id.split(/[\\/]/)
          const idx = segments.lastIndexOf('node_modules')
          if (idx < 0 || idx + 1 >= segments.length) return 'vendor'
          let pkg = segments[idx + 1]
          if (pkg.startsWith('@') && idx + 2 < segments.length) {
            pkg = `${pkg}/${segments[idx + 2]}`
          }

          if (pkg === 'react' || pkg === 'react-dom' || pkg === 'scheduler') return 'react'
          if (pkg.startsWith('@radix-ui/')) return 'radix'
          if (pkg === 'i18next' || pkg === 'react-i18next' || pkg === 'i18next-http-backend' || pkg === 'i18next-resources-to-backend') return 'i18n'
          if (pkg === 'recharts' || pkg.startsWith('d3-') || pkg === 'victory-vendor') return 'charts'
          if (pkg === 'skinview3d' || pkg === 'three') return 'skinview'
          if (pkg === 'date-fns') return 'datefns'
          if (pkg.startsWith('@tabler/')) return 'icons'
          if (pkg === 'react-markdown' || pkg === 'rehype-raw' || pkg === 'rehype-sanitize' || pkg === 'remark-rehype' || pkg === 'unified') return 'markdown'
          if (pkg.startsWith('@emoji-mart/')) return 'emoji-mart'
          if (pkg === 'sql.js') return 'sql'
          if (pkg === 'axios' || pkg === 'form-data' || pkg === 'follow-redirects') return 'http'
          if (pkg === 'webdav') return 'webdav'
          if (pkg === 'electron-updater' || pkg === 'builder-util-runtime') return 'updater'
          if (pkg === 'adm-zip') return 'adm-zip'
          return 'vendor'
        },
      },
    },
  },
})
