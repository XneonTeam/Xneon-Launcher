import { SETTINGS_CONTENT_ENTER_DELAYED } from "./settings-motion"
import { useState } from "react"
import { useTranslation } from "react-i18next"
import {
  IconAlertTriangle,
  IconCheck,
  IconCircleX,
  IconCopy,
  IconPalette,
  IconPencil,
  IconPlus,
  IconSparkles,
  IconTrash,
} from "@tabler/icons-react"
import { cn } from "@/lib/utils"
import { ModalLayer } from "@/components/ui/modal-layer"
import type { Theme } from "./types"
import { applyTheme } from "./theme-model"
import type { ThemeRegistry } from "./theme-store"
import { ThemeEditor } from "./theme-editor"
import { ThemeCompactPreview } from "./theme-preview"

interface SettingsThemesProps {
  registry: ThemeRegistry
}

/**
 * Мелкое действие на карточке темы.
 *
 * Кнопки собраны в группу в стиле табов настроек (общая «подушка» с
 * разделителями), поэтому сами кнопки повторяют их размеры и переходы.
 */
function CardAction({
  icon,
  label,
  onClick,
  danger,
}: {
  icon: React.ReactNode
  label: string
  onClick: () => void
  danger?: boolean
}) {
  return (
    <button data-ui="settings-settings-themes-button-1" data-component="card-action"
      type="button"
      onClick={onClick}
      className={cn(
        "flex items-center justify-center gap-1.5 px-3 py-1 rounded-lg text-[13px] font-medium transition-all duration-200",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/60",
        danger
          ? "text-muted-foreground hover:bg-destructive/15 hover:text-destructive focus-visible:ring-destructive/60"
          : "text-muted-foreground hover:text-foreground hover:bg-muted/80"
      )}
    >
      {icon}
      {label}
    </button>
  )
}

function ThemeCard({
  theme,
  selected,
  onSelect,
  onEdit,
  onDuplicate,
  onDelete,
}: {
  theme: Theme
  selected: boolean
  onSelect: () => void
  onEdit?: () => void
  onDuplicate?: () => void
  onDelete?: () => void
}) {
  const { t } = useTranslation()
  const isCustom = !!theme.custom
  const description = theme.description?.trim() || (isCustom
    ? t("settings.themes.description.custom")
    : t(`settings.themes.description.${theme.id}`, { defaultValue: t("settings.themes.description.custom") }))

  return (
    <div data-ui="settings-settings-themes-div-1" data-component="theme-card" data-selected={selected} data-custom={isCustom}
      className={cn(
        "flex flex-col rounded-2xl border p-3.5 transition-colors",
        selected
          ? "border-primary/50 bg-primary/5"
          : "border-border bg-card/60 hover:border-primary/40 hover:bg-muted/30"
      )}
    >
      <button data-ui="settings-settings-themes-button-2"
        type="button"
        aria-pressed={selected}
        onClick={onSelect}
        className="w-full rounded-xl text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/60"
      >
        <ThemeCompactPreview theme={theme} className="mb-3" />
        <div data-ui="settings-settings-themes-div-2" className="flex items-center justify-between gap-2">
          <span data-ui="settings-settings-themes-span-1" className="min-w-0 truncate text-sm font-medium text-foreground">{theme.name}</span>
          <span data-ui="settings-settings-themes-span-2" className="flex shrink-0 items-center gap-1.5">
            {isCustom && (
              <span data-ui="settings-settings-themes-span-3" className="rounded-md bg-muted/60 px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
                {t("settings.themes.customBadge")}
              </span>
            )}
            {selected && (
              <span data-ui="settings-settings-themes-span-4" className="flex h-5 w-5 items-center justify-center rounded-full bg-primary">
                <IconCheck className="h-3.5 w-3.5 text-primary-foreground" strokeWidth={2.5} />
              </span>
            )}
          </span>
        </div>
        <p className="mt-1.5 text-xs leading-relaxed text-muted-foreground">{description}</p>
      </button>

      {isCustom && (
        <div data-ui="settings-settings-themes-div-3" className="mt-3 border-t border-border/60 pt-2.5">
          <div data-ui="settings-settings-themes-div-4" className="flex w-fit flex-wrap gap-0.5 rounded-xl border border-border/50 bg-muted/30 p-1">
            {onEdit && (
              <CardAction
                icon={<IconPencil className="h-4 w-4" strokeWidth={1.75} />}
                label={t("settings.themes.edit")}
                onClick={onEdit}
              />
            )}
            {onDuplicate && (
              <CardAction
                icon={<IconCopy className="h-4 w-4" strokeWidth={1.75} />}
                label={t("settings.themes.duplicate")}
                onClick={onDuplicate}
              />
            )}
            {onDelete && (
              <CardAction
                icon={<IconTrash className="h-4 w-4" strokeWidth={1.75} />}
                label={t("settings.themes.delete")}
                onClick={onDelete}
                danger
              />
            )}
          </div>
        </div>
      )}
    </div>
  )
}

/**
 * Раздел «Темы»: готовые темы и «Мои темы».
 *
 * Свои темы правятся в `ThemeEditor`, который применяет черновик к документу
 * на каждое изменение. Поэтому закрытие без сохранения обязано вернуть прежнюю
 * тему — это делает `closeEditor` ниже, а не сам редактор.
 */
export function SettingsThemes({ registry }: SettingsThemesProps) {
  const { t } = useTranslation()
  const [editing, setEditing] = useState<{ theme: Theme; isNew: boolean } | null>(null)
  const [pendingDelete, setPendingDelete] = useState<Theme | null>(null)

  const presets = registry.themes.filter((theme) => !theme.custom)
  const customThemes = registry.customThemes

  const createButton = () => (
    <button data-ui="settings-settings-themes-button-3"
      type="button"
      onClick={() => setEditing({ theme: registry.makeTheme(t("themeEditor.namePlaceholder")), isNew: true })}
      className={cn(
        "flex items-center gap-1.5 rounded-xl bg-primary px-3 py-2 text-xs font-semibold text-primary-foreground transition-colors hover:bg-primary/90",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/60 focus-visible:ring-offset-2 focus-visible:ring-offset-background"
      )}
    >
      <IconPlus className="h-4 w-4" strokeWidth={2} />
      {t("settings.themes.create")}
    </button>
  )

  const closeEditor = () => {
    setEditing(null)
    // В редакторе мог остаться неприменённый черновик — возвращаем выбранную тему.
    applyTheme(registry.selectedTheme)
  }

  const handleSave = (theme: Theme) => {
    registry.saveTheme(theme)
    registry.selectTheme(theme.id)
    setEditing(null)
  }

  const handleDeleteFromEditor = (theme: Theme) => {
    // Стор сам применит тему по умолчанию, если удалили выбранную.
    registry.deleteTheme(theme.id)
    setEditing(null)
  }

  const handleDuplicate = (theme: Theme) => {
    const copy = registry.copyTheme(theme.id, t("settings.themes.duplicatedName", { name: theme.name }))
    if (copy) registry.selectTheme(copy.id)
  }

  const confirmDelete = () => {
    if (pendingDelete) registry.deleteTheme(pendingDelete.id)
    setPendingDelete(null)
  }

  return (
    <div data-ui="settings-settings-themes-div-5" data-component="settings-themes" className={`space-y-8 ${SETTINGS_CONTENT_ENTER_DELAYED}`}>
      <section data-ui="settings-settings-themes-section-1" className="space-y-4">
        <h3 data-ui="settings-settings-themes-h3-1" className="flex items-center gap-2 text-lg font-medium text-foreground">
          <IconPalette className="h-5 w-5 text-primary" strokeWidth={1.75} />
          {t("settings.themes.presets")}
        </h3>
        <div data-ui="settings-settings-themes-div-6" className="grid grid-cols-2 gap-3">
          {presets.map((theme) => (
            <ThemeCard
              key={theme.id}
              theme={theme}
              selected={registry.selectedThemeId === theme.id}
              onSelect={() => registry.selectTheme(theme.id)}
            />
          ))}
        </div>
      </section>

      <section data-ui="settings-settings-themes-section-2" className="space-y-4">
        <div data-ui="settings-settings-themes-div-7" className="flex flex-wrap items-center justify-between gap-3">
          <h3 data-ui="settings-settings-themes-h3-2" className="flex items-center gap-2 text-lg font-medium text-foreground">
            <IconSparkles className="h-5 w-5 text-primary" strokeWidth={1.75} />
            {t("settings.themes.custom")}
          </h3>
          {createButton()}
        </div>

        {customThemes.length > 0 ? (
          <div data-ui="settings-settings-themes-div-8" className="grid grid-cols-2 gap-3">
            {customThemes.map((theme) => (
              <ThemeCard
                key={theme.id}
                theme={theme}
                selected={registry.selectedThemeId === theme.id}
                onSelect={() => registry.selectTheme(theme.id)}
                onEdit={() => setEditing({ theme, isNew: false })}
                onDuplicate={() => handleDuplicate(theme)}
                onDelete={() => setPendingDelete(theme)}
              />
            ))}
          </div>
        ) : registry.ready ? (
          <div data-ui="settings-settings-themes-div-9" className="flex flex-col items-center gap-3 rounded-2xl border border-dashed border-border bg-card/40 px-4 py-8 text-center">
            <IconPalette className="h-7 w-7 text-muted-foreground/60" strokeWidth={1.5} />
            <p data-ui="settings-settings-themes-p-1" className="max-w-md text-sm text-muted-foreground">{t("settings.themes.customEmpty")}</p>
          </div>
        ) : (
          // Список своих тем ещё читается из хранилища — не показываем пустоту преждевременно.
          <div data-ui="settings-settings-themes-div-10" className="grid grid-cols-2 gap-3">
            <div data-ui="settings-settings-themes-div-11" className="h-28 animate-pulse rounded-2xl border border-border bg-muted/20" />
            <div data-ui="settings-settings-themes-div-12" className="h-28 animate-pulse rounded-2xl border border-border bg-muted/20" />
          </div>
        )}
      </section>

      {editing && (
        <ThemeEditor
          initialTheme={editing.theme}
          isNew={editing.isNew}
          themes={registry.themes}
          onSave={handleSave}
          onDelete={handleDeleteFromEditor}
          onClose={closeEditor}
        />
      )}

      {pendingDelete && (
        <ModalLayer windowId="settings-settings-themes-window-1" onClose={() => setPendingDelete(null)} className="animate-in fade-in-0">
          <div data-ui="settings-settings-themes-div-13" className="w-full max-w-md rounded-2xl border border-destructive/50 bg-card p-6 shadow-2xl animate-in zoom-in-95 slide-in-from-bottom-4">
            <div data-ui="settings-settings-themes-div-14" className="mb-6 flex items-center gap-4">
              <div data-ui="settings-settings-themes-div-15" className="flex h-12 w-12 items-center justify-center rounded-xl bg-destructive/20">
                <IconAlertTriangle className="h-6 w-6 text-destructive" strokeWidth={1.5} />
              </div>
              <div data-ui="settings-settings-themes-div-16" className="min-w-0">
                <h3 data-ui="settings-settings-themes-h3-3" className="text-lg font-semibold text-foreground">
                  {t("settings.themes.deleteConfirmTitle")}
                </h3>
                <p data-ui="settings-settings-themes-p-2" className="text-sm text-muted-foreground">{t("settings.areYouSure")}</p>
              </div>
            </div>
            <div data-ui="settings-settings-themes-div-17" className="mb-6 rounded-xl border border-destructive/20 bg-destructive/10 p-4">
              <p data-ui="settings-settings-themes-p-3" className="text-foreground">{t("settings.themes.deleteConfirm", { name: pendingDelete.name })}</p>
            </div>
            <div data-ui="settings-settings-themes-div-18" className="flex gap-3">
              <button data-ui="settings-settings-themes-button-4"
                type="button"
                onClick={() => setPendingDelete(null)}
                className="flex flex-1 items-center justify-center gap-2 rounded-xl border border-border bg-muted/30 px-4 py-3 text-foreground transition-colors hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/60"
              >
                <IconCircleX className="h-4 w-4" strokeWidth={1.75} />
                {t("themeEditor.cancel")}
              </button>
              <button data-ui="settings-settings-themes-button-5"
                type="button"
                onClick={confirmDelete}
                className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-destructive px-4 py-3 font-medium text-destructive-foreground transition-colors hover:bg-destructive/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-destructive/60"
              >
                <IconTrash className="h-4 w-4" strokeWidth={1.75} />
                {t("settings.themes.delete")}
              </button>
            </div>
          </div>
        </ModalLayer>
      )}
    </div>
  )
}
