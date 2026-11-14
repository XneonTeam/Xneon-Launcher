import type { TFunction } from "i18next"
import type { ShareProgress } from "@xnlc/types"
import type { ActivityNotificationInput } from "./ActivityCenterContext"

const NOTIFIED_ACTIONS = new Set(["publish", "push", "apply", "restoreApply", "installInvite"])

/** Фоновые проверки не создают уведомлений; одна операция обновляет одну запись. */
export function createShareNotification(event: ShareProgress, t: TFunction): ActivityNotificationInput | null {
  if (!event.requestId || !event.action || !NOTIFIED_ACTIONS.has(event.action)) return null

  const done = event.stage === "done"
  const failed = event.stage === "error"
  const cancelled = event.stage === "cancelled"
  const busy = !done && !failed && !cancelled
  const title = t(`share.flow.activity.${event.action}.${done ? "done" : failed ? "error" : "progress"}`)
  const message = done ? t(`share.flow.activity.${event.action}.message`)
    : failed ? t(`share.errors.${event.errorCode || "SHARE"}`, { defaultValue: t("share.flow.activity.error") })
    : cancelled ? t("share.flow.activity.cancelled")
    : t(`share.flow.stage.${event.stage}`, { defaultValue: t("share.flow.working") })
  const measurable = busy && ["upload", "download", "verify"].includes(event.stage)
    && Number.isFinite(event.done) && Number.isFinite(event.total) && event.total > 0

  return {
    kind: done ? "success" : failed ? "error" : cancelled ? "info" : "progress",
    source: "share",
    title,
    message,
    itemName: event.buildName?.trim() || null,
    busy,
    progress: measurable ? Math.max(0, Math.min(100, Math.round(event.done / event.total * 100))) : null,
  }
}
