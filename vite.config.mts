import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

export default defineConfig({
  plugins: [
    {
      name: 'tabler-direct-imports',
      enforce: 'pre',
      apply: 'serve',
      // Корневой barrel Tabler открывает тысячи неиспользуемых SVG при холодной
      // оптимизации. В dev запрашиваем только реально импортированные иконки.
      transform(code, id) {
        if (!/\.[jt]sx?(?:\?|$)/.test(id) || id.includes('node_modules') || !code.includes('@tabler/icons-react')) return
        return code.replace(/import\s*\{([^}]+)\}\s*from\s*['"]@tabler\/icons-react['"]/g, (_match, bindings: string) => bindings.split(',').map(binding => {
          const specifier = binding.trim()
          if (!specifier) return ''
          if (specifier.startsWith('type ')) return `import { ${specifier} } from '@tabler/icons-react'`
          const [name, local = name] = specifier.split(/\s+as\s+/)
          if (['Icon', 'IconProps', 'TablerIcon'].includes(name)) return `import type { ${specifier} } from '@tabler/icons-react'`
          return `import ${local} from '@tabler/icons-react/dist/esm/icons/${name}.mjs'`
        }).join('\n'))
      },
    },
    react(),
  ],
  base: './',
  // Зависимости известны заранее, включая ленивые разделы: собираем их одним
  // проходом без повторного crawl и перезагрузок страницы при открытии вкладок.
  optimizeDeps: {
    noDiscovery: true,
    holdUntilCrawlEnd: false,
    include: [
      'react', 'react-dom', 'react-dom/client', 'react/jsx-runtime', 'react/jsx-dev-runtime',
      'react-i18next', 'i18next',
      '@radix-ui/react-checkbox', '@radix-ui/react-dialog', '@radix-ui/react-select',
      'clsx', 'tailwind-merge', 'react-markdown', 'remark-gfm',
      'rehype-raw', 'rehype-sanitize', 'prismjs', 'react-simple-code-editor', 'skinview3d',
    ],
  },
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
        // Chokidar не читает .gitignore: локальный store содержит десятки тысяч
        // файлов и установка наблюдателей блокировала dev-сервер на 40–50 секунд.
        '**/.pnpm-store/**',
        '**/.electron-mcp/**',
        '**/.dsh-*/**',
        '**/logs/**',
        '**/screenshots/**',
        '**/tsconfig.tsbuildinfo',
        '**/release/**',
        '**/dist-electron/**',
        '**/dist/**',
        '**/xnlc-package/lib/**',
        '**/xnlc-package/installer.log',
        '**/.codex/**',
        '**/.xneonlauncher/**',
        '**/*.tmp*',
        '**/.*.tmpdir/**',
        '**/packages/**/lib/**',
        '**/.tmp*/**',
      ],
      usePolling: false,
    },
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    chunkSizeWarningLimit: 2000,
    // Lazy tabs (instance, network, cloud, settings) pull heavy chunks like
    // react-markdown. Don't let the entry eagerly preload them — they should
    // download only when the tab is opened.
    modulePreload: false,
    rollupOptions: {
      // Асинхронные хуки CSS и ресурсов перекрываются: их время нельзя
      // измерить точно. Отключаем только эту диагностику профилировщика.
      checks: {
        pluginTimings: false,
      },
      output: {
        manualChunks(id) {
          if (!id.includes('node_modules')) return

          // Extract the real package name. pnpm store paths look like
          // `node_modules/.pnpm/@tabler+icons-react@3.45.0/node_modules/@tabler/icons-react/...`,
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
