import { useState } from "react"
import { createPortal } from "react-dom"
import { useTranslation } from "react-i18next"
import {
  IconTerminal2, IconPlayerPlay, IconPlayerStop, IconFolder, IconCopy,
  IconDownload, IconTrash, IconMap, IconPuzzle,
  IconPlug, IconSettings, IconBug, IconCategoryPlus,
} from "@tabler/icons-react"
import { FloatingContextMenu } from "@/components/ui/floating-context-menu"
import { ExportCategoriesDialog } from "../export-categories-dialog"
import { InstanceExportModal } from "../instance/instance-export-modal"
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
  const EXPORT_CATEGORIES: Array<{ id: ServerExportCategory; label: string; description: string; icon: React.ReactNode }> = [
    { id: "world", label: t("servers.export.world"), description: t("servers.export.worldDesc"), icon: <IconMap className="h-5 w-5 text-muted-foreground" strokeWidth={1.75} /> },
    { id: "mods", label: t("servers.export.mods"), description: t("servers.export.modsDesc"), icon: <IconPuzzle className="h-5 w-5 text-muted-foreground" strokeWidth={1.75} /> },
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
    setExportDialogFor(false)
    setExporting(true)
    try {
      const result = await window.electrobunAPI?.mcServerExportZip(server.id, server.name, Array.from(exportCategories))
      if (result && !result.success && result.error) console.warn("[Серверы] Экспорт zip не удался:", result.error)
    } finally {
      setExporting(false)
      onClose()
    }
  }

  return createPortal(
    <>
      {/* Пока открыт экспорт, outside-mousedown меню не должен размонтировать весь компонент. */}
      {!exportDialogFor && !exporting && <FloatingContextMenu position={position} onClose={onClose}>
        <button data-ui="server-server-context-menu-button-1" type="button" className="flex items-center gap-2 w-full px-3 py-2 text-sm rounded-lg hover:bg-muted text-foreground"
          onClick={() => { onConnect(); onClose() }}>
          <IconTerminal2 className="w-4 h-4 text-muted-foreground" />
          {t("servers.contextConnect")}
        </button>
        <button data-ui="server-server-context-menu-button-2" type="button" disabled={isBusy || !!server.remote && !(isRunning ? server.remote.permissions.stop : server.remote.permissions.start)}
          className="flex items-center gap-2 w-full px-3 py-2 text-sm rounded-lg hover:bg-muted text-foreground disabled:opacity-40"
          onClick={() => { onToggleRun(); onClose() }}>
          {isRunning ? <IconPlayerStop className="w-4 h-4 text-muted-foreground" /> : <IconPlayerPlay className="w-4 h-4 text-muted-foreground" />}
          {isRunning ? t("servers.contextStop") : t("servers.contextStart")}
        </button>
        {!server.remote && <><button data-ui="server-server-context-menu-button-3" type="button" className="flex items-center gap-2 w-full px-3 py-2 text-sm rounded-lg hover:bg-muted text-foreground"
          onClick={() => { window.electrobunAPI?.mcServerOpenFolder(server.id); onClose() }}>
          <IconFolder className="w-4 h-4 text-muted-foreground" />
          {t("servers.contextOpenFolder")}
        </button>
        <button data-ui="server-server-context-menu-button-4" type="button" disabled={duplicating}
          className="flex items-center gap-2 w-full px-3 py-2 text-sm rounded-lg hover:bg-muted text-foreground disabled:opacity-40"
          onClick={() => { void handleDuplicate() }}>
          <IconCopy className="w-4 h-4 text-muted-foreground" />
          {t("servers.contextDuplicate")}
        </button>
        <button data-ui="server-server-context-menu-button-5" type="button"
          className="flex items-center gap-2 w-full px-3 py-2 text-sm rounded-lg hover:bg-muted text-foreground"
          onClick={() => { setExportCategories(new Set(["world", "mods", "plugins", "configs"])); setExportDialogFor(true) }}>
          <IconDownload className="w-4 h-4 text-muted-foreground" />
          {t("servers.contextExportZip")}
        </button>
        </>}
        {!server.remote && onOpenAssignGroup && (
          <button data-ui="server-server-context-menu-button-6" type="button"
            className="flex items-center gap-2 w-full px-3 py-2 text-sm rounded-lg hover:bg-muted text-foreground"
            onClick={() => { onOpenAssignGroup(position.x + 8, position.y + 8); onClose() }}>
            <IconCategoryPlus className="w-4 h-4 text-muted-foreground" />
            {t("categoryMenu.title")}
          </button>
        )}
        <div data-ui="server-server-context-menu-div-2" className="mx-2 my-1 border-t border-border" />
        <button data-ui="server-server-context-menu-button-7" type="button" className="flex items-center gap-2 w-full px-3 py-2 text-sm rounded-lg hover:bg-destructive/15 text-destructive"
          onClick={() => { onDelete(); onClose() }}>
          <IconTrash className="w-4 h-4" strokeWidth={1.75} />
          {t(server.remote ? "remoteServer.leave" : "servers.contextDelete")}
        </button>
      </FloatingContextMenu>}

      {exportDialogFor && !exporting && (
        <ExportCategoriesDialog
          windowId="server-export-categories"
          title={t("instanceList.exportZip")}
          description={t("servers.export.desc", { name: server.name })}
          categories={EXPORT_CATEGORIES}
          selected={exportCategories}
          onSelectedChange={setExportCategories}
          onClose={onClose}
          onExport={() => { void handleExportZip() }}
          selectAllLabel={t("instanceList.selectAll")}
          cancelLabel={t("common.cancel")}
          exportLabel={t("instanceList.export")}
        />
      )}
      {exporting && <InstanceExportModal buildName={server.name} current={null} total={null} />}
    </>, document.body
  )
}
