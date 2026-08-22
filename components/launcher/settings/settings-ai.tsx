import { useEffect, useState } from "react"
import { useTranslation } from "react-i18next"
import { IconBrain, IconKey, IconWorld, IconLoader2, IconCheck, IconAlertTriangle } from "@tabler/icons-react"

export function SettingsAi() {
  const { t } = useTranslation()
  const [apiKey, setApiKey] = useState("")
  const [endpoint, setEndpoint] = useState("https://api.openai.com/v1")
  const [model, setModel] = useState("gpt-4o-mini")
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [testing, setTesting] = useState(false)
  const [testResult, setTestResult] = useState<"ok" | "error" | null>(null)
  const [testMessage, setTestMessage] = useState("")

  useEffect(() => {
    const api = window.electronAPI
    if (!api) return
    api.getSetting("aiApiKey").then((v) => { if (v) setApiKey(v) })
    api.getSetting("aiEndpoint").then((v) => { if (v) setEndpoint(v) })
    api.getSetting("aiModel").then((v) => { if (v) setModel(v) })
  }, [])

  const handleSave = async () => {
    const api = window.electronAPI
    if (!api) return
    setSaving(true)
    setSaved(false)
    try {
      await api.setSetting("aiApiKey", apiKey)
      await api.setSetting("aiEndpoint", endpoint)
      await api.setSetting("aiModel", model)
      setSaved(true)
      setTimeout(() => setSaved(false), 2000)
    } finally {
      setSaving(false)
    }
  }

  const handleTest = async () => {
    const api = window.electronAPI
    if (!api) return
    setTesting(true)
    setTestResult(null)
    setTestMessage("")
    try {
      const result = await api.analyzeCrash("[Test] java.lang.OutOfMemoryError: Java heap space\n\tat net.minecraft.client.main.Main.main(Main.java:100)")
      if (result.success) {
        setTestResult("ok")
        setTestMessage("API connected successfully!")
      } else {
        setTestResult("error")
        setTestMessage(result.error || "Unknown error")
      }
    } catch (err) {
      setTestResult("error")
      setTestMessage(err instanceof Error ? err.message : String(err))
    } finally {
      setTesting(false)
    }
  }

  return (
    <div className="space-y-6 animate-in fade-in-0 slide-in-from-left-4 duration-300">
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-xl bg-primary/20 flex items-center justify-center">
          <IconBrain className="w-5 h-5 text-primary" />
        </div>
        <div>
          <h2 className="text-lg font-bold text-foreground">{t("ai.title")}</h2>
          <p className="text-sm text-muted-foreground">{t("ai.subtitle")}</p>
        </div>
      </div>

      <div className="space-y-4">
        {/* API Key */}
        <div className="p-4 rounded-xl border border-border bg-muted/30 space-y-3">
          <div className="flex items-center gap-2">
            <IconKey className="w-4 h-4 text-primary" strokeWidth={1.75} />
            <label className="text-sm font-medium text-foreground">{t("ai.apiKey")}</label>
          </div>
          <input
            type="password"
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            placeholder={t("ai.apiKeyPlaceholder")}
            className="w-full px-4 py-2.5 rounded-xl bg-background border border-border text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-primary transition-colors"
          />
          <p className="text-xs text-muted-foreground">{t("ai.apiKeyDesc")}</p>
        </div>

        {/* Endpoint */}
        <div className="p-4 rounded-xl border border-border bg-muted/30 space-y-3">
          <div className="flex items-center gap-2">
            <IconWorld className="w-4 h-4 text-primary" strokeWidth={1.75} />
            <label className="text-sm font-medium text-foreground">{t("ai.endpoint")}</label>
          </div>
          <input
            type="text"
            value={endpoint}
            onChange={(e) => setEndpoint(e.target.value)}
            placeholder="https://api.openai.com/v1"
            className="w-full px-4 py-2.5 rounded-xl bg-background border border-border text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-primary transition-colors"
          />
          <p className="text-xs text-muted-foreground">{t("ai.endpointDesc")}</p>
        </div>

        {/* Model */}
        <div className="p-4 rounded-xl border border-border bg-muted/30 space-y-3">
          <div className="flex items-center gap-2">
            <IconBrain className="w-4 h-4 text-primary" strokeWidth={1.75} />
            <label className="text-sm font-medium text-foreground">{t("ai.model")}</label>
          </div>
          <input
            type="text"
            value={model}
            onChange={(e) => setModel(e.target.value)}
            placeholder="gpt-4o-mini"
            className="w-full px-4 py-2.5 rounded-xl bg-background border border-border text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-primary transition-colors"
          />
          <p className="text-xs text-muted-foreground">{t("ai.modelDesc")}</p>
        </div>

        {/* Actions */}
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={handleSave}
            disabled={saving || !apiKey}
            className="flex items-center gap-2 px-4 py-2 rounded-xl bg-primary text-primary-foreground font-medium hover:bg-primary/90 transition-colors disabled:opacity-50"
          >
            {saving ? <IconLoader2 className="w-4 h-4 animate-spin" /> : saved ? <IconCheck className="w-4 h-4 text-green-400" /> : null}
            {saved ? t("ai.saved") : saving ? t("ai.saving") : t("ai.save")}
          </button>

          <button
            type="button"
            onClick={handleTest}
            disabled={testing || !apiKey}
            className="flex items-center gap-2 px-4 py-2 rounded-xl bg-muted/50 text-muted-foreground font-medium hover:bg-muted hover:text-foreground transition-colors disabled:opacity-50"
          >
            {testing ? <IconLoader2 className="w-4 h-4 animate-spin" /> : null}
            {t("ai.test")}
          </button>
        </div>

        {/* Test result */}
        {testResult && (
          <div className={`p-3 rounded-xl text-sm ${testResult === "ok" ? "bg-green-500/10 text-green-400 border border-green-500/20" : "bg-red-500/10 text-red-400 border border-red-500/20"}`}>
            <div className="flex items-center gap-2">
              {testResult === "ok" ? <IconCheck className="w-4 h-4" /> : <IconAlertTriangle className="w-4 h-4" />}
              {testMessage}
            </div>
          </div>
        )}

        {/* Info */}
        <div className="p-4 rounded-xl border border-border bg-muted/20 text-sm text-muted-foreground space-y-2">
          <p>{t("ai.info1")}</p>
          <p>{t("ai.info2")}</p>
        </div>
      </div>
    </div>
  )
}
