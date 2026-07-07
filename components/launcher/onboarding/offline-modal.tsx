import { IconArrowLeft, IconUser, IconX } from "@tabler/icons-react"
import type { OnboardingCopy } from "./translations"

type OfflineModalProps = {
  copy: OnboardingCopy
  offlineUsername: string
  onUsernameChange: (value: string) => void
  onAdd: () => void
  onClose: () => void
}

export function OfflineModal({ copy, offlineUsername, onUsernameChange, onAdd, onClose }: OfflineModalProps) {
  return (
    <div className="absolute inset-0 z-10 flex items-center justify-center bg-background/80 px-4 backdrop-blur-sm">
      <div className="w-full max-w-md rounded-2xl border border-border bg-card p-6 shadow-2xl">
        <div className="mb-6 flex items-center justify-between">
          <h3 className="text-lg font-semibold text-foreground">{copy.accountOfflineTitle}</h3>
          <button
            type="button"
            onClick={onClose}
            className="flex h-8 w-8 items-center justify-center rounded-lg bg-muted/50 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            <IconX className="h-5 w-5" />
          </button>
        </div>

        <div className="space-y-4">
          <div className="space-y-2">
            <label className="text-sm text-muted-foreground">{copy.accountNicknameLabel}</label>
            <input
              type="text"
              value={offlineUsername}
              onChange={(e) => onUsernameChange(e.target.value)}
              placeholder={copy.accountOfflinePlaceholder}
              className="w-full rounded-xl border border-border bg-input px-4 py-3 text-foreground outline-none placeholder:text-muted-foreground focus:border-primary focus:ring-1 focus:ring-primary"
              autoFocus
              onKeyDown={(event) => {
                if (event.key === "Enter") onAdd()
              }}
            />
          </div>

          <div className="flex gap-3 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="flex flex-1 items-center justify-center gap-2 rounded-xl border border-border bg-muted/30 px-4 py-3 text-foreground transition-colors hover:bg-muted/50"
            >
              <IconArrowLeft className="h-4 w-4" strokeWidth={1.75} />
              {copy.back}
            </button>
            <button
              type="button"
              onClick={onAdd}
              disabled={!offlineUsername.trim()}
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
