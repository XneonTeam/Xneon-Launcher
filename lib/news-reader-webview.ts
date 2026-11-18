import type { ElectrobunWebviewElement } from "@/src/electrobun-webview"

const STYLE_ID = "xneon-news-reader-style"
const READY_MESSAGE = "xneon-news-reader-ready"

/** Применяется и в preload, где <html> ещё может отсутствовать, и при смене темы. */
export function newsReaderStyleScript(css: string): string {
  return `(() => {
    const apply = () => {
      const id = ${JSON.stringify(STYLE_ID)}
      let style = document.getElementById(id)
      if (!style) {
        style = document.createElement('style')
        style.id = id
        document.documentElement.appendChild(style)
      }
      style.textContent = ${JSON.stringify(css)}
    }
    if (document.documentElement) apply()
    else document.addEventListener('DOMContentLoaded', apply, { once: true })
  })()`
}

/** Один наблюдатель на документ: обрабатывает только добавленные узлы, не весь сайт. */
const GUEST_SCRIPT = `(() => {
  if (window.__xneonNewsReaderGuest) return
  window.__xneonNewsReaderGuest = true
  const selector = 'a[target], img, video, audio, iframe'
  const enhanceElement = (el) => {
    if (!el || typeof el.matches !== 'function') return
    if (el.matches('a[target]')) el.removeAttribute('target')
    if (el.matches('img, iframe') && !el.hasAttribute('loading')) el.setAttribute('loading', 'lazy')
    if (el.matches('img')) el.setAttribute('decoding', 'async')
    if (el.matches('video, audio')) {
      el.autoplay = false
      el.removeAttribute('autoplay')
      el.preload = 'none'
      el.pause()
      el.controls = true
    }
  }
  const enhance = (root) => {
    enhanceElement(root)
    if (root && root.querySelectorAll) root.querySelectorAll(selector).forEach(enhanceElement)
  }
  enhance(document)
  const observer = new MutationObserver((records) => {
    for (const record of records) {
      if (record.type === 'attributes') enhanceElement(record.target)
      else record.addedNodes.forEach(enhance)
    }
  })
  const observe = () => observer.observe(document, { childList: true, subtree: true, attributes: true, attributeFilter: ['target'] })
  observe()
  window.addEventListener('pagehide', () => observer.disconnect())
  window.addEventListener('pageshow', (event) => { if (event.persisted) { enhance(document); observe() } })
  const ready = () => window.__electrobunSendToHost?.({ type: ${JSON.stringify(READY_MESSAGE)}, url: location.href })
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', ready, { once: true })
  else ready()
})()`

/** Текст показывается по DOMContentLoaded, не ждёт window.load и всех изображений. */
export function newsReaderPreloadScript(css?: string): string {
  // Preload может выполняться и во вложенных iframe: они не должны раньше
  // статьи отправлять сигнал готовности или получать её оформление.
  return `(() => { if (window !== window.top) return;\n${css === undefined ? "" : newsReaderStyleScript(css)};\n${GUEST_SCRIPT}\n})()`
}

/** Игнорируем about:blank при запуске гостя, а также нерелевантные host-message. */
export function isNewsReaderDocumentUrl(value: unknown): boolean {
  return typeof value === "string" && /^https?:\/\//i.test(value)
}

export function isNewsReaderReadyMessage(detail: unknown): boolean {
  try {
    const message = typeof detail === "string" ? JSON.parse(detail) : detail
    return message?.type === READY_MESSAGE && isNewsReaderDocumentUrl(message.url)
  } catch {
    return false
  }
}

const guardedWebviews = new WeakSet<ElectrobunWebviewElement>()

/**
 * SDK 2.0.6 не проверяет isConnected после асинхронного webviewTagInit:
 * disconnectedCallback с webviewId=null не удаляет поздно созданного гостя.
 * Адаптер читалки закрывает эту гонку, не меняя сгенерированный SDK.
 */
export function guardNewsReaderInitialization(el: ElectrobunWebviewElement, url: string): void {
  if (guardedWebviews.has(el) || typeof el.initWebview !== "function") return
  guardedWebviews.add(el)
  const initialize = el.initWebview.bind(el)
  let pending: Promise<void> | undefined
  el.initWebview = () => {
    if (pending) return pending
    if (!el.isConnected || el.webviewId !== null) return Promise.resolve()
    pending = (async () => {
      await initialize()
      if (!el.isConnected) {
        el.disconnectedCallback()
        return
      }
      // Initial src — about:blank. Реальную статью передаём лишь после init:
      // иначе SDK грузит её и из initial src, и из отложенной очереди navigation.
      if (el.webviewId !== null) el.loadURL(url)
    })()
    return pending
  }
}
