import { useCallback, useRef, useState } from "react"
import { useTranslation } from "react-i18next"
import { IconAlertTriangle, IconExternalLink, IconLoader2, IconNews, IconRefresh, IconX } from "@tabler/icons-react"
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog"
import { formatDate, type NewsEntry } from "@/lib/home-page-shared"
import { normalizeNewsArticleUrl } from "@/lib/news-url"
import type { ElectrobunWebviewElement } from "@/src/electrobun-webview"
import { getAppliedReaderCss, splitThemeCssPrelude } from "./settings/theme-model"

/**
 * Читалка новостей: статья открывается модалом прямо в окне лаунчера
 * (`<electrobun-webview>`), а не отдельным окном и не системным браузером.
 *
 * Тег — гостевой webview поверх окна (аналог Electron `<webview>`): он
 * создаётся native-слоем, поэтому React-оверлей загрузки виден только пока
 * гость прозрачный (`transparent` + `passthrough`). После `dom-ready`
 * впрыскиваем стили темы и «проявляем» гостя.
 */

// Сайтовая обвязка (шапка, футер, баннеры согласия) только мешает чтению статьи.
const READER_CSS = `
  header, footer, nav, [role="banner"], [role="contentinfo"],
  .global-header, .global-footer, #onetrust-consent-sdk, .msccBanner,
  #wcpConsentBannerCtrl, [class*="cookie-banner"], [id*="cookie-banner"] {
    display: none !important;
  }
`

// `target="_blank"` уводил бы ссылку в новое окно, а всплывающие окна в
// читалке запрещены (как `allowpopups: false` в Electron) — поэтому ссылки
// внутри статьи ведём в ней же.
const INLINE_LINKS_JS = `(() => {
  const strip = (root) => {
    if (!root || !root.querySelectorAll) return
    root.querySelectorAll('a[target]').forEach((a) => a.removeAttribute('target'))
  }
  strip(document)
  const observer = new MutationObserver(() => strip(document))
  observer.observe(document.documentElement, { childList: true, subtree: true })
})()`

const READER_STYLE_ID = "xneon-news-reader-style"
/** Период опроса готовности тега, мс. */
const PROBE_INTERVAL = 250
/** Сколько ждём инициализации гостя в native. */
const INIT_TIMEOUT_MS = 10_000
/** Сколько ждём загрузки статьи до вердикта «не удалось». */
const LOAD_TIMEOUT_MS = 25_000

/** Значение токена темы лаунчера; если переменной нет — запасное значение. */
function themeToken(name: string, fallback: string) {
  try {
    const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim()
    return value || fallback
  } catch {
    return fallback
  }
}

/**
 * CSS для гостевой страницы: прячем сайтовую обвязку и приводим скроллбар
 * к тому же виду, что и во всём лаунчере (`::-webkit-scrollbar` в `src/index.css`):
 * 6px, скруглённый, трек — `--muted`, ползунок — `--border`, при наведении — `--primary`.
 * Цвета берём из текущей темы лаунчера, чтобы читалка совпадала с окном при любом оформлении.
 */
function buildReaderCss() {
  const muted = themeToken("--muted", "oklch(0.14 0.01 260)")
  const border = themeToken("--border", "oklch(0.17 0.01 260)")
  const primary = themeToken("--primary", "oklch(0.65 0.22 40)")
  const background = themeToken("--card", "#18181b")
  const foreground = themeToken("--card-foreground", "#f4f4f5")
  const mode = document.documentElement.classList.contains("dark") ? "dark" : "light"
  return `${READER_CSS}
  html, body {
    background-color: ${background} !important;
    color: ${foreground} !important;
    color-scheme: ${mode} !important;
  }
  main, article, [role="main"] {
    background-color: transparent !important;
    color: ${foreground} !important;
  }
  h1, h2, h3, h4, p, li { color: ${foreground} !important; }
  a { color: ${primary} !important; }
  ::-webkit-scrollbar, *::-webkit-scrollbar {
    width: 6px !important;
    height: 6px !important;
  }
  ::-webkit-scrollbar-track, *::-webkit-scrollbar-track {
    background: ${muted} !important;
    border-radius: 3px !important;
  }
  ::-webkit-scrollbar-thumb, *::-webkit-scrollbar-thumb {
    background: ${border} !important;
    border-radius: 3px !important;
  }
  ::-webkit-scrollbar-thumb:hover, *::-webkit-scrollbar-thumb:hover {
    background: ${primary} !important;
  }
  ::-webkit-scrollbar-corner, *::-webkit-scrollbar-corner {
    background: transparent !important;
  }
  /* Если сайт задал стандартные scrollbar-color/scrollbar-width, Chromium
     игнорирует ::-webkit-scrollbar — возвращаем их в auto, чтобы наш стиль работал. */
  * {
    scrollbar-width: auto !important;
    scrollbar-color: auto !important;
  }
`
}

/** Одна таблица гостя: импорт ресурсов, базовая палитра, затем правила автора. */
export function buildThemeReaderCss() {
  const reader = splitThemeCssPrelude(getAppliedReaderCss())
  return `${reader.prelude}\n${buildReaderCss()}\n${reader.body}`
}

/**
 * У `<electrobun-webview>` нет `insertCSS`, поэтому стили ставим своим
 * `<style>`-элементом в документ гостя. Идемпотентно: обновляет тот же тег.
 */
function readerStyleScript(css: string) {
  return `(() => {
  const id = ${JSON.stringify(READER_STYLE_ID)}
  let style = document.getElementById(id)
  if (!style) {
    style = document.createElement('style')
    style.id = id
    document.documentElement.appendChild(style)
  }
  style.textContent = ${JSON.stringify(css)}
})()`
}

interface NewsReaderModalProps {
  /** Новость для чтения; `null` — модал закрыт. */
  entry: NewsEntry | null
  onClose: () => void
}

/** React 19 пишет props в свойства custom element, но sandbox у SDK имеет только getter. */
export function prepareNewsReaderWebview(el: ElectrobunWebviewElement) {
  // Гостевой тег SDK по умолчанию выбирает native, независимо от build.defaultRenderer.
  const platform = typeof window === "undefined" ? undefined : (window as Window & { __electrobunPlatform?: string }).__electrobunPlatform
  el.setAttribute("renderer", platform === "linux" ? "cef" : "native")
  // Native читает начальное состояние через hasAttribute в отложенном initWebview.
  el.setAttribute("sandbox", "")
  el.setAttribute("transparent", "")
  el.setAttribute("passthrough", "")
}

export function NewsReaderModal({ entry, onClose }: NewsReaderModalProps) {
  const { t } = useTranslation()
  const [loading, setLoading] = useState(true)
  const [failed, setFailed] = useState(false)
  /** Пересоздание гостя по кнопке «Повторить»: смена `key` = чистый повторный заход. */
  const [reloadKey, setReloadKey] = useState(0)
  const detachRef = useRef<(() => void) | null>(null)

  const url = normalizeNewsArticleUrl(entry?.readMoreLink)
  /** Ссылки нет (битая запись ленты): показываем ошибку, а не вечную загрузку. */
  const unavailable = !url
  /** Рубрика — та же связка, что и на карточке: tag → category → первый newsType. */
  const tag = entry?.tag ?? entry?.category ?? entry?.newsType?.[0]

  const openInBrowser = useCallback(() => {
    if (url) void window.electrobunAPI?.openExternal(url).catch(console.error)
  }, [url])

  /**
   * Подписка на события гостя — через callback-ref, а не через эффект.
   *
   * `DialogContent` рендерит содержимое в портал, и элемент появляется не в
   * том коммите, в котором открылся модал: эффект с зависимостью `[entry]`
   * успевал отработать до появления узла, а при появлении его зависимости не
   * менялись — слушатели не навешивались вообще никогда. Callback-ref
   * вызывается ровно в момент появления узла.
   */
  const attachWebview = useCallback((node: HTMLElement | null) => {
    detachRef.current?.()
    detachRef.current = null
    if (!node) return
    const el = node as ElectrobunWebviewElement
    prepareNewsReaderWebview(el)

    setLoading(true)
    setFailed(false)

    const startedAt = Date.now()
    let settled = false

    const inject = () => {
      try {
        el.executeJavascript(readerStyleScript(buildThemeReaderCss()))
        el.executeJavascript(INLINE_LINKS_JS)
      } catch {
        // Гость мог быть уже удалён — ничего страшного, стили не нужны.
      }
    }

    const stopTimers = () => {
      window.clearTimeout(loadTimer)
      window.clearInterval(probe)
    }

    /** Статья отрисована: впрыскиваем стили и показываем гостя. */
    const finish = () => {
      if (settled) return
      settled = true
      stopTimers()
      inject()
      try {
        el.toggleTransparent(false)
        el.togglePassthrough(false)
      } catch {
        // Тег без native-инициализации: ниже это покажет оверлей ошибки.
      }
      setLoading(false)
      setFailed(false)
    }

    const fail = () => {
      if (settled) return
      settled = true
      stopTimers()
      setLoading(false)
      setFailed(true)
    }

    const handleReady = () => finish()
    let themeFrame = 0
    const handleTheme = () => {
      cancelAnimationFrame(themeFrame)
      // applyTheme отправляет событие до записи переменных: читаем их в следующем кадре.
      themeFrame = requestAnimationFrame(() => { if (settled) inject() })
    }

    if (typeof el.on === "function") {
      el.on("dom-ready", handleReady)
      el.on("load-finished", handleReady)
    }
    window.addEventListener("theme:applied", handleTheme)

    // Гость создаётся native-слоем асинхронно (`webviewTagInit`). Если тег так
    // и не инициализировался, оверлей не должен висеть вечно.
    const probe = window.setInterval(() => {
      if (settled) return
      if (typeof el.on !== "function") {
        fail()
        return
      }
      if (el.webviewId !== null) {
        window.clearInterval(probe)
        return
      }
      if (Date.now() - startedAt >= INIT_TIMEOUT_MS) fail()
    }, PROBE_INTERVAL)
    const loadTimer = window.setTimeout(fail, LOAD_TIMEOUT_MS)

    detachRef.current = () => {
      settled = true
      stopTimers()
      cancelAnimationFrame(themeFrame)
      window.removeEventListener("theme:applied", handleTheme)
      if (typeof el.off === "function") {
        try {
          el.off("dom-ready", handleReady)
          el.off("load-finished", handleReady)
        } catch {
          // Узел уже удалён вместе с native-гостем.
        }
      }
    }
  }, [])

  return (
    <Dialog open={!!entry} onOpenChange={(open) => { if (!open) onClose() }}>
      <DialogContent data-window="news-reader-modal-window-1"
        showCloseButton={false}
        className="flex h-[min(88vh,880px)] w-[min(1180px,calc(100vw-3rem))] max-w-none flex-col gap-0 overflow-hidden rounded-2xl border-border bg-card p-0 shadow-2xl"
      >
        {/* Мачта читалки: та же связка «чип + рубрика», что и в шапке раздела новостей,
            чтобы модал читался как часть лаунчера, а не как чужое окно. */}
        <header data-ui="news-reader-modal-header-1" data-component="news-reader-modal" className="flex flex-shrink-0 items-start gap-3 border-b border-border bg-muted/20 px-4 py-3.5">
          <div data-ui="news-reader-modal-div-1" className="mt-0.5 flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg bg-primary/20">
            <IconNews className="h-4 w-4 text-primary" strokeWidth={2} />
          </div>

          <div data-ui="news-reader-modal-div-2" className="min-w-0 flex-1">
            {tag && (
              <span data-ui="news-reader-modal-span-1" className="mb-1 inline-block rounded-md bg-primary/15 px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-primary">
                {tag}
              </span>
            )}
            <DialogTitle className="line-clamp-2 text-[15px] font-semibold leading-snug text-foreground">
              {entry?.title ?? ""}
            </DialogTitle>
            <DialogDescription className="mt-0.5 text-xs text-muted-foreground/70">
              {entry ? formatDate(entry.date) : ""}
            </DialogDescription>
          </div>

          <div data-ui="news-reader-modal-div-3" className="flex flex-shrink-0 items-center gap-2">
            <button data-ui="news-reader-modal-button-1"
              type="button"
              onClick={openInBrowser}
              className="flex h-8 items-center gap-1.5 rounded-lg border border-border bg-muted/40 px-2.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
            >
              <IconExternalLink className="h-3.5 w-3.5" />
              <span data-ui="news-reader-modal-span-2" className="hidden md:inline">{t("home.news.openInBrowser")}</span>
            </button>

            <DialogClose asChild>
              <button data-ui="news-reader-modal-button-2"
                type="button"
                aria-label={t("home.news.readerClose")}
                className="flex h-8 w-8 items-center justify-center rounded-lg bg-muted/40 text-muted-foreground transition-colors hover:bg-destructive/15 hover:text-destructive focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
              >
                <IconX className="h-4 w-4" />
              </button>
            </DialogClose>
          </div>
        </header>

        {/* Статья — чужая страница, поэтому показываем её документом в рамке, а не
            белым листом во весь модал: на тёмной теме шов между `bg-white` и `bg-card`
            давал мутно-серую заливку при загрузке. */}
        <div data-ui="news-reader-modal-div-4" data-component="news-reader-modal" className="min-h-0 flex-1 p-3">
          <div data-ui="news-reader-modal-div-5" className="relative h-full w-full overflow-hidden rounded-xl border border-border bg-muted/30">
            {url && (
              <electrobun-webview data-ui="news-reader-modal-webview-1"
                key={`${url}:${reloadKey}`}
                ref={attachWebview}
                src={url}
                partition="persist:xneon-news"
                className="absolute inset-0 h-full w-full"
                // CSS SDK вне @layer задаёт 800×300 и перекрывает utilities Tailwind.
                // Native берёт геометрию из DOM: задаём размер inline, включая ресайз модала.
                style={{ width: "100%", height: "100%", background: "var(--card)" }}
              />
            )}

            {loading && !failed && !unavailable && (
              <div data-ui="news-reader-modal-div-6" className="pointer-events-none absolute inset-0 flex flex-col gap-4 bg-card/95 p-8">
                <div data-ui="news-reader-modal-div-7" className="flex items-center gap-2 text-xs text-muted-foreground">
                  <IconLoader2 className="h-3.5 w-3.5 animate-spin text-primary motion-reduce:animate-none" />
                  {t("home.news.readerLoading")}
                </div>
                {/* Скелетон в том же языке, что и у карточек новостей: пустое серое
                    поле со спиннером посредине читалось как «сломалось». */}
                <div data-ui="news-reader-modal-div-8" className="animate-pulse motion-reduce:animate-none">
                  <div data-ui="news-reader-modal-div-9" className="h-5 w-2/3 rounded bg-muted/70" />
                  <div data-ui="news-reader-modal-div-10" className="mt-3 h-3 w-full rounded bg-muted/50" />
                  <div data-ui="news-reader-modal-div-11" className="mt-2 h-3 w-11/12 rounded bg-muted/50" />
                  <div data-ui="news-reader-modal-div-12" className="mt-2 h-3 w-4/5 rounded bg-muted/50" />
                  <div data-ui="news-reader-modal-div-13" className="mt-7 h-3 w-full rounded bg-muted/40" />
                  <div data-ui="news-reader-modal-div-14" className="mt-2 h-3 w-10/12 rounded bg-muted/40" />
                  <div data-ui="news-reader-modal-div-15" className="mt-2 h-3 w-9/12 rounded bg-muted/40" />
                </div>
              </div>
            )}

            {(failed || unavailable) && (
              <div data-ui="news-reader-modal-div-16" className="absolute inset-0 flex flex-col items-center justify-center gap-4 bg-card px-6 text-center">
                <div data-ui="news-reader-modal-div-17" className="flex h-14 w-14 items-center justify-center rounded-2xl bg-destructive/10">
                  <IconAlertTriangle className="h-7 w-7 text-destructive" strokeWidth={1.75} />
                </div>
                <p data-ui="news-reader-modal-p-1" className="max-w-sm text-sm text-muted-foreground">{t("home.news.readerError")}</p>
                <div data-ui="news-reader-modal-div-18" className="flex items-center gap-2">
                  {!unavailable && (
                    <button data-ui="news-reader-modal-button-3"
                      type="button"
                      onClick={() => setReloadKey((k) => k + 1)}
                      className="flex items-center gap-1.5 rounded-xl bg-primary px-3.5 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                    >
                      <IconRefresh className="h-4 w-4" />
                      {t("common.retry")}
                    </button>
                  )}
                  <button data-ui="news-reader-modal-button-4"
                    type="button"
                    onClick={openInBrowser}
                    className="flex items-center gap-1.5 rounded-xl border border-border bg-muted/40 px-3.5 py-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                  >
                    <IconExternalLink className="h-4 w-4" />
                    {t("home.news.openInBrowser")}
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
