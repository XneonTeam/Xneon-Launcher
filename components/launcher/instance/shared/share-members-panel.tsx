import { useTranslation } from "react-i18next"
import { IconUserMinus } from "@tabler/icons-react"
import { ShareButton } from "./share-ui"
import { ShareRoleSelect } from "./share-role-select"
import { ShareAuthor } from "./share-author"
import type { ShareController } from "./use-share"

export function ShareMembersPanel({ controller, buildId }: { controller: ShareController; buildId: string }) {
  const { t } = useTranslation()
  const { data, busy } = controller
  const members = Object.entries(data.repository?.members ?? {})
  const canManageMembers = !!data.user && data.repository?.owner === data.user
  if (!members.length) return <p className="py-4 text-sm text-muted-foreground">{t("share.members.empty")}</p>
  return (
<div className="space-y-3">
                {members.map(([user, role]) => <div key={user} className="flex items-center gap-3 rounded-2xl border border-border/70 bg-card/40 p-4">
                  <div className="min-w-0 flex-1 text-sm"><ShareAuthor author={user} name={data.memberNames?.[user] ?? user} currentUser={data.user} /></div>
                  {canManageMembers && user !== data.repository?.owner && role !== "owner" ? <>
                    <ShareRoleSelect
                      className="w-32 shrink-0 text-xs"
                      label={t("share.members.roleFor", { name: data.memberNames?.[user] ?? user })}
                      value={role}
                      disabled={busy}
                      onValueChange={async role => {
                        if (await controller.run({ action: "command", buildId, command: { action: "member", user, role } })) await controller.refresh()
                      }}
                    />
                    <ShareButton secondary disabled={busy} aria-label={t("share.members.remove", { name: data.memberNames?.[user] ?? user })} title={t("share.members.remove", { name: data.memberNames?.[user] ?? user })} onClick={async () => {
                      if (await controller.run({ action: "command", buildId, command: { action: "member", user, role: null } })) await controller.refresh()
                    }}><IconUserMinus className="h-4 w-4" /></ShareButton>
                  </> : <span className="text-xs text-muted-foreground">{t(`share.roles.${role}`)}</span>}
                </div>)}
              </div>
  )
}
