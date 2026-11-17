import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'
import { fileURLToPath } from 'url'
import packageJson from './package.json' with { type: 'json' }

const __dirname = path.dirname(fileURLToPath(import.meta.url))

export default defineConfig({
  define: { XNLC_APPLICATION_USER_AGENT: JSON.stringify(`Xneon-Launcher/${packageJson.version}`) },
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
    dedupe: ['react', 'react-dom', 'i18next', 'react-i18next'],
    alias: {
      'electrobun/view': path.resolve(__dirname, '.hutch/devkit/api/browser/index.ts'),
      '@': path.resolve(__dirname, '.'),
    },
  },
  server: {
    host: '127.0.0.1',
    port: 5173,
    strictPort: true,
    watch: {
      ignored: [
        '**/.hutch/**',
        '**/.local-research/**',
        '**/build-electrobun/**',
        '**/release-electrobun/**',
        '**/dist-workers/**',
        '**/packages/**/lib-cjs/**',
        '**/.dsh-*/**',
        '**/logs/**',
        '**/screenshots/**',
        '**/tsconfig.tsbuildinfo',
        '**/release/**',
        '**/dist-electrobun/**',
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
      awaitWriteFinish: { stabilityThreshold: 100, pollInterval: 20 },
    },
  },
  build: {
    manifest: true,
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

          const segments = id.split(/[\\/]/)
          const idx = segments.lastIndexOf('node_modules')
          if (idx < 0 || idx + 1 >= segments.length) return
          let pkg = segments[idx + 1]
          if (pkg.startsWith('@') && idx + 2 < segments.length) {
            pkg = `${pkg}/${segments[idx + 2]}`
          }

          if (pkg === 'react' || pkg === 'react-dom' || pkg === 'scheduler') return 'react'
          if (pkg === 'skinview3d' || pkg === 'three') return 'skinview'
          if (pkg.startsWith('@tabler/')) return 'icons'
          // Остальное делит граф импортов: общий vendor втягивал Markdown/parse5
          // в entry и принудительно загружал их до первого рендера.
        },
      },
    },
  },
})
