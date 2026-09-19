import { useTranslation } from "react-i18next"
import { IconDownload, IconPackage, IconAlertTriangle } from "@tabler/icons-react"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { SourceMark } from "@/components/launcher/source-mark"
import { cn } from "@/lib/utils"
import type { ModDependency, ModVersion } from "./instance/types"

interface DepConfirmDialogProps {
  open: boolean
  /** Имя мода, из-за которого открылось окно. */
  modName: string
  /** Иконка мода — показывается в шапке. */
  modIcon?: string
  /** Источник мода и его зависимостей — ими же ставятся все зависимости. */
  source: "modrinth" | "curseforge"
  /** План установки: зависимости и подобранные под сборку версии. */
  items: { dep: ModDependency; version?: ModVersion; pinned: boolean }[]
  /** Согласие: зависимости и мод ставятся вместе. */
  onConfirm: () => void
  /** Отказ: не ставим ничего. */
  onCancel: () => void
}

/**
 * Подтверждение установки зависимостей. Одно окно: говорим, что моду нужны
 * зависимости, показываем какие — по согласию окно закрывается, и установка
 * идёт дальше в основном списке модов (там виден прогресс). Выбирать нечего:
 * зависимости обязательные, без них мод не заработает.
 */
export function DepConfirmDialog({ open, modName, modIcon, source, items, onConfirm, onCancel }: DepConfirmDialogProps) {
  const { t } = useTranslation()

  /** Вторая строка: «Требуется Sodium от версии 0.8.7» или «Будет установлена версия …». */
  const versionLabel = (item: DepConfirmDialogProps["items"][number]) => {
    // Короткий номер версии, а не полное имя файла вроде «Sodium 0.8.7 for NeoForge 1.21.11».
    const version = item.version?.versionNumber || item.version?.name || item.version?.id
    if (!version) return null
    if (!item.pinned) return t("mods.install.willInstallVersion", { version })
    return t("mods.install.requiredVersion", {
      name: item.dep.name ?? item.dep.projectId,
      version,
    })
  }

  return (
    <Dialog open={open} onOpenChange={(value) => { if (!value) onCancel() }}>
      <DialogContent className="max-w-lg gap-0 overflow-hidden border-border bg-card p-0 shadow-2xl">
        <DialogHeader className="min-w-0 border-b border-border p-5">
          {/* pr-8 — чтобы текст не заезжал под встроенную кнопку закрытия */}
          <div className="flex items-center gap-2.5 pr-8">
            <div className="rounded-xl bg-primary/10 p-2 text-primary">
              <IconPackage className="h-5 w-5" strokeWidth={2} />
            </div>
            <div className="min-w-0">
              <DialogTitle className="text-lg font-bold text-foreground">
                {t("mods.install.title")}
              </DialogTitle>
              <DialogDescription className="mt-0.5 truncate text-xs text-muted-foreground">
                {t("mods.install.needed", { name: modName })}
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        <div className="flex min-w-0 items-center gap-2.5 border-b border-border/70 bg-muted/20 px-5 py-3">
          <div className="h-9 w-9 shrink-0 overflow-hidden rounded-lg bg-muted">
            {modIcon
              ? <img src={modIcon} alt="" className="h-full w-full object-cover" />
              : <div className="flex h-full w-full items-center justify-center"><IconPackage className="h-4 w-4 text-muted-foreground" /></div>}
          </div>
          <p className="min-w-0 flex-1 truncate text-sm font-semibold text-foreground">{modName}</p>
          <span className="shrink-0 rounded-md border border-border/60 bg-background/60 px-1.5 py-0.5 text-[11px] font-medium text-muted-foreground">
            {t("mods.install.depsCount", { count: items.length })}
          </span>
        </div>

        <div className="max-h-[45vh] min-w-0 space-y-2 overflow-y-auto overflow-x-hidden p-4">
          {items.map(item => {
            const { dep } = item
            const versionText = versionLabel(item)
            return (
              <div key={dep.projectId} className="flex items-center gap-3 rounded-xl border border-border/60 bg-muted/30 p-3">
                <div className="h-9 w-9 shrink-0 overflow-hidden rounded-lg bg-muted">
                  {dep.iconUrl
                    ? <img src={dep.iconUrl} alt="" className="h-full w-full object-cover" />
                    : <div className="flex h-full w-full items-center justify-center text-xs font-bold text-muted-foreground">{dep.name?.[0] ?? "?"}</div>}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex min-w-0 items-center gap-1.5">
                    <p className="min-w-0 truncate text-sm font-medium text-foreground">{dep.name ?? dep.projectId}</p>
                    <SourceMark source={source} />
                  </div>
                  <p className="mt-0.5 text-[11px] text-muted-foreground">{t("mods.install.required")}</p>
                  {versionText && (
                    /* Отдельной строкой: версия бывает длинной и раньше уезжала за край окна */
                    <p className={cn("mt-0.5 break-words text-[11px] leading-snug", item.pinned ? "text-primary" : "text-muted-foreground")}>
                      {versionText}
                    </p>
                  )}
                </div>
              </div>
            )
          })}
          {items.length === 0 && (
            <p className="py-6 text-center text-xs text-muted-foreground">{t("mods.install.noDeps", { name: modName })}</p>
          )}
        </div>

        <div className="flex min-w-0 flex-wrap items-center gap-2 border-t border-border bg-muted/5 px-4 py-4">
          <p className="mr-auto flex min-w-0 flex-1 items-center gap-1.5 text-[11px] text-muted-foreground">
            <IconAlertTriangle className="h-3.5 w-3.5 shrink-0 text-amber-500" strokeWidth={1.75} />
            {/* min-w-0 обязателен: с одним truncate подсказка не сжимается и выдавливает кнопки за край */}
            <span className="min-w-0 truncate">{t("mods.install.requiredHint")}</span>
          </p>
          <button type="button" onClick={onCancel}
            className="shrink-0 rounded-xl border border-border bg-muted/60 px-4 py-2.5 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground">
            {t("common.cancel")}
          </button>
          <button type="button" onClick={onConfirm}
            className="flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-xl bg-primary px-4 py-2.5 text-sm font-bold text-primary-foreground shadow-[0_0_15px_var(--glow-primary)] transition-all hover:bg-primary/90 active:scale-[0.98]">
            <IconDownload className="h-4 w-4" strokeWidth={1.75} />
            {t("mods.install.confirmAll", { count: items.length + 1 })}
          </button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
