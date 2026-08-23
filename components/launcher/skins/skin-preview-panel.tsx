import { useState, useMemo } from "react"
import { useTranslation } from "react-i18next"
import { cn } from "@/lib/utils"
import { SkinViewer3D } from "@/components/ui/skin-viewer-3d"
import { CachedAvatar } from "@/components/ui/cached-avatar"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { useAccounts } from "@/src/AccountsContext"
import { getAvatarUrl, ACCOUNT_TYPE_LABELS } from "@/lib/home-page-shared"
import type { SkinCardData } from "./skin-card"
import type { McProfile } from "@xnlc/types"
import {
  IconLoader2, IconUser, IconCheck, IconChevronDown,
  IconPencil, IconRefresh,
} from "@tabler/icons-react"

interface SkinPreviewPanelProps {
  selectedSkin: SkinCardData | undefined
  selectedCapeUrl: string | undefined
  hasPendingChange: boolean
  isApplying: boolean
  loading: boolean
  profile: McProfile | null
  onApply: () => void
  onReset: () => void
  onEdit: () => void
  onCancelSelection: () => void
}

export function SkinPreviewPanel({
  selectedSkin,
  selectedCapeUrl,
  hasPendingChange,
  isApplying,
  loading,
  onApply,
  onReset,
  onEdit,
  onCancelSelection,
}: SkinPreviewPanelProps) {
  const { t } = useTranslation()
  const { accounts, activeAccount, setActiveAccount } = useAccounts()
  const [accountComboOpen, setAccountComboOpen] = useState(false)

  const account = activeAccount ?? accounts[0]
  // Пока скины поддерживаются только для аккаунтов Microsoft
  const skinAccounts = useMemo(() => accounts.filter((a) => a.type === "microsoft"), [accounts])
  const activeAvatarUrl = useMemo(
    () => (account ? getAvatarUrl(account, account.username) : ""),
    [account]
  )
  const accountAvatarUrls = useMemo(
    () => Object.fromEntries(skinAccounts.map((a) => [a.id, getAvatarUrl(a, a.username)])),
    [skinAccounts]
  )

  return (
    <div className="sticky top-6 self-start flex flex-col gap-4 w-full">
      {/* Account Selector */}
      <div className="rounded-2xl bg-card border border-border overflow-hidden shadow-sm">
        <button
          type="button"
          className="w-full px-4 py-3.5 text-left hover:bg-muted/30 transition-colors duration-200"
          onClick={() => setAccountComboOpen(true)}
        >
          <div className="flex items-center justify-between mb-1.5">
            <span className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">
              {t("home.account", "Аккаунт")}
            </span>
            <IconChevronDown className="w-3.5 h-3.5 text-muted-foreground/50" size={14} strokeWidth={2} />
          </div>
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl overflow-hidden flex-shrink-0 ring-2 ring-primary/20 ring-offset-2 ring-offset-card">
              {account ? (
                <CachedAvatar src={activeAvatarUrl} alt="" className="w-full h-full object-cover" />
              ) : (
                <div className="w-full h-full bg-muted flex items-center justify-center">
                  <span className="text-sm font-bold text-muted-foreground">P</span>
                </div>
              )}
            </div>
            <div className="flex-1 min-w-0">
              <p className="font-semibold text-foreground text-sm truncate">
                {account?.username ?? "Player"}
              </p>
              <p className="text-[11px] text-muted-foreground">
                {ACCOUNT_TYPE_LABELS[account?.type ?? "offline"]}
              </p>
            </div>
          </div>
        </button>

        <Dialog open={accountComboOpen} onOpenChange={setAccountComboOpen}>
          <DialogContent className="max-w-md p-0 gap-0">
            <DialogHeader className="px-5 pt-5 pb-3">
              <DialogTitle>{t("home.account", "Аккаунт")}</DialogTitle>
            </DialogHeader>
            <div className="flex flex-col gap-1 px-3 pb-3 max-h-[400px] overflow-y-auto scrollbar-thin">
              {skinAccounts.map((acc) => {
                const isActive = acc.id === account?.id
                return (
                  <button
                    key={acc.id}
                    type="button"
                    onClick={() => {
                      setActiveAccount(acc.id)
                      setAccountComboOpen(false)
                    }}
                    className={cn(
                      "flex items-center gap-3 w-full px-3 py-2.5 rounded-xl transition-all duration-200 text-left",
                      isActive
                        ? "bg-primary/15 border border-primary/25"
                        : "hover:bg-muted/60 border border-transparent"
                    )}
                  >
                    <div className="w-10 h-10 rounded-lg overflow-hidden flex-shrink-0">
                      <CachedAvatar
                        src={accountAvatarUrls[acc.id]}
                        alt=""
                        className="w-full h-full object-cover"
                      />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="font-medium text-sm text-foreground truncate">{acc.username}</p>
                      <p className="text-[11px] text-muted-foreground">
                        {ACCOUNT_TYPE_LABELS[acc.type] ?? acc.type}
                      </p>
                    </div>
                    {isActive && (
                      <IconCheck className="w-4 h-4 text-primary flex-shrink-0" strokeWidth={2} />
                    )}
                  </button>
                )
              })}
              {skinAccounts.length === 0 && (
                <p className="text-sm text-muted-foreground text-center py-4">
                  {t("skins.noMicrosoftAccounts", "Нет аккаунтов Microsoft")}
                </p>
              )}
            </div>
          </DialogContent>
        </Dialog>
      </div>

      {/* 3D Preview */}
      <div className="relative rounded-2xl bg-gradient-to-b from-muted/30 to-muted/10 border border-border/60 overflow-hidden shadow-inner">
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,oklch(0.65_0.22_40/0.04)_0%,transparent_70%)] pointer-events-none" />
        <div className="relative z-10 flex items-center justify-center" style={{ minHeight: 380 }}>
          {loading ? (
            <IconLoader2 className="w-10 h-10 text-muted-foreground/40 animate-spin" />
          ) : selectedSkin?.blobUrl ? (
            <SkinViewer3D
              skinUrl={selectedSkin.blobUrl}
              capeUrl={selectedCapeUrl}
              slim={selectedSkin.variant === "slim"}
              width={300}
              height={400}
            />
          ) : (
            <div className="flex flex-col items-center gap-3 text-muted-foreground/40 py-10">
              <IconUser className="w-20 h-20 opacity-30" strokeWidth={1} />
              <p className="text-sm font-medium">{t("skins.noSkin", "Скин не установлен")}</p>
            </div>
          )}
        </div>
      </div>

      {/* Action Buttons */}
      <div className="flex gap-2">
        {hasPendingChange ? (
          <>
            <button
              onClick={onApply}
              disabled={loading || isApplying}
              className="flex-1 flex items-center justify-center gap-2 px-4 py-3 rounded-xl bg-primary text-primary-foreground text-sm font-semibold hover:bg-primary/90 transition-all duration-200 disabled:opacity-50 shadow-lg shadow-primary/20 hover:shadow-primary/30 active:scale-[0.98]"
            >
              {isApplying ? (
                <IconLoader2 className="w-4 h-4 animate-spin" />
              ) : (
                <IconCheck className="w-4 h-4" />
              )}
              {t("skins.apply", "Применить")}
            </button>
            <button
              onClick={onCancelSelection}
              disabled={loading}
              className="flex items-center justify-center px-3.5 py-3 rounded-xl border border-border bg-card text-muted-foreground hover:bg-muted/60 hover:text-foreground transition-all duration-200 disabled:opacity-50"
              title={t("skins.cancel", "Отмена")}
            >
              <IconRefresh className="w-4 h-4" />
            </button>
          </>
        ) : (
          <>
            <button
              onClick={onEdit}
              disabled={!selectedSkin || loading}
              className="flex-1 flex items-center justify-center gap-2 px-4 py-3 rounded-xl bg-primary text-primary-foreground text-sm font-semibold hover:bg-primary/90 transition-all duration-200 disabled:opacity-50 shadow-lg shadow-primary/20 hover:shadow-primary/30 active:scale-[0.98]"
            >
              <IconPencil className="w-4 h-4" />
              {t("skins.editSkin", "Изменить")}
            </button>
            <button
              onClick={onReset}
              disabled={loading}
              className="flex items-center justify-center px-3.5 py-3 rounded-xl border border-primary/30 bg-primary/5 text-primary hover:bg-primary/10 transition-all duration-200 disabled:opacity-50"
              title={t("skins.reset", "Сбросить")}
            >
              <IconRefresh className="w-4 h-4" />
            </button>
          </>
        )}
      </div>
    </div>
  )
}
