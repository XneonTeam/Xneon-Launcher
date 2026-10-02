import { useCallback, useRef, useState } from "react"
import { useTranslation } from "react-i18next"
import { IconAlertTriangle, IconExternalLink, IconLoader2, IconNews, IconRefresh, IconX } from "@tabler/icons-react"
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog"
import { formatDate, type NewsEntry } from "@/lib/home-page-shared"
import type { ElectronWebviewElement } from "@/src/webview"

/**
 * Читалка новостей: статья открывается модалом прямо в окне лаунчера (`<webview>`),
 * а не отдельным окном и не системным браузером. Требует `webviewTag: true`
 * в webPreferences главного окна (см. `electron/main/window.ts`).
 */

// Сайтовая обвязка (шапка, футер, баннеры согласия) только мешает чтению статьи.
const READER_CSS = `
  header, footer, nav, [role="banner"], [role="contentinfo"],
  .global-header, .global-footer, #onetrust-consent-sdk, .msccBanner,
  #wcpConsentBannerCtrl, [class*="cookie-banner"], [id*="cookie-banner"] {
    display: none !important;
  }
`

// `target="_blank"` уводил бы ссылку в новое окно Chromium, а всплывающие окна
// в читалке запрещены — поэтому ссылки внутри статьи ведём в ней же.
const INLINE_LINKS_JS = `(() => {
  const strip = (root) => {
    if (!root || !root.querySelectorAll) return
    root.querySelectorAll('a[target]').forEach((a) => a.removeAttribute('target'))
  }
  strip(document)
  const observer = new MutationObserver(() => strip(document))
  observer.observe(document.documentElement, { childList: true, subtree: true })
})()`

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
  return `${READER_CSS}
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

interface NewsReaderModalProps {
  /** Новость для чтения; `null` — модал закрыт. */
  entry: NewsEntry | null
  onClose: () => void
}

/** Период опроса гостя, мс. */
const PROBE_INTERVAL = 250
/** Сколько опросов ждём до принудительного вердикта (~15 с). */
const PROBE_ATTEMPTS = 60

export function NewsReaderModal({ entry, onClose }: NewsReaderModalProps) {
  const { t } = useTranslation()
  const [loading, setLoading] = useState(true)
  const [failed, setFailed] = useState(false)
  /** Пересоздание `<webview>` по кнопке «Повторить»: смена `key` = чистый повторный заход. */
  const [reloadKey, setReloadKey] = useState(0)
  const detachRef = useRef<(() => void) | null>(null)

  const url = entry?.readMoreLink ?? null
  /** Рубрика — та же связка, что и на карточке: tag → category → первый newsType. */
  const tag = entry?.tag ?? entry?.category ?? entry?.newsType?.[0]

  const openInBrowser = useCallback(() => {
    if (url) void window.electronAPI?.openExternal(url)
  }, [url])

  /**
   * Подписка на события гостя — через callback-ref, а не через эффект.
   *
   * `<webview>` появляется не в том коммите, в котором открылся модал: `DialogContent`
   * рендерит содержимое в портал, а Radix создаёт контейнер портала отдельным рендером
   * (`Portal` резолвит его в состоянии). Эффект с зависимостью `[entry]` успевал
   * отработать ещё до появления элемента (ref был `null`), а при появлении элемента
   * его зависимости не менялись — слушатели не навешивались вообще никогда. Отсюда и
   * «вечная загрузка», и то, что стили статьи (скрытие шапки, скроллбар) не применялись.
   *
   * Callback-ref вызывается ровно в момент появления узла, поэтому ни одно событие
   * гостя пропустить уже нельзя.
   */
  const attachWebview = useCallback((node: HTMLElement | null) => {
    detachRef.current?.()
    detachRef.current = null
    if (!node) return
    const el = node as ElectronWebviewElement

    setLoading(true)
    setFailed(false)

    // Признак того, что основной фрейм статьи уже отдан. После этого события
    // загрузки от посторонних подфреймов (аналитика, баннеры, «живые» рекламные
    // iframe'ы на сайте) не должны снова включать оверлей.
    let mainFrameDone = false
    let injectedKey: string | null = null
    let linksApplied = false

    const markLoaded = () => {
      mainFrameDone = true
      setLoading(false)
      setFailed(false)
    }

    // Chromium сбрасывает внедрённые стили при навигации, поэтому после каждой
    // загрузки основного фрейма впрыскиваем их заново.
    const applyOverrides = () => {
      if (injectedKey === null) {
        void el.insertCSS(buildReaderCss()).then((key) => { injectedKey = key }).catch(() => {})
      }
      if (!linksApplied) {
        linksApplied = true
        void el.executeJavaScript(INLINE_LINKS_JS).catch(() => { linksApplied = false })
      }
    }

    const handleDomReady = () => {
      markLoaded()
      applyOverrides()
    }
    const handleStart = () => {
      injectedKey = null
      linksApplied = false
      if (mainFrameDone) return
      setLoading(true)
    }
    const handleFinish = () => {
      markLoaded()
      applyOverrides()
    }
    const handleStop = () => {
      if (mainFrameDone) return
      setLoading(false)
    }
    const handleFail = (event: Event) => {
      const detail = event as Event & { errorCode?: number; isMainFrame?: boolean }
      // -3 (ERR_ABORTED) — обычное прерывание при редиректах, это не ошибка.
      if (detail.isMainFrame === false || detail.errorCode === -3) return
      setLoading(false)
      setFailed(true)
    }

    el.addEventListener("dom-ready", handleDomReady)
    el.addEventListener("did-start-loading", handleStart)
    el.addEventListener("did-finish-load", handleFinish)
    el.addEventListener("did-stop-loading", handleStop)
    el.addEventListener("did-fail-load", handleFail)

    // Источник истины — состояние самого гостя, а не только события: если
    // какое-то из них всё же потерялось (или страница держит фоновую догрузку
    // подфрейма), оверлей не должен висеть вечно.
    let attempts = 0
    const probe = window.setInterval(() => {
      attempts += 1
      // `<webview>` без webviewTag в main-процессе остаётся обычным тегом:
      // методов Electron у него нет — показываем это явно, а не спиннер навечно.
      if (typeof el.insertCSS !== "function") {
        window.clearInterval(probe)
        setLoading(false)
        setFailed(true)
        return
      }

      if (mainFrameDone) {
        window.clearInterval(probe)
        applyOverrides()
        return
      }

      let guestDone = false
      try {
        // До `dom-ready` методы гостя бросают — не долбим их в первые полсекунды.
        guestDone = attempts >= 2 && typeof el.isLoading === "function" && el.isLoading() === false && !!el.getURL()
      } catch {
        guestDone = false
      }

      if (guestDone) {
        window.clearInterval(probe)
        markLoaded()
        applyOverrides()
        return
      }

      // `isLoading()` может быть недоступен (или его держит фоновая догрузка
      // подфрейма) — по истечении таймаута доверяем факту загруженного URL,
      // иначе модал залипнет на спиннере поверх готовой статьи.
      if (attempts >= PROBE_ATTEMPTS) {
        window.clearInterval(probe)
        let loadedUrl = ""
        try {
          loadedUrl = el.getURL()
        } catch {
          loadedUrl = ""
        }
        if (loadedUrl) {
          markLoaded()
          applyOverrides()
        } else {
          setLoading(false)
          setFailed(true)
        }
      }
    }, PROBE_INTERVAL)

    detachRef.current = () => {
      window.clearInterval(probe)
      el.removeEventListener("dom-ready", handleDomReady)
      el.removeEventListener("did-start-loading", handleStart)
      el.removeEventListener("did-finish-load", handleFinish)
      el.removeEventListener("did-stop-loading", handleStop)
      el.removeEventListener("did-fail-load", handleFail)
    }
  }, [])

  return (
    <Dialog open={!!entry} onOpenChange={(open) => { if (!open) onClose() }}>
      <DialogContent
        showCloseButton={false}
        className="flex h-[min(88vh,880px)] w-[min(1180px,calc(100vw-3rem))] max-w-none flex-col gap-0 overflow-hidden rounded-2xl border-border bg-card p-0 shadow-2xl"
      >
        {/* Мачта читалки: та же связка «чип + рубрика», что и в шапке раздела новостей,
            чтобы модал читался как часть лаунчера, а не как чужое окно. */}
        <header className="flex flex-shrink-0 items-start gap-3 border-b border-border bg-muted/20 px-4 py-3.5">
          <div className="mt-0.5 flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg bg-primary/20">
            <IconNews className="h-4 w-4 text-primary" strokeWidth={2} />
          </div>

          <div className="min-w-0 flex-1">
            {tag && (
              <span className="mb-1 inline-block rounded-md bg-primary/15 px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-primary">
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

          <div className="flex flex-shrink-0 items-center gap-2">
            <button
              type="button"
              onClick={openInBrowser}
              className="flex h-8 items-center gap-1.5 rounded-lg border border-border bg-muted/40 px-2.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
            >
              <IconExternalLink className="h-3.5 w-3.5" />
              <span className="hidden md:inline">{t("home.news.openInBrowser")}</span>
            </button>

            <DialogClose asChild>
              <button
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
        <div className="min-h-0 flex-1 p-3">
          <div className="relative h-full w-full overflow-hidden rounded-xl border border-border bg-muted/30">
            {url && (
              <webview
                key={`${url}:${reloadKey}`}
                ref={attachWebview}
                src={url}
                partition="persist:xneon-news"
                className="absolute inset-0 h-full w-full"
              />
            )}

            {loading && !failed && (
              <div className="pointer-events-none absolute inset-0 flex flex-col gap-4 bg-card/95 p-8">
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <IconLoader2 className="h-3.5 w-3.5 animate-spin text-primary motion-reduce:animate-none" />
                  {t("home.news.readerLoading")}
                </div>
                {/* Скелетон в том же языке, что и у карточек новостей: пустое серое
                    поле со спиннером посредине читалось как «сломалось». */}
                <div className="animate-pulse motion-reduce:animate-none">
                  <div className="h-5 w-2/3 rounded bg-muted/70" />
                  <div className="mt-3 h-3 w-full rounded bg-muted/50" />
                  <div className="mt-2 h-3 w-11/12 rounded bg-muted/50" />
                  <div className="mt-2 h-3 w-4/5 rounded bg-muted/50" />
                  <div className="mt-7 h-3 w-full rounded bg-muted/40" />
                  <div className="mt-2 h-3 w-10/12 rounded bg-muted/40" />
                  <div className="mt-2 h-3 w-9/12 rounded bg-muted/40" />
                </div>
              </div>
            )}

            {failed && (
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 bg-card px-6 text-center">
                <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-destructive/10">
                  <IconAlertTriangle className="h-7 w-7 text-destructive" strokeWidth={1.75} />
                </div>
                <p className="max-w-sm text-sm text-muted-foreground">{t("home.news.readerError")}</p>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setReloadKey((k) => k + 1)}
                    className="flex items-center gap-1.5 rounded-xl bg-primary px-3.5 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                  >
                    <IconRefresh className="h-4 w-4" />
                    {t("common.retry")}
                  </button>
                  <button
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
