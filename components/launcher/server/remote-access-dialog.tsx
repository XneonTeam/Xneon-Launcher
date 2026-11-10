import { EmptyState } from "@/components/ui/empty-state"
import { IconCloudUpload as PublicationIcon } from "@tabler/icons-react"
import { IconX as LauncherCloseIcon } from "@tabler/icons-react"
import { IconArrowLeft as LauncherBackIcon, IconX as LauncherCancelIcon } from "@tabler/icons-react"
import { useEffect, useState } from "react"
import { useTranslation } from "react-i18next"
import { IconHistory, IconPlugConnected, IconKey, IconTrash, IconPlugConnectedX, IconLogout, IconPencil, IconUserPlus, IconPlayerPlay, IconPlayerStop, IconTerminal2, IconFolder, IconSettings, IconFileSettings, IconUsers, IconGitBranch, IconArrowLeft } from "@tabler/icons-react"
import { SERVER_PERMISSION_KEYS, serverPermissions } from "@xnlc/share"
import type { McServerInfo, RemoteServerAccess, RemoteServerRequest, ServerPermissions } from "@xnlc/types"
import { ShareModal, ShareButton, shareInput } from "../instance/shared/share-ui"
import { ShareInvitationCode } from "../instance/shared/share-invitation-code"
import { ShareAuthor } from "../instance/shared/share-author"
import { ServerHistoryPanel, ServerPublishDialog, useServerHistory } from "./server-history-panel"
import { ShareManagementView } from "../instance/shared/share-management-view"
import { useMcServerState } from "@/src/hooks/use-mc-servers"
import { SettingsSwitch } from "../settings/settings-switch"

export function PermissionEditor({ value, onChange, allowed = serverPermissions(true), disabled = false }: { value: ServerPermissions; onChange(value: ServerPermissions): void; allowed?: ServerPermissions; disabled?: boolean }) {
  const { t } = useTranslation()
  const icons = { start: IconPlayerPlay, stop: IconPlayerStop, console: IconTerminal2, readFiles: IconFolder, writeFiles: IconFolder, properties: IconFileSettings, settings: IconSettings, players: IconUsers, invite: IconUserPlus, versions: IconGitBranch } as const
  return <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">{SERVER_PERMISSION_KEYS.map(key => { const PermissionIcon = icons[key]; return <div key={key} className={`flex min-h-[72px] items-center gap-3 rounded-xl border border-border/60 bg-muted/20 px-3 py-2.5 ${!allowed[key] || disabled ? "opacity-50" : ""}`}>
    <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary"><PermissionIcon className="h-4 w-4 text-primary" strokeWidth={1.75} /></span>
    <div className="min-w-0 flex-1"><p className="text-xs font-medium">{t(`remoteServer.permission.${key}`)}</p><p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">{t(`remoteServer.permissionHint.${key}`)}</p></div>
    <SettingsSwitch label={t(`remoteServer.permission.${key}`)} checked={value[key]} disabled={disabled || !allowed[key]} onCheckedChange={checked => onChange({ ...value, [key]: checked })} />
  </div> })}</div>
}
export function remoteServerError(error: unknown, t: (key: string) => string): string {
  const message = error instanceof Error ? error.message : String(error)
  if (/ACCOUNT_REQUIRED|non-offline/i.test(message)) return t("remoteServer.error.account")
  if (/OFFLINE|TIMEOUT|fetch failed|WebSocket|network/i.test(message)) return t("remoteServer.error.offline")
  if (/FORBIDDEN|permission|membership/i.test(message)) return t("remoteServer.error.permission")
  if (/INVITE|invitation|code/i.test(message)) return t("remoteServer.error.invite")
  return t("remoteServer.error.generic")
}

export function RemoteAccessDialog({ open, onClose, server, onAccessChange }: { open: boolean; onClose(): void; server: McServerInfo; onAccessChange?(enabled: boolean): void }) {
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
      const result = await window.electrobunAPI!.mcServerRemote(request)
      if (result.access) { onAccessChange?.(true); setAccess(result.access); setPermissions(previous => Object.fromEntries(SERVER_PERMISSION_KEYS.map(key => [key, previous[key] && result.access!.permissions[key]])) as ServerPermissions) }
      if (result.enabled === false) { setAccess(undefined); onAccessChange?.(false) }
      if (result.code) { setCode(result.code) }
      return result
    } catch (error) { setError(remoteServerError(error, t)) }
    finally { setBusy(false) }
  }
  useEffect(() => {
    if (!open) return
    let active = true
    setAccess(undefined); setError(""); setCode(""); setEditing(undefined); setPage("share"); setLoading(true)
    window.electrobunAPI!.mcServerRemote({ action: "access", serverId: server.id }).then(result => { if (active) { onAccessChange?.(!!result.access); setAccess(result.access); if (result.access) setPermissions(previous => Object.fromEntries(SERVER_PERMISSION_KEYS.map(key => [key, previous[key] && result.access!.permissions[key]])) as ServerPermissions) } }).catch(error => { if (active) setError(remoteServerError(error, t)) }).finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [open, server.id])

  return <>
    {(page === "share" || page === "members" || page === "codes") && <ShareModal open={open} onClose={close} wide={page === "codes"} fixedHeight={page === "codes"}
      title={t(page === "members" ? "share.tabs.members" : page === "codes" ? "share.launcher.inviteTitle" : "share.launcher.title")}
      description={t(page === "members" ? "share.members.description" : page === "codes" ? "share.launcher.inviteDescription" : access ? "share.launcher.manageDescription" : "remoteServer.enableDescription")}
      titleIcon={page === "codes" ? <IconKey className="h-4 w-4 text-primary" strokeWidth={1.75} /> : undefined}
      footer={page === "members" ? <><ShareButton secondary onClick={() => setPage("share")}>{<span className="inline-flex items-center justify-center gap-2"><LauncherBackIcon className="h-4 w-4 shrink-0 text-primary" strokeWidth={1.75} aria-hidden="true" />{t("share.flow.back")}</span>}</ShareButton>{access?.permissions.invite && <ShareButton disabled={busy} onClick={() => setPage("codes")}><IconUserPlus className="h-3.5 w-3.5" />{t("share.launcher.invite")}</ShareButton>}</> : page === "codes" ? <><ShareButton secondary onClick={close}>{<span className="inline-flex items-center justify-center gap-2"><LauncherCloseIcon className="h-4 w-4 shrink-0 text-primary" strokeWidth={1.75} aria-hidden="true" />{t("share.launcher.close")}</span>}</ShareButton>{!code && <ShareButton busy={busy} disabled={busy} onClick={() => void run({ action: "invite", serverId: server.id, permissions }).then(result => { if (result) void run({ action: "access", serverId: server.id }) })}><IconKey className="h-4 w-4" />{t("remoteServer.createCode")}</ShareButton>}</> : <><ShareButton secondary onClick={close}>{<span className="inline-flex items-center justify-center gap-2"><LauncherCloseIcon className="h-4 w-4 shrink-0 text-primary" strokeWidth={1.75} aria-hidden="true" />{t("share.launcher.close")}</span>}</ShareButton>{!access ? <ShareButton busy={busy} disabled={busy || loading || !stopped} onClick={() => void run({ action: "enable", serverId: server.id }).then(result => { if (result) { history.clearError(); setPage("publish") } })}><PublicationIcon className="h-4 w-4 shrink-0" strokeWidth={1.75} />{t("share.launcher.preparePublication")}</ShareButton> : (access.isOwner || access.permissions.versions) && <ShareButton disabled={busy || history.busy || !stopped} onClick={() => { history.clearError(); setPage("publish") }}><PublicationIcon className="h-4 w-4 shrink-0" strokeWidth={1.75} aria-hidden="true" />{t(history.view?.head ? "share.launcher.prepareUpdate" : "share.launcher.preparePublication")}</ShareButton>}</>}>
      {loading ? <p className="py-6 text-center text-xs text-muted-foreground">{t("remoteServer.loading")}</p> : page === "share" ? <div className="space-y-4">
        <ShareManagementView showSummary={false} shared={!!access} busy={busy} memberCount={access?.members?.length ?? 0} onMembers={() => setPage("members")} onVersions={() => setPage("versions")} />
        {access?.isOwner && <button type="button" disabled={busy} className="flex w-full items-center gap-3 rounded-xl border border-border/70 bg-card p-3 text-left text-xs font-medium transition-colors hover:bg-muted disabled:opacity-50" onClick={() => setPage("deletePublication")}><IconPlugConnectedX className="h-4 w-4 shrink-0 text-primary" strokeWidth={1.75} />{t("remoteServer.disable")}</button>}
        {access && !access.isOwner && <ShareButton secondary disabled={busy} onClick={() => void run({ action: "leave", serverId: server.id }).then(result => { if (result) close() })}><IconLogout className="h-4 w-4 text-primary" />{t("remoteServer.leave")}</ShareButton>}
        {!stopped && <p className="text-xs text-muted-foreground">{t("serverHistory.stopFirst")}</p>}
      </div> : page === "members" ? <div className="space-y-3">{!access?.members?.length && <EmptyState icon={IconUsers} title={t("share.members.empty")} className="min-h-48 rounded-none border-0 bg-transparent py-8" />}{access?.members?.map(member => <div key={member.id} className="space-y-3 rounded-2xl border border-border/70 bg-card/40 p-4">
        <div className="flex items-center justify-between gap-3"><div className="min-w-0 text-sm font-medium"><ShareAuthor author={member.id} name={member.name} /></div>
          {member.owner ? <span className="text-xs text-muted-foreground">{t("remoteServer.owner")}</span> : access?.isOwner ? <div className="flex gap-2">
            <ShareButton secondary disabled={busy} onClick={() => { setEditing(editing === member.id ? undefined : member.id); setDraft(member.permissions) }} aria-label={t("remoteServer.editPermissions")}><IconPencil className="h-3.5 w-3.5 text-primary" />{t("remoteServer.permissions")}</ShareButton>
            <ShareButton secondary disabled={busy} onClick={() => void run({ action: "removeMember", serverId: server.id, memberId: member.id })} aria-label={t("remoteServer.removeMember")}><IconTrash className="h-3.5 w-3.5 text-destructive" /></ShareButton>
          </div> : null}
        </div>
        {!member.owner && editing !== member.id && <p className="text-[11px] leading-relaxed text-muted-foreground">{SERVER_PERMISSION_KEYS.filter(key => member.permissions[key]).map(key => t(`remoteServer.permission.${key}`)).join(" · ") || t("remoteServer.viewOnly")}</p>}
        {editing === member.id && <ShareModal open onClose={() => setEditing(undefined)} wide fixedHeight title={member.name} description={t("remoteServer.permissions")} titleIcon={<ShareAuthor author={member.id} name={member.name} size="large" />} footer={<><ShareButton secondary disabled={busy} onClick={() => setEditing(undefined)}>{<span className="inline-flex items-center justify-center gap-2"><LauncherCancelIcon className="h-4 w-4 shrink-0 text-primary" strokeWidth={1.75} aria-hidden="true" />{t("share.flow.cancel")}</span>}</ShareButton><ShareButton busy={busy} disabled={busy} onClick={() => void run({ action: "member", serverId: server.id, memberId: member.id, permissions: draft }).then(result => { if (result) setEditing(undefined) })}>{t("remoteServer.savePermissions")}</ShareButton></>}><PermissionEditor value={draft} onChange={setDraft} disabled={busy} /></ShareModal>}
      </div>)}</div> : <div className="grid min-h-0 gap-5 lg:grid-cols-[minmax(0,1.6fr)_minmax(260px,0.8fr)]">
        <section className="min-h-0 space-y-3 overflow-y-auto pr-1">
          <div><h3 className="text-sm font-semibold text-foreground">{t("remoteServer.codePermissions")}</h3><p className="mt-1 text-xs text-muted-foreground">{t("share.launcher.inviteDescription")}</p></div>
          <PermissionEditor value={permissions} onChange={value => { setPermissions(value); setCode("") }} allowed={access?.permissions} disabled={busy} />
        </section>
        <aside className="flex min-h-0 flex-col gap-3 border-t border-border/60 pt-4 lg:border-l lg:border-t-0 lg:pl-5 lg:pt-0">
          <div className="rounded-2xl border border-border bg-muted/20 p-4">
            <p className="text-sm font-semibold text-foreground">{code ? t("remoteServer.code") : t("remoteServer.createCode")}</p>
            <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{code ? t("remoteServer.joinDescription") : t("remoteServer.codePermissions")}</p>
            {code ? <div className="mt-4"><ShareInvitationCode key={code} code={code} hint="" /></div> : <div className="mt-4 rounded-xl border border-dashed border-border px-3 py-5 text-center text-xs text-muted-foreground">{t("remoteServer.createCode")}</div>}
          </div>
          {!!access?.invites?.length && <div className="min-h-0 space-y-2 overflow-y-auto">
            <p className="text-xs font-semibold text-foreground">{t("remoteServer.activeCode")}</p>
            {access.invites.map(invite => <div key={invite.id} className="flex items-center justify-between gap-3 rounded-xl border border-border/60 bg-card/40 px-3 py-2.5"><span className="text-xs text-muted-foreground">{new Date(invite.expiresAt).toLocaleDateString()}</span><ShareButton secondary disabled={busy} onClick={() => void run({ action: "revokeInvite", serverId: server.id, inviteId: invite.id })}>{t("remoteServer.revoke")}</ShareButton></div>)}
          </div>}
        </aside>
      </div>}
      {error && <p role="alert" className="mt-4 text-xs text-destructive">{error}</p>}
    </ShareModal>}
    {page === "versions" && <ShareModal open={open} onClose={close} wide fixedHeight={!!access} title={t("share.launcher.versions")} description={t("share.flow.versionControlDescription")} footer={<><ShareButton secondary onClick={() => setPage("share")}><IconArrowLeft className="h-3.5 w-3.5 text-primary" />{t("share.flow.back")}</ShareButton>{!access && <ShareButton busy={busy} disabled={busy || loading || !stopped} onClick={() => void run({ action: "enable", serverId: server.id }).then(result => { if (result) { history.clearError(); setPage("publish") } })}><PublicationIcon className="h-4 w-4 shrink-0" strokeWidth={1.75} />{t("share.launcher.preparePublication")}</ShareButton>}</>}>
      {!access ? <EmptyState icon={IconHistory} title={t("share.history.empty")} className="min-h-48 rounded-none border-0 bg-transparent py-8" /> : readable ? <ServerHistoryPanel server={server} controller={history} permissions={access.permissions} /> : <p className="py-8 text-sm text-muted-foreground">{t("remoteServer.error.permission")}</p>}
    </ShareModal>}
    {page === "publish" && open && <ServerPublishDialog server={server} controller={history} onClose={close} />}
    {page === "deletePublication" && <ShareModal open={open} onClose={close} title={t("remoteServer.disable")} description={t("remoteServer.disableDescription", { name: server.name })} titleIcon={<IconPlugConnectedX className="h-4 w-4 text-primary" strokeWidth={1.75} />} footer={<><ShareButton secondary disabled={busy} onClick={() => setPage("share")}>{<span className="inline-flex items-center justify-center gap-2"><LauncherCancelIcon className="h-4 w-4 shrink-0 text-primary" strokeWidth={1.75} aria-hidden="true" />{t("share.flow.cancel")}</span>}</ShareButton><ShareButton busy={busy} disabled={busy} className="bg-destructive text-destructive-foreground hover:bg-destructive/90" onClick={() => void run({ action: "disable", serverId: server.id }).then(result => { if (result) { setCode(""); setPage("share") } })}><IconPlugConnectedX className="h-4 w-4 shrink-0" strokeWidth={1.75} aria-hidden="true" />{t("remoteServer.disable")}</ShareButton></>}>
      <ul className="space-y-3">
        {[
          { icon: IconUsers, key: "members" },
          { icon: IconKey, key: "codes" },
          { icon: IconGitBranch, key: "history" },
          { icon: IconFolder, key: "files" },
        ].map(({ icon: Icon, key }) => <li key={key} className="flex items-start gap-3 rounded-xl border border-border/60 bg-card p-3">
          <Icon className="mt-0.5 h-4 w-4 shrink-0 text-primary" strokeWidth={1.75} aria-hidden="true" />
          <p className="text-xs leading-relaxed text-foreground">{t(`remoteServer.disableEffect.${key}`)}</p>
        </li>)}
      </ul>
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
    try { await window.electrobunAPI!.mcServerRemote({ action: "join", code }); onJoined(); onClose() }
    catch (error) { setError(remoteServerError(error, t)) } finally { setBusy(false) }
  }
  return <ShareModal open={open} onClose={onClose} title={t("remoteServer.joinTitle")} description={t("remoteServer.joinDescription")} titleIcon={<IconKey className="h-4 w-4 text-primary" />} footer={<><ShareButton secondary onClick={onClose} disabled={busy}>{<span className="inline-flex items-center justify-center gap-2"><LauncherCancelIcon className="h-4 w-4 shrink-0 text-primary" strokeWidth={1.75} aria-hidden="true" />{t("share.flow.cancel")}</span>}</ShareButton><ShareButton disabled={busy || !code.trim()} busy={busy} onClick={() => void join()}><IconPlugConnected className="size-4" strokeWidth={1.75} aria-hidden="true" />{t("remoteServer.connect")}</ShareButton></>}>
    <label className="block space-y-2"><span className="text-xs text-muted-foreground"><IconKey className="mr-1.5 inline-block size-3.5 text-primary" strokeWidth={1.75} aria-hidden="true" />{t("remoteServer.code")}</span><input autoFocus className={`${shareInput} font-mono`} value={code} onChange={event => setCode(event.target.value)} placeholder="XNS-XXXX-XXXX-XXXX-XXXX-XXXX" maxLength={100} onKeyDown={event => { if (event.key === "Enter" && code.trim() && !busy) void join() }} /></label>
    {error && <p role="alert" className="mt-3 text-xs text-destructive">{error}</p>}
  </ShareModal>
}
