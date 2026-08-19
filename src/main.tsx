import ReactDOM from 'react-dom/client'
import { App } from './App'
import '@fontsource/plus-jakarta-sans/400.css'
import '@fontsource/plus-jakarta-sans/500.css'
import '@fontsource/plus-jakarta-sans/600.css'
import '@fontsource/plus-jakarta-sans/700.css'
import './index.css'

const root = document.getElementById('root')!
const rootEl = ReactDOM.createRoot(root)

rootEl.render(<App />)
window.addEventListener('app:hydrated', () => {
  document.getElementById('splash')?.remove()
}, { once: true })
setTimeout(() => document.getElementById('splash')?.remove(), 10000)