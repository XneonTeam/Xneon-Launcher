import { useEffect, useState } from "react"
import type { Theme } from "./settings/types"
import { cssBackgroundVideo, useAppliedTheme, useMediaPaused } from "./settings/theme-runtime"
import { ThemeParticles } from "./settings/theme-particles"
import { useRef } from "react"
import { resolveTheme } from "./settings/theme-model"

/**
 * Фон лаунчера из темы: картинка или видео, с затемнением, размытием
 * и прозрачностью. Живёт отдельным слоем за контентом, поэтому не мешает кликам
 * и не влияет на прокрутку — `body` в это время прозрачный
 * (см. `html.theme-with-background` в `src/index.css`).
 */

/** Локальный файл нельзя показать напрямую (dev крутится на http), поэтому читаем через main. */
async function resolveSource(source: string): Promise<string | null> {
  const target = source.trim()
  if (!target) return null
  if (target.startsWith("data:") || target.startsWith("xnl-theme:") || /^https?:\/\//i.test(target)) return target
  return (await window.electronAPI?.readThemeMedia(target)) ?? null
}

export function ThemeBackgroundLayer({ theme: initial }: { theme: Theme }) {
  const theme = resolveTheme(useAppliedTheme(initial))
  const video = useRef<HTMLVideoElement>(null)
  const paused = useMediaPaused()
  const override = cssBackgroundVideo(theme)
  const kind = override ? "video" : theme.background?.kind ?? "image"
  const source = kind === "particles" || kind === "halo" ? "" : override || theme.background?.source || ""
  const mediaKey = `${kind}:${source}`
  const [media, setMedia] = useState<{ key: string; resolved: string | null; failed: boolean } | null>(null)
  const resolved = media?.key === mediaKey ? media.resolved : null
  const failed = media?.key === mediaKey && media.failed
  const failMedia = () => setMedia(current => current?.key === mediaKey ? { ...current, failed: true } : current)

  useEffect(() => {
    let cancelled = false
    if (!source) {
      setMedia(null)
      return
    }
    void resolveSource(source).then((result) => {
      if (cancelled) return
      setMedia({ key: mediaKey, resolved: result, failed: !result })
    }).catch(() => { if (!cancelled) setMedia({ key: mediaKey, resolved: null, failed: true }) })
    return () => {
      cancelled = true
    }
  }, [source, mediaKey])

  useEffect(() => {
    const player = video.current
    if (!player) return
    player.volume = theme.background?.volume ?? 0
    if (paused) player.pause()
    else void player.play().catch(() => {})
  }, [paused, resolved, mediaKey, theme.background?.volume])

  const animated = kind === "particles" || kind === "halo"
  if (!animated && (!source || failed || !resolved)) return null

  return (
    <div data-ui="theme-background-layer-div-1" data-component="theme-background-layer" id="theme-background" className="pointer-events-none fixed inset-0 -z-20 overflow-hidden" aria-hidden="true">
      <div data-ui="theme-background-layer-div-2"
        className="absolute inset-0"
        style={{ opacity: "var(--theme-bg-opacity, 1)", filter: "blur(var(--theme-bg-blur, 0px))" }}
      >
        {kind === "particles" ? (
          <ThemeParticles color={theme.primary} style={theme.background?.particleStyle ?? "stars"} paused={paused} />
        ) : kind === "halo" ? (
          <div data-ui="theme-halo" data-component="theme-halo" className="theme-halo h-full w-full" style={{ animationPlayState: paused ? "paused" : "running", background: `radial-gradient(ellipse at 20% 30%, ${theme.primary}55, transparent 60%), radial-gradient(ellipse at 80% 70%, ${theme.accent}55, transparent 60%)` }} />
        ) : kind === "video" ? (
          <video data-ui="theme-background-layer-video-1"
            key={mediaKey}
            className="h-full w-full object-cover"
            ref={video}
            style={{ objectFit: theme.background?.fit ?? "cover" }}
            src={resolved ?? undefined}
            autoPlay={!paused}
            loop
            muted={(theme.background?.volume ?? 0) === 0}
            playsInline
            onPlay={event => { if (paused) event.currentTarget.pause() }}
            onError={failMedia}
          />
        ) : (
          <img key={mediaKey} style={{ objectFit: theme.background?.fit ?? "cover" }} data-ui="theme-background-layer-img-1" className="h-full w-full object-cover" src={resolved ?? undefined} alt="" onError={failMedia} />
        )}
      </div>
      <div data-ui="theme-background-layer-div-3" className="absolute inset-0" style={{ background: "rgba(0, 0, 0, var(--theme-bg-dim, 0))" }} />
    </div>
  )
}
