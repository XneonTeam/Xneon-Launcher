import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'

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
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes('node_modules')) return
          // extract package name (handles scoped packages like @radix-ui/react-dialog)
          const match = id.match(/node_modules\/((?:@[^/]+\/)?[^/]+)/)
          const pkg = match?.[1] ?? ''

          if (pkg === 'react' || pkg === 'react-dom' || pkg === 'scheduler') return 'react'
          if (pkg.startsWith('@radix-ui/')) return 'radix'
          if (pkg === 'i18next' || pkg === 'react-i18next') return 'i18n'
          if (pkg === 'recharts' || pkg.startsWith('d3-') || pkg === 'victory-vendor') return 'charts'
          if (pkg === 'skinview3d' || pkg === 'three') return 'skinview'
          if (pkg === 'date-fns') return 'datefns'
          if (pkg === '@tabler') return 'icons'
          return 'vendor'
        },
      },
    },
  },
})
