import { useState } from "react"
import { useTranslation } from "react-i18next"
import type { McServerInfo } from "@xnlc/types"
import { ShareButton, shareInput } from "../instance/shared/share-ui"
import { remoteServerError } from "./remote-access-dialog"

/** Только переносимые настройки процесса: выбор локальной Java и туннеля остаётся у владельца. */
export function RemoteSettingsTab({ server, onServerUpdated }: { server: McServerInfo; onServerUpdated?: (server: McServerInfo) => void }) {
  const { t } = useTranslation()
  const [name, setName] = useState(server.name), [xmx, setXmx] = useState(String(server.xmx)), [xms, setXms] = useState(String(server.xms))
  const [args, setArgs] = useState(server.extraJavaArgs), [restart, setRestart] = useState(server.autoRestart)
  const [busy, setBusy] = useState(false), [error, setError] = useState(""), [saved, setSaved] = useState(false)
  const save = async () => {
    setBusy(true); setError(""); setSaved(false)
    try {
      await window.electronAPI!.mcServerUpdate(server.id, { name: name.trim(), xmx: Number(xmx), xms: Number(xms), extraJavaArgs: args, autoRestart: restart })
      const next = await window.electronAPI!.mcServerGet(server.id)
      if (next) onServerUpdated?.(next)
      setSaved(true)
    } catch (error) { setError(remoteServerError(error, t)) } finally { setBusy(false) }
  }
  return <div className="mx-auto w-full max-w-3xl space-y-5 overflow-y-auto rounded-2xl border border-border bg-card/40 p-6">
    <h2 className="text-base font-semibold">{t("servers.tabSettings")}</h2>
    <label className="block space-y-2"><span className="text-xs text-muted-foreground">{t("remoteServer.serverName")}</span><input className={shareInput} value={name} onChange={event => setName(event.target.value)} maxLength={200} /></label>
    <section className="space-y-4 rounded-2xl border border-border/70 bg-card/40 p-5"><h3 className="text-sm font-medium">{t("settings.ram")}</h3><div className="grid grid-cols-2 gap-4">{[{ value: xms, set: setXms, label: "memoryMin" }, { value: xmx, set: setXmx, label: "memoryMax" }].map(item => <label key={item.label} className="block space-y-2"><span className="text-xs text-muted-foreground">{t(`remoteServer.${item.label}`)}</span><input type="number" min={1} max={1048576} className={shareInput} value={item.value} onChange={event => item.set(event.target.value)} /></label>)}</div></section>
    <label className="block space-y-2"><span className="text-xs text-muted-foreground">{t("share.launchSettings.javaArgs")}</span><input className={shareInput} value={args} onChange={event => setArgs(event.target.value)} maxLength={16384} /></label>
    <label className="flex items-center gap-3 text-sm"><input type="checkbox" className="accent-primary" checked={restart} onChange={event => setRestart(event.target.checked)} />{t("remoteServer.autoRestart")}</label>
    {error && <p className="text-xs text-destructive" role="alert">{error}</p>}
    <div className="flex items-center justify-end gap-3">{saved && <span role="status" className="text-xs text-muted-foreground">{t("remoteServer.saved")}</span>}<ShareButton busy={busy} disabled={busy || !name.trim() || Number(xms) < 1 || Number(xmx) < Number(xms)} onClick={() => void save()}>{t("remoteServer.save")}</ShareButton></div>
  </div>
}
