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
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes('node_modules')) return
          const match = id.match(/node_modules\/((?:@[^/]+\/)?[^/]+)/)
          const pkg = match?.[1] ?? ''

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
