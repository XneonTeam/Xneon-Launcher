import ReactDOM from 'react-dom/client'
import { initializeTheme } from '@/components/launcher/settings/theme-store'
import '@fontsource/plus-jakarta-sans/400.css'
import '@fontsource/plus-jakarta-sans/500.css'
import '@fontsource/plus-jakarta-sans/600.css'
import '@fontsource/plus-jakarta-sans/700.css'
import './index.css'
import { prepareStartupReveal, dismissStartupSplash } from './startup-splash'

prepareStartupReveal()

const root = document.getElementById('root')!
const rootEl = ReactDOM.createRoot(root)

window.addEventListener('app:hydrated', () => { void dismissStartupSplash() }, { once: true })

// Стартовый модуль не загружает весь граф лаунчера синхронно: HTML со splash
// успевает отрисоваться, пока загружаются приложение и сохранённая тема.
void Promise.all([
  import('./App'),
  (window.electronAPI?.startupReady?.() ?? Promise.resolve()).then(() => initializeTheme()).catch(error => console.error('[theme] Startup theme failed:', error)),
]).then(([{ App }]) => {
  rootEl.render(<App />)
  document.documentElement.dataset.themeReady = 'true'
  window.dispatchEvent(new Event('theme:ready'))
}).catch(error => {
  console.error('[startup] Application failed to load:', error)
  // Экран загрузки остаётся видимым вместо пустого окна при ошибке чанка.
  document.getElementById('splash')?.setAttribute('data-startup-error', 'true')
})

// Файл, брошенный мимо зоны приёма, не должен открываться в окне лаунчера:
// локальные зоны сами обрабатывают свой drop, здесь глушим только остальное.
window.addEventListener('dragover', (event) => {
  if (event.dataTransfer?.types?.includes('Files')) event.preventDefault()
})
window.addEventListener('drop', (event) => {
  if (event.dataTransfer?.types?.includes('Files')) event.preventDefault()
})
