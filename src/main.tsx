import "../electrobun/preload"
import { bootstrapDesktop } from "../electrobun/platform/renderer"
import ReactDOM from 'react-dom/client'
import { initializeTheme } from '@/components/launcher/settings/theme-store'
import '@fontsource/plus-jakarta-sans/400.css'
import '@fontsource/plus-jakarta-sans/500.css'
import '@fontsource/plus-jakarta-sans/600.css'
import '@fontsource/plus-jakarta-sans/700.css'
import './index.css'
import { prepareStartupReveal, dismissStartupSplash } from './startup-splash'
import { installExternalLinks } from '@/lib/external-links'

// Убираем браузерное меню WebView2; само событие оставляем меню сборок и серверов.
window.addEventListener('contextmenu', (event) => event.preventDefault(), { capture: true })
if (window.electrobunAPI) installExternalLinks(window, url => window.electrobunAPI!.openExternal(url))

prepareStartupReveal()

const root = document.getElementById('root')!
const rootEl = ReactDOM.createRoot(root)

window.addEventListener('app:hydrated', () => {
  void dismissStartupSplash()
  // Событие приходит из useEffect уже смонтированного Launcher, не из загрузки HTML/splash.
  void window.electrobunAPI?.startupUpdateReady().catch(error => console.error('[startup] Update confirmation failed:', error))
}, { once: true })

// Стартовый модуль не загружает весь граф лаунчера синхронно: HTML со splash
// успевает отрисоваться, пока загружаются приложение и сохранённая тема.
void Promise.all([
  import('./App'),
  import('./i18n').then(({ initI18n }) => initI18n()),
  bootstrapDesktop().then(async () => {
    const startupError = await window.electrobunAPI?.startupReady()
    if (startupError !== null && startupError !== undefined) throw new Error(startupError)
    await initializeTheme().catch(error => console.error('[theme] Startup theme failed:', error))
  }),
]).then(([{ App }]) => {
  rootEl.render(<App />)
  document.documentElement.dataset.themeReady = 'true'
  window.dispatchEvent(new Event('theme:ready'))
}).catch(error => {
  console.error('[startup] Application failed to load:', error)
  const splash = document.getElementById('splash')
  if (!splash) return
  splash.setAttribute('role', 'alert')
  splash.querySelector('.bar-track')?.remove()
  const hint = splash.querySelector('.hint')
  if (hint) hint.textContent = error instanceof Error ? error.message : String(error)
})

// Файл, брошенный мимо зоны приёма, не должен открываться в окне лаунчера:
// локальные зоны сами обрабатывают свой drop, здесь глушим только остальное.
window.addEventListener('dragover', (event) => {
  if (event.dataTransfer?.types?.includes('Files')) event.preventDefault()
})
window.addEventListener('drop', (event) => {
  if (event.dataTransfer?.types?.includes('Files')) event.preventDefault()
})
