// Корзина сборок: содержимое строк и IPC — здесь, вся общая логика в TrashView.

import { useTranslation } from "react-i18next"
import { IconPackage } from "@tabler/icons-react"
import { TrashView } from "../trash-view"
import { LoaderIcon } from "./loader-icon"

interface TrashItem {
  trashName: string
  originalName: string
  trashedAt: number
  icon?: string
  modLoader?: string
}

interface InstanceTrashViewProps {
  goToMyBuilds: () => void
  /** Восстанавливает сборку из корзины: папку, запись в БД и состояние списка. */
  onRestore: (item: { trashName: string; originalName: string }) => Promise<boolean>
}

export function InstanceTrashView({ goToMyBuilds, onRestore }: InstanceTrashViewProps) {
  const { t } = useTranslation()

  return (
    <TrashView<TrashItem>
      load={async () => (await window.electronAPI?.listTrashBuilds()) ?? []}
      row={(item) => ({
        key: item.trashName,
        name: item.originalName,
        icon: item.icon,
        fallbackIcon: item.modLoader
          ? <LoaderIcon loaderId={item.modLoader} className="w-5 h-5 text-primary/40" />
          : <IconPackage className="w-5 h-5 text-primary/40" />,
        extra: (
          <p className="text-xs text-muted-foreground">
            {t("trash.deletedAt", { date: new Date(item.trashedAt).toLocaleDateString() })}
          </p>
        ),
      })}
      onRestore={onRestore}
      onDeleteForever={async (item) => {
        const result = await window.electronAPI?.deleteTrashItem(item.trashName)
        if (result && !result.success) throw new Error(result.error ?? t("trash.error.delete"))
      }}
      onPurgeAll={async () => {
        const result = await window.electronAPI?.purgeBuildTrash()
        if (result && !result.success) throw new Error(result.error ?? t("trash.error.purge"))
      }}
      afterRestore={goToMyBuilds}
      labels={{
        loading: t("trash.loading"),
        empty: t("trash.empty"),
        itemCount: (count) => t("trash.itemsCount", { count }),
        restore: t("trash.restore"),
        purgeAll: t("trash.purge"),
        deleteForeverTitle: t("trash.deleteForever.title"),
        deleteForeverDescription: (name) => t("trash.deleteForever.description", { name }),
        deleteForeverConfirm: t("trash.deleteForever.confirm"),
        purgeConfirmTitle: t("trash.purgeConfirm.title"),
        purgeConfirmDescription: (count) => t("trash.purgeConfirm.description", { count }),
        purgeConfirmConfirm: t("trash.purgeConfirm.confirm"),
        cancel: t("common.cancel"),
        errorTitle: t("trash.errorTitle"),
        errorRestore: t("trash.error.restore"),
        errorDelete: t("trash.error.delete"),
        errorPurge: t("trash.error.purge"),
        gotIt: t("common.gotIt"),
      }}
    />
  )
}