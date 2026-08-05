import { memo, useEffect, useMemo, useRef, useState } from "react"
import { useTranslation } from "react-i18next"
import { IconPackage, IconX, IconPlus, IconPlayerPlay } from "@tabler/icons-react"
import { cn } from "@/lib/utils"
import { MOD_LOADERS } from "./constants"
import type { Build } from "./types"

interface InstanceListProps {
  builds: Build[]
  totalBuilds: number
  onCreate: () => void
  onDelete: (id: string) => void
  onOpen: (id: string) => void
  onPlay: (build: Build) => void
}

const CARD_MIN_WIDTH = 148
const GRID_GAP = 12
const CARD_HEIGHT = 220
const GRID_OVERSCAN_ROWS = 2

export const InstanceList = memo(function InstanceList({ builds, totalBuilds, onCreate, onDelete, onOpen, onPlay }: InstanceListProps) {
  const { t } = useTranslation()
  const scrollRef = useRef<HTMLDivElement>(null)
  const [viewport, setViewport] = useState({ width: 0, height: 0, scrollTop: 0 })

  useEffect(() => {
    const el = scrollRef.current
    if (!el) return

    const updateViewport = () => {
      setViewport(prev => {
        const next = { width: el.clientWidth, height: el.clientHeight, scrollTop: el.scrollTop }
        return prev.width === next.width && prev.height === next.height && prev.scrollTop === next.scrollTop ? prev : next
      })
    }

    updateViewport()
    const observer = new ResizeObserver(updateViewport)
    observer.observe(el)
    el.addEventListener("scroll", updateViewport, { passive: true })
    return () => {
      observer.disconnect()
      el.removeEventListener("scroll", updateViewport)
    }
  }, [])

  const virtualized = useMemo(() => {
    const columns = Math.max(1, Math.floor((Math.max(viewport.width, CARD_MIN_WIDTH) + GRID_GAP) / (CARD_MIN_WIDTH + GRID_GAP)))
    const rowHeight = CARD_HEIGHT + GRID_GAP
    const startRow = Math.max(0, Math.floor(viewport.scrollTop / rowHeight) - GRID_OVERSCAN_ROWS)
    const visibleRows = Math.ceil((viewport.height || rowHeight) / rowHeight) + GRID_OVERSCAN_ROWS * 2
    const endRow = Math.min(Math.ceil(builds.length / columns), startRow + visibleRows)
    return {
      columns,
      visibleBuilds: builds.slice(startRow * columns, endRow * columns),
      topSpacerHeight: startRow * rowHeight,
      bottomSpacerHeight: Math.max(0, (Math.ceil(builds.length / columns) - endRow) * rowHeight),
    }
  }, [builds, viewport.height, viewport.scrollTop, viewport.width])

  return (
    <div ref={scrollRef} className="flex-1 overflow-y-auto">
      {totalBuilds === 0 ? (
        <div className="h-full flex flex-col items-center justify-center text-center">
          <div className="w-20 h-20 rounded-2xl bg-muted/50 flex items-center justify-center mb-5">
            <IconPackage className="w-10 h-10 text-muted-foreground/40" />
          </div>
          <p className="text-base font-medium text-foreground">{t("builds.noBuilds")}</p>
          <p className="text-sm text-muted-foreground mt-1 mb-5">{t("builds.noBuildsDesc")}</p>
          <button type="button" onClick={onCreate} className="flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-medium bg-primary text-primary-foreground hover:bg-primary/90">
            <IconPlus className="w-4 h-4" strokeWidth={1.75} />
            {t("builds.createBuild")}
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(148px,1fr))] gap-3">
          {virtualized.topSpacerHeight > 0 && <div style={{ height: virtualized.topSpacerHeight, gridColumn: "1 / -1" }} />}
          {virtualized.visibleBuilds.map(build => {
            const loader = MOD_LOADERS.find(item => item.id === build.modLoader) ?? MOD_LOADERS[0]
            const hasImage = build.icon && (build.icon.startsWith("data:") || build.icon.startsWith("http"))
            return (
              <div
                key={build.id}
                className="group relative rounded-2xl border border-border bg-card overflow-hidden hover:border-primary/50 hover:shadow-[0_0_20px_var(--glow-primary)] transition-colors cursor-pointer"
                onClick={() => onOpen(build.id)}
              >
                <div className="relative w-full" style={{ paddingBottom: "100%" }}>
                  <div className="absolute inset-0">
                    {hasImage ? (
                      <img src={build.icon} alt="" className="w-full h-full object-cover" />
                    ) : (
                      <div className="w-full h-full bg-gradient-to-br from-primary/20 via-primary/10 to-accent/10 flex items-center justify-center">
                        <IconPackage className="w-10 h-10 text-primary/40" />
                      </div>
                    )}
                    <div className="absolute inset-0 flex items-center justify-center">
                      <button
                        type="button"
                        onClick={e => { e.stopPropagation(); onPlay(build) }}
                        className="w-12 h-12 rounded-full bg-primary/90 text-primary-foreground backdrop-blur-sm flex items-center justify-center shadow-lg shadow-black/30 hover:bg-primary hover:scale-105 active:scale-95 transition-all border border-white/20"
                        title={t("builds.play")}
                      >
                        <IconPlayerPlay className="w-5 h-5 ml-0.5 fill-current" />
                      </button>
                    </div>
                    <div className="absolute top-2 right-2 flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                      <button
                        type="button"
                        onClick={e => { e.stopPropagation(); onDelete(build.id) }}
                        className="w-6 h-6 rounded-lg bg-background/90 flex items-center justify-center hover:bg-destructive/80 hover:text-white text-muted-foreground"
                      >
                        <IconX className="w-3.5 h-3.5" />
                      </button>
                    </div>
                </div>
                {build.source === "modrinth" && (
                  <div className="absolute top-2 left-2 p-1 rounded-md bg-green-500/20">
                    <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24">
                      <path fill="#26a269" d="M12.252.004a11.78 11.768 0 0 0-8.92 3.73a11 11 0 0 0-2.17 3.11a11.37 11.359 0 0 0-1.16 5.169c0 1.42.17 2.5.6 3.77c.24.759.77 1.899 1.17 2.529a12.3 12.298 0 0 0 8.85 5.639c.44.05 2.54.07 2.76.02c.2-.04.22.1-.26-1.7l-.36-1.37l-1.01-.06a8.5 8.489 0 0 1-5.18-1.8a5.3 5.3 0 0 1-1.3-1.26c0-.05.34-.28.74-.5a37.572 37.545 0 0 1 2.88-1.629c.03 0 .5.45 1.06.98l1 .97l2.07-.43l2.06-.43l1.47-1.47c.8-.8 1.48-1.5 1.48-1.52c0-.09-.42-1.63-.46-1.7c-.04-.06-.2-.03-1.02.18c-.53.13-1.2.3-1.45.4l-.48.15l-.53.53l-.53.53l-.93.1l-.93.07l-.52-.5a2.7 2.7 0 0 1-.96-1.7l-.13-.6l.43-.57c.68-.9.68-.9 1.46-1.1c.4-.1.65-.2.83-.33c.13-.099.65-.579 1.14-1.069l.9-.9l-.7-.7l-.7-.7l-1.95.54c-1.07.3-1.96.53-1.97.53c-.03 0-2.23 2.48-2.63 2.97l-.29.35l.28 1.03c.16.56.3 1.16.31 1.34l.03.3l-.34.23c-.37.23-2.22 1.3-2.84 1.63-.36.2-.37.2-.44.1c-.08-.1-.23-.6-.32-1.03c-.18-.86-.17-2.75.02-3.73a8.84 8.84 0 0 1 7.9-6.93c.43-.03.77-.08.78-.1c.06-.17.5-2.999.47-3.039c-.01-.02-.1-.02-.2-.03Zm3.68.67c-.2 0-.3.1-.37.38c-.06.23-.46 2.42-.46 2.52c0 .04.1.11.22.16a8.51 8.499 0 0 1 2.99 2a8.38 8.379 0 0 1 2.16 3.449a6.9 6.9 0 0 1 .4 2.8c0 1.07 0 1.27-.1 1.73a9.4 9.4 0 0 1-1.76 3.769c-.32.4-.98 1.06-1.37 1.38c-.38.32-1.54 1.1-1.7 1.14c-.1.03-.1.06-.07.26c.03.18.64 2.56.7 2.78l.06.06a12.07 12.058 0 0 0 7.27-9.4c.13-.77.13-2.58 0-3.4a11.96 11.948 0 0 0-5.73-8.578c-.7-.42-2.05-1.06-2.25-1.06Z"/>
                    </svg>
                  </div>
                )}
                {build.source === "curseforge" && (
                  <div className="absolute top-2 left-2 p-1 rounded-md bg-orange-500/20">
                    <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24">
                      <path fill="#e66100" d="M18.326 9.215s4.9-.773 5.674-3.027h-7.507V4.4H0l2.032 2.358v2.415s5.127-.266 7.11 1.237c2.714 2.516-3.053 5.917-3.053 5.917l-.99 3.273c1.547-1.473 4.494-3.377 9.899-3.286c-2.057.65-4.125 1.665-5.735 3.286h10.925l-1.029-3.273s-7.918-4.668-.833-7.112"/>
                    </svg>
                  </div>
                )}
              </div>
              <div className="px-3 py-2.5 bg-card border-t border-border/50">
                  <p className="text-sm font-semibold text-foreground truncate leading-tight">{build.name}</p>
                  <div className="flex items-center gap-1.5 mt-1">
                    <span className={cn("w-1.5 h-1.5 rounded-full flex-shrink-0", loader.dot)} />
                    <span className="text-[11px] text-muted-foreground truncate">{loader.name} · {build.version}</span>
                  </div>
                </div>
              </div>
            )
          })}
          {virtualized.bottomSpacerHeight > 0 && <div style={{ height: virtualized.bottomSpacerHeight, gridColumn: "1 / -1" }} />}
        </div>
      )}
    </div>
  )
})
