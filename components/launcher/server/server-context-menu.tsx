import { useEffect, useRef, useState } from "react"
import { useTranslation } from "react-i18next"
import {
  IconTerminal, IconPlayerPlay, IconPlayerStop, IconFolder, IconCopy,
  IconDownload, IconTrashFilled, IconX, IconWorldUpload, IconBox,
  IconPlug, IconSettings, IconBug, IconCategoryPlus,
} from "@tabler/icons-react"
import { Checkbox } from "@/components/ui/checkbox"
import type { McServerInfo } from "@xnlc/types"

interface ServerContextMenuProps {
  server: McServerInfo
  position: { x: number; y: number }
  isRunning: boolean
  isBusy: boolean
  onConnect: () => void
  onToggleRun: () => void
  onDelete: () => void
  onDuplicate: () => void
  onClose: () => void
  /** Открывает меню выбора категории для сервера в указанной точке экрана. */
  onOpenAssignGroup?: (x: number, y: number) => void
}

// Same category keys as the export handler in mc-server-handlers.ts
type ServerExportCategory = "world" | "mods" | "plugins" | "configs" | "logs"

// Context menu shown on right-click over a server tile/row.
// Mirrors the instance list context menu (open folder / duplicate / export
// to zip / move to trash) with the server-specific run and connect actions.
export function ServerContextMenu({ server, position, isRunning, isBusy, onConnect, onToggleRun, onDelete, onDuplicate, onClose, onOpenAssignGroup }: ServerContextMenuProps) {
  const { t } = useTranslation()
  const [exporting, setExporting] = useState(false)
  const [duplicating, setDuplicating] = useState(false)
  const [exportDialogFor, setExportDialogFor] = useState(false)
  const [exportCategories, setExportCategories] = useState<Set<ServerExportCategory>>(() => new Set(["world", "mods", "plugins", "configs"]))
  const menuRef = useRef<HTMLDivElement>(null)

  // Close when clicking / right-clicking anywhere outside the menu or on
  // Escape — otherwise a second right-click on another server opens a second
  // menu while the first one stays on screen.
  useEffect(() => {
    const outside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) onClose()
    }
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose()
    }
    document.addEventListener("mousedown", outside)
    document.addEventListener("contextmenu", outside)
    document.addEventListener("keydown", key)
    return () => {
      document.removeEventListener("mousedown", outside)
      document.removeEventListener("contextmenu", outside)
      document.removeEventListener("keydown", key)
    }
  }, [onClose])

  const EXPORT_CATEGORIES: Array<{ id: ServerExportCategory; label: string; description: string; icon: React.ReactNode }> = [
    { id: "world", label: t("servers.export.world"), description: t("servers.export.worldDesc"), icon: <IconWorldUpload className="h-5 w-5 text-muted-foreground" strokeWidth={1.75} /> },
    { id: "mods", label: t("servers.export.mods"), description: t("servers.export.modsDesc"), icon: <IconBox className="h-5 w-5 text-muted-foreground" strokeWidth={1.75} /> },
    { id: "plugins", label: t("servers.export.plugins"), description: t("servers.export.pluginsDesc"), icon: <IconPlug className="h-5 w-5 text-muted-foreground" strokeWidth={1.75} /> },
    { id: "configs", label: t("servers.export.configs"), description: t("servers.export.configsDesc"), icon: <IconSettings className="h-5 w-5 text-muted-foreground" strokeWidth={1.75} /> },
    { id: "logs", label: t("servers.export.logs"), description: t("servers.export.logsDesc"), icon: <IconBug className="h-5 w-5 text-muted-foreground" strokeWidth={1.75} /> },
  ]

  const handleDuplicate = async () => {
    if (duplicating) return
    setDuplicating(true)
    try {
      onDuplicate()
    } finally {
      setDuplicating(false)
      onClose()
    }
  }

  const handleExportZip = async () => {
    if (exporting) return
    setExporting(true)
    try {
      await window.electronAPI?.mcServerExportZip(server.id, server.name, Array.from(exportCategories))
    } finally {
      setExporting(false)
      setExportDialogFor(false)
    }
  }

  return (
    <>
      <div
        ref={menuRef}
        className="fixed z-50 min-w-[180px] rounded-xl border border-border bg-card shadow-2xl p-1 animate-in fade-in-0 zoom-in-95 duration-150"
        style={{ top: position.y, left: position.x }}
        onClick={e => e.stopPropagation()}
        onContextMenu={e => e.preventDefault()}
      >
        <button type="button" className="flex items-center gap-2 w-full px-3 py-2 text-sm rounded-lg hover:bg-muted text-foreground"
          onClick={() => { onConnect(); onClose() }}>
          <IconTerminal className="w-4 h-4 text-muted-foreground" />
          {t("servers.contextConnect")}
        </button>
        <button type="button" disabled={isBusy}
          className="flex items-center gap-2 w-full px-3 py-2 text-sm rounded-lg hover:bg-muted text-foreground disabled:opacity-40"
          onClick={() => { onToggleRun(); onClose() }}>
          {isRunning ? <IconPlayerStop className="w-4 h-4 text-muted-foreground" /> : <IconPlayerPlay className="w-4 h-4 text-muted-foreground" />}
          {isRunning ? t("servers.contextStop") : t("servers.contextStart")}
        </button>
        <button type="button" className="flex items-center gap-2 w-full px-3 py-2 text-sm rounded-lg hover:bg-muted text-foreground"
          onClick={() => { window.electronAPI?.mcServerOpenFolder(server.id); onClose() }}>
          <IconFolder className="w-4 h-4 text-muted-foreground" />
          {t("servers.contextOpenFolder")}
        </button>
        <button type="button" disabled={duplicating}
          className="flex items-center gap-2 w-full px-3 py-2 text-sm rounded-lg hover:bg-muted text-foreground disabled:opacity-40"
          onClick={() => { void handleDuplicate() }}>
          <IconCopy className="w-4 h-4 text-muted-foreground" />
          {t("servers.contextDuplicate")}
        </button>
        <button type="button"
          className="flex items-center gap-2 w-full px-3 py-2 text-sm rounded-lg hover:bg-muted text-foreground"
          onClick={() => setExportDialogFor(true)}>
          <IconDownload className="w-4 h-4 text-muted-foreground" />
          {t("servers.contextExportZip")}
        </button>
        {onOpenAssignGroup && (
          <button type="button"
            className="flex items-center gap-2 w-full px-3 py-2 text-sm rounded-lg hover:bg-muted text-foreground"
            onClick={() => { onOpenAssignGroup(position.x + 8, position.y + 8); onClose() }}>
            <IconCategoryPlus className="w-4 h-4 text-muted-foreground" />
            {t("servers.moveToGroup", "Переместить в категорию")}
          </button>
        )}
        <div className="mx-2 my-1 border-t border-border" />
        <button type="button" className="flex items-center gap-2 w-full px-3 py-2 text-sm rounded-lg hover:bg-destructive/15 text-destructive"
          onClick={() => { onDelete(); onClose() }}>
          <IconTrashFilled className="w-4 h-4" />
          {t("servers.contextDelete")}
        </button>
      </div>

      {/* Export dialog — same layout as the instance export dialog */}
      {exportDialogFor && (
        <div className="fixed inset-0 z-[60] bg-background/60 backdrop-blur-sm flex items-center justify-center animate-in fade-in-0"
          onClick={() => setExportDialogFor(false)}>
          <div className="w-[420px] rounded-2xl border border-border bg-card p-5 shadow-2xl animate-in zoom-in-95" onClick={e => e.stopPropagation()}>
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-base font-semibold text-foreground">{t("servers.export.title")}</p>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  {t("servers.export.desc", { name: server.name })}
                </p>
              </div>
              <button type="button" onClick={() => setExportDialogFor(false)} className="p-1 rounded-md hover:bg-muted text-muted-foreground">
                <IconX className="w-4 h-4" />
              </button>
            </div>

            <div className="mt-4 space-y-2">
              {EXPORT_CATEGORIES.map(cat => (
                <label key={cat.id} className="flex items-start gap-3 rounded-xl border border-border bg-muted/30 px-3 py-2.5 cursor-pointer transition-colors hover:border-primary/40">
                  <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center">{cat.icon}</span>
                  <Checkbox
                    checked={exportCategories.has(cat.id)}
                    onCheckedChange={(checked) => {
                      setExportCategories(prev => {
                        const next = new Set(prev)
                        if (checked) next.add(cat.id)
                        else next.delete(cat.id)
                        return next
                      })
                    }}
                    className="mt-0.5"
                  />
                  <span className="min-w-0">
                    <span className="block text-sm font-medium text-foreground">{cat.label}</span>
                    <span className="block text-xs text-muted-foreground">{cat.description}</span>
                  </span>
                </label>
              ))}
            </div>

            <div className="mt-5 flex items-center justify-between gap-2">
              <button type="button" onClick={() => setExportCategories(new Set(EXPORT_CATEGORIES.map(c => c.id)))}
                className="px-3 py-1.5 rounded-lg text-xs font-medium text-muted-foreground hover:text-foreground hover:bg-muted">
                {t("servers.export.selectAll")}
              </button>
              <div className="flex gap-2">
                <button type="button" onClick={() => setExportDialogFor(false)}
                  className="px-4 py-2 rounded-xl text-sm font-medium hover:bg-muted text-muted-foreground">
                  {t("servers.cancel")}
                </button>
                <button type="button" disabled={exportCategories.size === 0 || exporting}
                  onClick={() => { void handleExportZip() }}
                  className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed">
                  <IconDownload className={exporting ? "w-4 h-4 animate-pulse" : "w-4 h-4"} />
                  {t("servers.export.action")}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
