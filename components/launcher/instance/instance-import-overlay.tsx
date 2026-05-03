import { IconLoader2 } from "@tabler/icons-react"

interface InstanceImportOverlayProps {
  importProgress: { current: number; total: number; message: string } | null
  importError: string | null
}

export function InstanceImportOverlay({ importProgress, importError }: InstanceImportOverlayProps) {
  if (!importProgress) return null
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
      <div className="bg-card border border-border rounded-2xl p-6 w-80 text-center shadow-xl">
        <IconLoader2 className="w-8 h-8 animate-spin text-primary mx-auto mb-3" />
        <p className="text-sm font-medium text-foreground mb-1">Импорт модпака</p>
        {importProgress.total > 0 && (
          <div className="mb-2 w-full h-1.5 bg-muted rounded-full overflow-hidden">
            <div className="h-full bg-primary transition-all" style={{ width: `${Math.round((importProgress.current / importProgress.total) * 100)}%` }} />
          </div>
        )}
        <p className="text-xs text-muted-foreground">{importProgress.message}</p>
        {importError && <p className="text-xs text-destructive mt-2">{importError}</p>}
      </div>
    </div>
  )
}
