import { useTranslation } from "react-i18next"
import { IconPackage, IconStack2, IconTrash } from "@tabler/icons-react"
import { cn } from "@/lib/utils"
import { InstanceCreateDialog } from "./instance-create-dialog"
import type { ViewMode } from "./types"

interface InstanceHeaderProps {
  view: ViewMode
  setView: (v: ViewMode) => void
  createOpen: boolean
  setCreateOpen: (v: boolean) => void
  onCreate: (params: { name: string; description: string; version: string; modLoader: string; loaderVersion?: string; icon: string }) => Promise<void>
  onImported: () => Promise<void>
  onImportFile: () => Promise<void>
}

export function InstanceHeader({ view, setView, createOpen, setCreateOpen, onCreate, onImported, onImportFile }: InstanceHeaderProps) {
  const { t } = useTranslation()
  return (
    <div className="flex items-center justify-between gap-4 mb-6">
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-xl bg-primary/20 flex items-center justify-center">
          <IconPackage className="w-5 h-5 text-primary" />
        </div>
        <div>
          <h1 className="text-xl font-bold text-foreground">{t("builds.title")}</h1>
          <p className="text-sm text-muted-foreground">{t("builds.subtitle")}</p>
        </div>
      </div>

      <div className="flex items-center gap-2">
        <button key="my" type="button" onClick={() => setView("my")}
          className={cn("flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all",
            view === "my" ? "bg-primary/20 text-primary" : "bg-muted/50 text-muted-foreground hover:bg-muted hover:text-foreground")}>
          <IconStack2 className="w-3.5 h-3.5" strokeWidth={1.75} />
          {t("builds.myBuilds")}
        </button>
        <button key="trash" type="button" onClick={() => setView("trash")}
          className={cn("flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors",
            view === "trash" ? "bg-red-500/20 text-red-400" : "bg-muted/50 text-muted-foreground hover:bg-muted hover:text-foreground")}>
          <IconTrash className="w-3.5 h-3.5" strokeWidth={1.75} />
          Корзина
        </button>
        <div className="w-px h-6 bg-border mx-1" />
        <button key="modrinth" type="button" onClick={() => setView("modrinth")}
          className={cn("flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors",
            view === "modrinth" ? "bg-green-500/20 text-green-400" : "bg-muted/50 text-muted-foreground")}>
          <svg className="w-3.5 h-3.5" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24">
            <path fill="currentColor" d="M12.252.004a11.78 11.768 0 0 0-8.92 3.73a11 11 0 0 0-2.17 3.11a11.37 11.359 0 0 0-1.16 5.169c0 1.42.17 2.5.6 3.77c.24.759.77 1.899 1.17 2.529a12.3 12.298 0 0 0 8.85 5.639c.44.05 2.54.07 2.76.02c.2-.04.22.1-.26-1.7l-.36-1.37l-1.01-.06a8.5 8.489 0 0 1-5.18-1.8a5.3 5.3 0 0 1-1.3-1.26c0-.05.34-.28.74-.5a37.572 37.545 0 0 1 2.88-1.629c.03 0 .5.45 1.06.98l1 .97l2.07-.43l2.06-.43l1.47-1.47c.8-.8 1.48-1.5 1.48-1.52c0-.09-.42-1.63-.46-1.7c-.04-.06-.2-.03-1.02.18c-.53.13-1.2.3-1.45.4l-.48.15l-.53.53l-.53.53l-.93.1l-.93.07l-.52-.5a2.7 2.7 0 0 1-.96-1.7l-.13-.6l.43-.57c.68-.9.68-.9 1.46-1.1c.4-.1.65-.2.83-.33c.13-.099.65-.579 1.14-1.069l.9-.9l-.7-.7l-.7-.7l-1.95.54c-1.07.3-1.96.53-1.97.53c-.03 0-2.23 2.48-2.63 2.97l-.29.35l.28 1.03c.16.56.3 1.16.31 1.34l.03.3l-.34.23c-.37.23-2.22 1.3-2.84 1.63-.36.2-.37.2-.44.1c-.08-.1-.23-.6-.32-1.03c-.18-.86-.17-2.75.02-3.73a8.84 8.84 0 0 1 7.9-6.93c.43-.03.77-.08.78-.1c.06-.17.5-2.999.47-3.039c-.01-.02-.1-.02-.2-.03Zm3.68.67c-.2 0-.3.1-.37.38c-.06.23-.46 2.42-.46 2.52c0 .04.1.11.22.16a8.51 8.499 0 0 1 2.99 2a8.38 8.379 0 0 1 2.16 3.449a6.9 6.9 0 0 1 .4 2.8c0 1.07 0 1.27-.1 1.73a9.4 9.4 0 0 1-1.76 3.769c-.32.4-.98 1.06-1.37 1.38c-.38.32-1.54 1.1-1.7 1.14c-.1.03-.1.06-.07.26c.03.18.64 2.56.7 2.78l.06.06a12.07 12.058 0 0 0 7.27-9.4c.13-.77.13-2.58 0-3.4a11.96 11.948 0 0 0-5.73-8.578c-.7-.42-2.05-1.06-2.25-1.06Z"/>
          </svg>Modrinth
        </button>
        <button key="curseforge" type="button" onClick={() => setView("curseforge")}
          className={cn("flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors",
            view === "curseforge" ? "bg-orange-500/20 text-orange-400" : "bg-muted/50 text-muted-foreground")}>
          <svg className="w-3.5 h-3.5" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24">
            <path fill="currentColor" d="M18.326 9.215s4.9-.773 5.674-3.027h-7.507V4.4H0l2.032 2.358v2.415s5.127-.266 7.11 1.237c2.714 2.516-3.053 5.917-3.053 5.917l-.99 3.273c1.547-1.473 4.494-3.377 9.899-3.286c-2.057.65-4.125 1.665-5.735 3.286h10.925l-1.029-3.273s-7.918-4.668-.833-7.112"/>
          </svg>CurseForge
        </button>
        <button key="ftb" type="button" onClick={() => setView("ftb")}
          className={cn("flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors",
            view === "ftb" ? "bg-sky-500/20 text-sky-400" : "bg-muted/50 text-muted-foreground")}>
          <svg className="w-3.5 h-3.5" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1544.031 1112.211">
            <path fill="currentColor" d="M456.147 246.012C470.315 163.992 483.696 81.758 499.344 0c30.976 9.746 63.159 15.542 95.61 16.596 77.388 2.528 154.771.841 232.157 1.316 65.324-.37 132.279 2.686 195.284-17.753 13.694 82.126 30.552 163.988 41.562 246.484-10.798 1.157-21.596 2.476-32.343 3.846-25.764-59.054-55.581-120.636-109.469-159.038-30.814-21.494-68.271-29.975-105.255-31.713-.686 238.267-.418 476.585-.896 714.853 22.809 3.057 45.728 5.269 68.589 8.112-.159 14.173-.159 28.392-.106 42.622-82.76-.318-165.518-.059-248.225-.165.16-13.797 0-27.601-.576-41.401 22.703-4.744 45.986-5.742 68.957-9.009.104-238.215-.051-476.482-.211-714.695-46.409.896-93.769 16.278-127.223 49.36-40.826 38.402-64.794 90.241-87.023 140.705-11.378-.895-22.757-2.158-34.029-4.108z"/>
            <path fill="currentColor" d="M405.68 305.171c38.929-.316 77.861-5.479 115.103-17.121 18.756 86.236 38.46 172.261 56.157 258.706-13.381 1.95-26.763 3.794-40.143 5.69-34.875-78.598-89.766-156.404-173.944-186.327-56.893-22.598-118.847-16.856-178.636-15.961-2.108 108.729-.581 217.669-1.105 326.453 44.196-1.316 95.244 7.32 132.381-22.491 27.657-27.766 35.929-68.276 44.829-105.047a1685.8 1685.8 0 0 1 40.039-.157c.052 99.196-.16 198.338-.262 297.533-13.016-.107-26.026-.052-39.037.053-10.854-37.931-17.439-82.285-49.782-108.682-38.455-25.389-87.291-17.486-130.854-19.015-.051 114.577-.211 229.204-.051 343.833 22.806 3.106 45.883 4.794 68.586 8.746a1749.451 1749.451 0 0 0-.16 40.621-82.81.152-165.619-.319-248.435.205.211-13.905.268-27.813.159-41.67 22.548-3.9 46.988-2.367 68.271-9.848-.16-234.844.211-469.737-.946-704.529-22.707-1.95-45.25-4.85-67.851-7.641v-43.303c135.228-.1 270.455-.048 405.681-.048z"/>
            <path fill="currentColor" d="M942.955 305.277c87.765-.055 175.523-.055 263.286-.055 67.537-.262 137.388.528 200.813 26.551 45.408 16.964 84.656 53.894 97.193 101.513 13.117 50.678 11.692 108.625-17.121 153.823-33.607 49.048-91.926 75.223-148.817 86.129 63.374 15.752 126.69 44.776 167.466 97.615 33.82 44.617 42.776 103.458 36.295 157.928-4.161 50.104-28.289 98.883-68.375 129.806-48.784 37.93-112.204 50.569-172.632 53.102-119.212.524-238.424-.318-357.636.422.262-13.859.313-27.76.211-41.619 23.021-2.787 46.195-4.054 68.956-8.693-1.632-235.208-.159-470.474-1.79-705.685-22.651-2.107-45.251-4.898-67.851-7.587.002-14.434.002-28.87.002-43.25m183.904 44.987c-1.797 100.828-.269 201.708-1.056 302.59 67.167-1.214 137.964 2.737 200.494-26.134 39.406-17.542 67.063-56.731 72.012-99.402 4.48-38.876 1.898-80.969-19.332-114.945-15.485-25.707-43.671-40.036-71.482-48.623-58.426-17.91-120.323-15.698-180.636-13.486m-3.586 347.996c.106 122.005-.211 244.011.056 366.017 58.997 10.164 120.21 9.431 178.42-5.166 39.298-10.375 78.653-32.233 97.563-69.748 22.019-42.821 24.971-92.976 19.597-140.071-5.583-49.094-34.242-94.978-77.28-119.737-65.115-39.67-145.028-37.829-218.356-31.295z"/>
          </svg>
          FTB
        </button>
        {view === "my" && (
          <InstanceCreateDialog
            open={createOpen}
            setOpen={setCreateOpen}
            onCreate={onCreate}
            onImported={onImported}
            onImportFile={onImportFile}
          />
        )}
      </div>
    </div>
  )
}
