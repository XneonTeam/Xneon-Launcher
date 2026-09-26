// Корзина серверов: содержимое строк и IPC — здесь, вся общая логика в TrashView.

import { useTranslation } from "react-i18next"
import { IconServer } from "@tabler/icons-react"
import type { McServerInfo } from "@xnlc/types"
import { TrashView } from "./trash-view"
import { LoaderIcon, loaderLabel } from "./instance/loader-icon"
import { XnConnectLogo } from "./server/xn-connect-logo"

interface ServerTrashViewProps {
  onBack: () => void
}

export function ServerTrashView({ onBack }: ServerTrashViewProps) {
  const { t } = useTranslation()

  return (
    <TrashView<McServerInfo>
      load={async () => (await window.electronAPI?.mcServerListTrash()) ?? []}
      row={(item) => ({
        key: item.id,
        name: item.name,
        icon: item.icon,
        iconPadding: "p-1",
        fallbackIcon: <IconServer className="w-5 h-5 text-primary/40" />,
        meta: (
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <span>{item.gameVersion}</span>
            <span>&middot;</span>
            <LoaderIcon loaderId={item.modloader} className="w-3.5 h-3.5 flex-shrink-0" />
            <span>{loaderLabel(item.modloader)}</span>
          </div>
        ),
        extra: item.trashedAt ? (
          <p className="text-[11px] text-muted-foreground">
            {t("servers.trash.deletedAt", {
              date: new Date(item.trashedAt).toLocaleDateString("ru-RU", {
                day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit",
              }),
            })}
          </p>
        ) : null,
      })}
      onRestore={async (item) => { await window.electronAPI?.mcServerRestore(item.id) }}
      onDeleteForever={async (item, options) => {
        await window.electronAPI?.mcServerPermanentDelete(item.id, options.extra)
      }}
      onPurgeAll={async (options) => {
        await window.electronAPI?.mcServerPurgeTrash(options.extra)
      }}
      confirmExtra={{
        label: t("servers.trash.deleteTunnel"),
        icon: <XnConnectLogo className="w-4 h-4 text-muted-foreground flex-shrink-0" />,
      }}
      afterRestore={onBack}
      labels={{
        loading: t("servers.trash.loading"),
        empty: t("servers.trash.empty"),
        itemCount: (count) => t("servers.trash.itemCount", { count }),
        restore: t("servers.trash.restore"),
        purgeAll: t("servers.trash.purgeAll"),
        deleteForeverTitle: t("servers.trash.deleteForeverTitle"),
        deleteForeverDescription: (name) => t("servers.trash.deleteForeverDesc", { name }),
        deleteForeverConfirm: t("servers.trash.deleteForeverTitle"),
        purgeConfirmTitle: t("servers.trash.purgeAll"),
        purgeConfirmDescription: (count) => t("servers.trash.purgeAllDesc", { count }),
        purgeConfirmConfirm: t("servers.trash.deleteForeverTitle"),
        cancel: t("servers.cancel"),
        errorTitle: t("trash.errorTitle"),
        errorRestore: t("trash.error.restore"),
        errorDelete: t("trash.error.delete"),
        errorPurge: t("trash.error.purge"),
        gotIt: t("common.gotIt"),
      }}
    />
  )
}