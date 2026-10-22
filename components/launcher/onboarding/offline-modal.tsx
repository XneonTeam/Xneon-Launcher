import { IconArrowLeft, IconUser, IconX } from "@tabler/icons-react"
import { Checkbox } from "@/components/ui/checkbox"
import type { OnboardingCopy } from "./translations"

type OfflineModalProps = {
  copy: OnboardingCopy
  offlineUsername: string
  allowInvalidUsername: boolean
  onUsernameChange: (value: string) => void
  onAllowInvalidChange: (value: boolean) => void
  onAdd: () => void
  onClose: () => void
}

const OFFLINE_USERNAME_REGEX = /^[A-Za-z0-9_]{3,16}$/

export function OfflineModal({
  copy,
  offlineUsername,
  allowInvalidUsername,
  onUsernameChange,
  onAllowInvalidChange,
  onAdd,
  onClose,
}: OfflineModalProps) {
  const isValidUsername = OFFLINE_USERNAME_REGEX.test(offlineUsername.trim())
  const canAdd = Boolean(offlineUsername.trim()) && (isValidUsername || allowInvalidUsername)
  return (
    <div data-ui="onboarding-offline-modal-div-1" data-component="offline-modal" className="absolute inset-0 z-10 flex items-center justify-center bg-black/50 px-4 backdrop-blur-sm">
      <div data-ui="onboarding-offline-modal-div-2" className="w-full max-w-md rounded-2xl border border-border bg-card p-6 shadow-2xl">
        <div data-ui="onboarding-offline-modal-div-3" className="mb-6 flex items-center justify-between">
          <h3 data-ui="onboarding-offline-modal-h3-1" className="text-lg font-semibold text-foreground">{copy.accountOfflineTitle}</h3>
          <button data-ui="onboarding-offline-modal-button-1"
            type="button"
            onClick={onClose}
            className="flex h-8 w-8 items-center justify-center rounded-lg bg-muted/50 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            <IconX className="h-5 w-5" />
          </button>
        </div>

        <div data-ui="onboarding-offline-modal-div-4" className="space-y-4">
          <div data-ui="onboarding-offline-modal-div-5" className="space-y-2">
            <label data-ui="onboarding-offline-modal-label-1" className="text-sm text-muted-foreground">{copy.accountNicknameLabel}</label>
            <input data-ui="onboarding-offline-modal-input-1"
              type="text"
              value={offlineUsername}
              onChange={(e) => onUsernameChange(e.target.value)}
              placeholder={copy.accountOfflinePlaceholder}
              className="w-full rounded-xl border border-border bg-input px-4 py-3 text-foreground outline-none placeholder:text-muted-foreground focus:border-primary focus:ring-1 focus:ring-primary"
              autoFocus
              onKeyDown={(event) => {
                if (event.key === "Enter" && canAdd) onAdd()
              }}
            />
            {!isValidUsername && offlineUsername.trim() && !allowInvalidUsername && (
              <p data-ui="onboarding-offline-modal-p-1" className="text-xs text-destructive">{copy.accountOfflineInvalidHint}</p>
            )}
          </div>

          <label data-ui="onboarding-offline-modal-label-2" className="flex cursor-pointer items-center gap-2 text-sm text-muted-foreground">
            <Checkbox
              checked={allowInvalidUsername}
              onCheckedChange={(v) => onAllowInvalidChange(!!v)}
            />
            {copy.accountOfflineAllowInvalid}
          </label>

          <div data-ui="onboarding-offline-modal-div-6" className="flex gap-3 pt-2">
            <button data-ui="onboarding-offline-modal-button-2"
              type="button"
              onClick={onClose}
              className="flex flex-1 items-center justify-center gap-2 rounded-xl border border-border bg-muted/30 px-4 py-3 text-foreground transition-colors hover:bg-muted/50"
            >
              <IconArrowLeft className="h-4 w-4" strokeWidth={1.75} />
              {copy.back}
            </button>
            <button data-ui="onboarding-offline-modal-button-3"
              type="button"
              onClick={onAdd}
              disabled={!canAdd}
              className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-primary px-4 py-3 font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <IconUser className="h-4 w-4" strokeWidth={1.75} />
              {copy.accountOfflineAdd}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
