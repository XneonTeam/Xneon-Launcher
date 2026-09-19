import { useEffect, useMemo, useState } from "react"
import { useTranslation } from "react-i18next"
import { IconBrain, IconKey, IconWorld, IconLoader2, IconCheck, IconAlertTriangle, IconSearch, IconRefresh } from "@tabler/icons-react"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { cn } from "@/lib/utils"

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
  const [models, setModels] = useState<string[]>([])
  const [modelsOpen, setModelsOpen] = useState(false)
  const [modelsLoading, setModelsLoading] = useState(false)
  const [modelsError, setModelsError] = useState("")
  const [modelQuery, setModelQuery] = useState("")

  useEffect(() => {
    const api = window.electronAPI
    if (!api) return
    api.getAiConfig().then((config) => {
      setApiKey(config.apiKey)
      setEndpoint(config.endpoint)
      setModel(config.model)
    }).catch(() => {})
  }, [])

  const filteredModels = useMemo(() => {
    const query = modelQuery.trim().toLowerCase()
    if (!query) return models
    return models.filter((item) => item.toLowerCase().includes(query))
  }, [modelQuery, models])

  const handleLoadModels = async () => {
    const api = window.electronAPI
    if (!api) return
    setModelsLoading(true)
    setModelsError("")
    try {
      // Запрашиваем список для текущих (возможно ещё не сохранённых) настроек.
      const result = await api.listAiModels({ apiKey: apiKey.trim(), endpoint: endpoint.trim() })
      if (result.success && result.models) {
        setModels(result.models)
        setModelQuery("")
      } else {
        setModels([])
        setModelsError(result.error || t("ai.modelsError"))
      }
    } catch (err) {
      setModels([])
      setModelsError(err instanceof Error ? err.message : String(err))
    } finally {
      setModelsLoading(false)
    }
  }

  /** Открывает модалку выбора модели, подгружая список при первом открытии. */
  const handleOpenModels = () => {
    setModelsOpen(true)
    if (models.length === 0 && !modelsLoading) void handleLoadModels()
  }

  const handlePickModel = (value: string) => {
    setModel(value)
    setModelsOpen(false)
  }

  const handleSave = async () => {
    const api = window.electronAPI
    if (!api) return
    setSaving(true)
    setSaved(false)
    try {
      await api.saveAiConfig({ apiKey, endpoint, model })
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
      const result = await api.analyzeCrash("[Test] java.lang.OutOfMemoryError: Java heap space\n\tat net.minecraft.client.main.Main.main(Main.java:100)", crypto.randomUUID())
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
            <button
              type="button"
              onClick={handleLoadModels}
              disabled={modelsLoading || !apiKey}
              className="ml-auto flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-background border border-border text-xs font-medium text-muted-foreground hover:text-foreground hover:border-primary/40 transition-colors disabled:opacity-50"
            >
              {modelsLoading ? <IconLoader2 className="w-3.5 h-3.5 animate-spin" /> : <IconRefresh className="w-3.5 h-3.5" />}
              {models.length > 0 ? t("ai.modelsReload") : t("ai.modelsLoad")}
            </button>
          </div>

          <div className="relative">
            <input
              type="text"
              value={model}
              onChange={(e) => setModel(e.target.value)}
              placeholder="glm-5.3-flash"
              className="w-full px-4 py-2.5 pr-12 rounded-xl bg-background border border-border text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-primary transition-colors"
            />
            <button
              type="button"
              onClick={handleOpenModels}
              disabled={!apiKey}
              aria-label={t("ai.modelsLoad")}
              title={t("ai.modelsLoad")}
              className="absolute right-2 top-1/2 -translate-y-1/2 flex h-8 w-8 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted/60 hover:text-foreground transition-colors disabled:opacity-40"
            >
              <IconSearch className="w-4 h-4" />
            </button>
          </div>

          <p className="text-xs text-muted-foreground">{t("ai.modelDesc")}</p>
          {models.length > 0 && (
            <p className="text-xs text-muted-foreground/80">
              {t("ai.modelsFound", { count: models.length })}
            </p>
          )}

          <Dialog open={modelsOpen} onOpenChange={setModelsOpen}>
            <DialogContent className="max-w-lg p-0 gap-0">
              <DialogHeader className="px-5 pt-5 pb-3">
                <DialogTitle>{t("ai.modelsTitle")}</DialogTitle>
              </DialogHeader>

              <div className="px-5 pb-3 space-y-3">
                <div className="flex items-center gap-2">
                  <div className="relative flex-1">
                    <IconSearch className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" strokeWidth={2} />
                    <input
                      type="text"
                      value={modelQuery}
                      autoFocus
                      onChange={(e) => setModelQuery(e.target.value)}
                      placeholder={t("ai.modelsSearch")}
                      className="w-full pl-9 pr-3 py-2 rounded-xl bg-background border border-border text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-primary transition-colors"
                    />
                  </div>
                  <button
                    type="button"
                    onClick={() => void handleLoadModels()}
                    disabled={modelsLoading || !apiKey}
                    className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-muted/50 border border-border text-xs font-medium text-muted-foreground hover:text-foreground hover:border-primary/40 transition-colors disabled:opacity-50"
                  >
                    {modelsLoading ? <IconLoader2 className="w-3.5 h-3.5 animate-spin" /> : <IconRefresh className="w-3.5 h-3.5" />}
                    {t("ai.modelsReload")}
                  </button>
                </div>

                <div className="flex items-center justify-between gap-2 text-[11px] text-muted-foreground">
                  <span>
                    {modelsLoading
                      ? t("ai.modelsLoading")
                      : modelsError
                        ? t("ai.modelsError")
                        : t("ai.modelsFound", { count: filteredModels.length })}
                  </span>
                  <span className="max-w-[220px] truncate text-muted-foreground/70" title={t("ai.modelsHint", { endpoint: endpoint.replace(/\/+$/, "") })}>
                    {endpoint.replace(/\/+$/, "")}/models
                  </span>
                </div>
              </div>

              <div className="max-h-[340px] overflow-y-auto px-3 pb-3">
                {modelsLoading ? (
                  <div className="flex items-center justify-center py-10">
                    <IconLoader2 className="w-5 h-5 animate-spin text-muted-foreground" />
                  </div>
                ) : modelsError ? (
                  <p className="px-2 py-4 text-sm text-red-400 break-words">{modelsError}</p>
                ) : filteredModels.length === 0 ? (
                  <p className="px-2 py-4 text-sm text-muted-foreground">{t("ai.modelsEmpty")}</p>
                ) : (
                  <div className="flex flex-col gap-0.5">
                    {filteredModels.map((item) => (
                      <button
                        key={item}
                        type="button"
                        onClick={() => handlePickModel(item)}
                        className={cn(
                          "flex w-full items-center gap-2 rounded-xl px-3 py-2.5 text-left text-sm text-foreground transition-colors",
                          item === model ? "bg-primary/15 border border-primary/25" : "border border-transparent hover:bg-muted/60",
                        )}
                      >
                        <span className="min-w-0 flex-1 truncate">{item}</span>
                        {item === model && <IconCheck className="w-4 h-4 shrink-0 text-primary" strokeWidth={2} />}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </DialogContent>
          </Dialog>
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
