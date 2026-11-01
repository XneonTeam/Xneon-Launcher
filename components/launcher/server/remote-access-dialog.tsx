import { useEffect, useState } from "react"
import { useTranslation } from "react-i18next"
import { IconKey, IconTrash, IconPlugConnectedX, IconLogout, IconPencil, IconUserPlus } from "@tabler/icons-react"
import { SERVER_PERMISSION_KEYS, serverPermissions } from "@xnlc/share"
import type { McServerInfo, RemoteServerAccess, RemoteServerRequest, ServerPermissions } from "@xnlc/types"
import { ShareModal, ShareButton, shareInput } from "../instance/shared/share-ui"
import { ShareInvitationCode } from "../instance/shared/share-invitation-code"
import { ShareAuthor } from "../instance/shared/share-author"
import { ServerHistoryPanel, ServerPublishDialog, useServerHistory } from "./server-history-panel"
import { ShareManagementView } from "../instance/shared/share-management-view"
import { useMcServerState } from "@/src/hooks/use-mc-servers"

export function PermissionEditor({ value, onChange, allowed = serverPermissions(true), disabled = false }: { value: ServerPermissions; onChange(value: ServerPermissions): void; allowed?: ServerPermissions; disabled?: boolean }) {
  const { t } = useTranslation()
  return <div className="grid gap-2 sm:grid-cols-2">{SERVER_PERMISSION_KEYS.map(key => <label key={key} className={`flex items-start gap-3 rounded-xl border border-border/60 bg-muted/20 px-3 py-2.5 ${!allowed[key] || disabled ? "opacity-50" : "cursor-pointer hover:bg-muted/40"}`}>
    <input type="checkbox" className="mt-0.5 h-4 w-4 shrink-0 accent-primary" checked={value[key]} disabled={disabled || !allowed[key]} onChange={event => onChange({ ...value, [key]: event.target.checked })} />
    <span className="min-w-0"><span className="block text-xs font-medium">{t(`remoteServer.permission.${key}`)}</span><span className="mt-1 block text-[11px] leading-relaxed text-muted-foreground">{t(`remoteServer.permissionHint.${key}`)}</span></span>
  </label>)}</div>
}
export function remoteServerError(error: unknown, t: (key: string) => string): string {
  const message = error instanceof Error ? error.message : String(error)
  if (/ACCOUNT_REQUIRED|non-offline/i.test(message)) return t("remoteServer.error.account")
  if (/OFFLINE|TIMEOUT|fetch failed|WebSocket|network/i.test(message)) return t("remoteServer.error.offline")
  if (/FORBIDDEN|permission|membership/i.test(message)) return t("remoteServer.error.permission")
  if (/INVITE|invitation|code/i.test(message)) return t("remoteServer.error.invite")
  return t("remoteServer.error.generic")
}

export function RemoteAccessDialog({ open, onClose, server }: { open: boolean; onClose(): void; server: McServerInfo }) {
  const { t } = useTranslation()
  const [access, setAccess] = useState<RemoteServerAccess>()
  const [busy, setBusy] = useState(false), [loading, setLoading] = useState(false)
  const [error, setError] = useState(""), [code, setCode] = useState("")
  const [page, setPage] = useState<"share" | "members" | "codes" | "versions" | "publish" | "deletePublication">("share")
  const [permissions, setPermissions] = useState<ServerPermissions>(() => ({ ...serverPermissions(), readFiles: true }))
  const [editing, setEditing] = useState<string>(), [draft, setDraft] = useState<ServerPermissions>(serverPermissions())
  const readable = !!access && (access.isOwner || access.permissions.readFiles)
  const history = useServerHistory(server, open && readable)
  const { state } = useMcServerState(server.id)
  const stopped = state.status === "stopped"
  const close = () => { history.clearError(); onClose() }
  const run = async (request: RemoteServerRequest) => {
    setBusy(true); setError("")
    try {
      const result = await window.electronAPI!.mcServerRemote(request)
      if (result.access) { setAccess(result.access); setPermissions(previous => Object.fromEntries(SERVER_PERMISSION_KEYS.map(key => [key, previous[key] && result.access!.permissions[key]])) as ServerPermissions) }
      if (result.enabled === false) setAccess(undefined)
      if (result.code) { setCode(result.code) }
      return result
    } catch (error) { setError(remoteServerError(error, t)) }
    finally { setBusy(false) }
  }
  useEffect(() => {
    if (!open) return
    let active = true
    setAccess(undefined); setError(""); setCode(""); setEditing(undefined); setPage("share"); setLoading(true)
    window.electronAPI!.mcServerRemote({ action: "access", serverId: server.id }).then(result => { if (active) { setAccess(result.access); if (result.access) setPermissions(previous => Object.fromEntries(SERVER_PERMISSION_KEYS.map(key => [key, previous[key] && result.access!.permissions[key]])) as ServerPermissions) } }).catch(error => { if (active) setError(remoteServerError(error, t)) }).finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [open, server.id])

  return <>
    {(page === "share" || page === "members" || page === "codes") && <ShareModal open={open} onClose={close}
      title={t(page === "members" ? "share.tabs.members" : page === "codes" ? "share.launcher.inviteTitle" : "share.launcher.title")}
      description={t(page === "members" ? "share.members.description" : page === "codes" ? "share.launcher.inviteDescription" : access ? "share.launcher.manageDescription" : "remoteServer.enableDescription")}
      titleIcon={page === "codes" ? <IconKey className="h-4 w-4" strokeWidth={1.75} /> : undefined}
      footer={page === "members" ? <><ShareButton secondary onClick={() => setPage("share")}>{t("share.flow.back")}</ShareButton>{access?.permissions.invite && <ShareButton disabled={busy} onClick={() => setPage("codes")}><IconUserPlus className="h-3.5 w-3.5" />{t("share.launcher.invite")}</ShareButton>}</> : page === "codes" ? <><ShareButton secondary onClick={close}>{t("share.launcher.close")}</ShareButton>{!code && <ShareButton busy={busy} disabled={busy} onClick={() => void run({ action: "invite", serverId: server.id, permissions }).then(result => { if (result) void run({ action: "access", serverId: server.id }) })}><IconKey className="h-4 w-4" />{t("remoteServer.createCode")}</ShareButton>}</> : <><ShareButton secondary onClick={close}>{t("share.launcher.close")}</ShareButton>{!access ? <ShareButton busy={busy} disabled={busy || loading} onClick={() => void run({ action: "enable", serverId: server.id })}>{t("remoteServer.enable")}</ShareButton> : (access.isOwner || access.permissions.versions) && <ShareButton disabled={busy || history.busy || !stopped} onClick={() => { history.clearError(); setPage("publish") }}>{t(history.view?.head ? "share.launcher.prepareUpdate" : "share.launcher.preparePublication")}</ShareButton>}</>}>
      {loading ? <p className="py-6 text-center text-xs text-muted-foreground">{t("remoteServer.loading")}</p> : page === "share" ? <div className="space-y-4">
        <ShareManagementView showSummary={false} shared={!!access} busy={busy} memberCount={access?.members?.length ?? 0} onMembers={() => setPage("members")} onVersions={() => setPage("versions")} />
        {access?.isOwner && <button type="button" disabled={busy} className="flex w-full items-center gap-3 rounded-xl border border-border/70 p-3 text-left text-xs font-medium transition-colors hover:bg-muted/40 disabled:opacity-50" onClick={() => setPage("deletePublication")}><IconPlugConnectedX className="h-4 w-4 shrink-0" strokeWidth={1.75} />{t("remoteServer.disable")}</button>}
        {access && !access.isOwner && <ShareButton secondary disabled={busy} onClick={() => void run({ action: "leave", serverId: server.id }).then(result => { if (result) close() })}><IconLogout className="h-4 w-4" />{t("remoteServer.leave")}</ShareButton>}
        {access && !stopped && <p className="text-xs text-muted-foreground">{t("serverHistory.stopFirst")}</p>}
      </div> : page === "members" ? <div className="space-y-3">{access?.members?.map(member => <div key={member.id} className="space-y-3 rounded-2xl border border-border/70 bg-card/40 p-4">
        <div className="flex items-center justify-between gap-3"><div className="min-w-0 text-sm font-medium"><ShareAuthor author={member.id} name={member.name} /></div>
          {member.owner ? <span className="text-xs text-muted-foreground">{t("remoteServer.owner")}</span> : access?.isOwner ? <div className="flex gap-2">
            <ShareButton secondary disabled={busy} onClick={() => { setEditing(editing === member.id ? undefined : member.id); setDraft(member.permissions) }} aria-label={t("remoteServer.editPermissions")}><IconPencil className="h-3.5 w-3.5" />{t("remoteServer.permissions")}</ShareButton>
            <ShareButton secondary disabled={busy} onClick={() => void run({ action: "removeMember", serverId: server.id, memberId: member.id })} aria-label={t("remoteServer.removeMember")}><IconTrash className="h-3.5 w-3.5 text-destructive" /></ShareButton>
          </div> : null}
        </div>
        {!member.owner && <p className="text-[11px] leading-relaxed text-muted-foreground">{SERVER_PERMISSION_KEYS.filter(key => member.permissions[key]).map(key => t(`remoteServer.permission.${key}`)).join(" · ") || t("remoteServer.viewOnly")}</p>}
        {editing === member.id && <><PermissionEditor value={draft} onChange={setDraft} disabled={busy} /><div className="flex justify-end"><ShareButton busy={busy} disabled={busy} onClick={() => void run({ action: "member", serverId: server.id, memberId: member.id, permissions: draft }).then(result => { if (result) setEditing(undefined) })}>{t("remoteServer.savePermissions")}</ShareButton></div></>}
      </div>)}</div> : <div className="space-y-5">
        <div className="space-y-3"><p className="text-xs text-muted-foreground">{t("remoteServer.codePermissions")}</p><PermissionEditor value={permissions} onChange={value => { setPermissions(value); setCode("") }} allowed={access?.permissions} disabled={busy} /></div>
        {code && <ShareInvitationCode key={code} code={code} hint={t("remoteServer.joinDescription")} />}
        {!!access?.invites?.length && <div className="space-y-2 border-t border-border/50 pt-4">{access.invites.map(invite => <div key={invite.id} className="flex items-center justify-between gap-3 rounded-xl border border-border/60 px-3 py-3"><span className="text-xs text-muted-foreground">{t("remoteServer.activeCode")} · {new Date(invite.expiresAt).toLocaleDateString()}</span><ShareButton secondary disabled={busy} onClick={() => void run({ action: "revokeInvite", serverId: server.id, inviteId: invite.id })}>{t("remoteServer.revoke")}</ShareButton></div>)}</div>}
      </div>}
      {error && <p role="alert" className="mt-4 text-xs text-destructive">{error}</p>}
    </ShareModal>}
    {page === "versions" && <ShareModal open={open} onClose={close} wide fixedHeight={!!access} title={t("share.launcher.versions")} description={t("share.flow.versionControlDescription")} footer={!access ? <><ShareButton secondary onClick={() => setPage("share")}>{t("share.flow.back")}</ShareButton><ShareButton disabled={busy} onClick={() => void run({ action: "enable", serverId: server.id })}>{t("remoteServer.enable")}</ShareButton></> : undefined}>
      {!access ? <p className="py-8 text-sm text-muted-foreground">{t("share.history.empty")}</p> : readable ? <ServerHistoryPanel server={server} controller={history} permissions={access.permissions} /> : <p className="py-8 text-sm text-muted-foreground">{t("remoteServer.error.permission")}</p>}
    </ShareModal>}
    {page === "publish" && open && <ServerPublishDialog server={server} controller={history} onClose={close} />}
    {page === "deletePublication" && <ShareModal open={open} onClose={close} title={t("remoteServer.disable")} description={t("remoteServer.hostRequirement")} footer={<><ShareButton secondary disabled={busy} onClick={() => setPage("share")}>{t("share.flow.cancel")}</ShareButton><ShareButton busy={busy} disabled={busy} className="bg-destructive text-destructive-foreground hover:bg-destructive/90" onClick={() => void run({ action: "disable", serverId: server.id }).then(result => { if (result) { setCode(""); setPage("share") } })}>{t("remoteServer.disable")}</ShareButton></>}>
      {error && <p role="alert" className="text-xs text-destructive">{error}</p>}
    </ShareModal>}
  </>
}

export function RemoteServerJoinDialog({ open, onClose, onJoined }: { open: boolean; onClose(): void; onJoined(): void }) {
  const { t } = useTranslation()
  const [code, setCode] = useState(""), [busy, setBusy] = useState(false), [error, setError] = useState("")
  useEffect(() => { if (open) { setCode(""); setError("") } }, [open])
  const join = async () => {
    setBusy(true); setError("")
    try { await window.electronAPI!.mcServerRemote({ action: "join", code }); onJoined(); onClose() }
    catch (error) { setError(remoteServerError(error, t)) } finally { setBusy(false) }
  }
  return <ShareModal open={open} onClose={onClose} title={t("remoteServer.joinTitle")} description={t("remoteServer.joinDescription")} titleIcon={<IconKey className="h-4 w-4" />} footer={<><ShareButton secondary onClick={onClose} disabled={busy}>{t("share.flow.cancel")}</ShareButton><ShareButton disabled={busy || !code.trim()} busy={busy} onClick={() => void join()}>{t("remoteServer.connect")}</ShareButton></>}>
    <label className="block space-y-2"><span className="text-xs text-muted-foreground">{t("remoteServer.code")}</span><input autoFocus className={`${shareInput} font-mono`} value={code} onChange={event => setCode(event.target.value)} placeholder="XNS-XXXX-XXXX-XXXX-XXXX-XXXX" maxLength={100} onKeyDown={event => { if (event.key === "Enter" && code.trim() && !busy) void join() }} /></label>
    {error && <p role="alert" className="mt-3 text-xs text-destructive">{error}</p>}
  </ShareModal>
}
