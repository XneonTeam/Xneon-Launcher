import { createPortal } from "react-dom"
import { useEffect, useMemo, useState } from "react"
import { IconArrowLeft, IconArrowRight, IconCheck, IconLoader2, IconRocket, IconX } from "@tabler/icons-react"
import { cn } from "@/lib/utils"
import { useAccounts } from "@/src/AccountsContext"
import { changeLanguage } from "@/src/i18n"
import { applyTheme, presetThemes } from "./settings/data"
import { ONBOARDING_COPY, type OnboardingLanguage } from "./onboarding/translations"
import { memoryToMb } from "@/lib/memory"
import { StepDots } from "./onboarding/step-dots"
import { StepLanguage } from "./onboarding/step-language"
import { StepTheme } from "./onboarding/step-theme"
import { StepImport } from "./onboarding/step-import"
import { StepAccount } from "./onboarding/step-account"
import { StepMemory } from "./onboarding/step-memory"
import { OfflineModal } from "./onboarding/offline-modal"

type OnboardingModalProps = {
  selectedTheme: string
  onSelectTheme: (themeId: string) => void
  onFinish: () => void
  onSkip: () => void
}

function normalizeMemoryValue(value: string | undefined, fallback: string) {
  const trimmed = value?.trim()
  if (!trimmed) return fallback
  const upper = trimmed.toUpperCase()
  if (upper.endsWith("G") || upper.endsWith("M")) return upper
  return `${upper}G`
}

function getAvatarUrl(account: { uuid?: string; type?: string }, username: string) {
  const isElyBy = account.type === "elyby"
  const value = isElyBy ? username : (account.uuid || username)
  const params = new URLSearchParams()
  const skinTypes: Record<string, string> = { elyby: "ely", xnskins: "xneon", microsoft: "microsoft" }
  const skinType = skinTypes[account.type || ""]
  if (skinType) params.set("skin_type", skinType)
  if (account.type === "offline") return "https://mcskinapi-three.vercel.app/avatar/Steve?skin_type=microsoft"
  if (params.has("skin_type")) return `https://mcskinapi-three.vercel.app/avatar/${encodeURIComponent(value)}?${params.toString()}`
  return `https://mcskinapi-three.vercel.app/avatar/${encodeURIComponent(value)}`
}

export function OnboardingModal({ selectedTheme, onSelectTheme, onFinish, onSkip }: OnboardingModalProps) {
  const { accounts, addAccount, activeAccount, setActiveAccount } = useAccounts()
  const [mounted, setMounted] = useState(false)
  const [stepIndex, setStepIndex] = useState(0)
  const [selectedLanguage, setSelectedLanguage] = useState<OnboardingLanguage>(() => {
    const stored = localStorage.getItem("language")
    return stored && stored in ONBOARDING_COPY ? stored as OnboardingLanguage : "ru"
  })
  const [offlineUsername, setOfflineUsername] = useState("")
  const [showOfflineAccountModal, setShowOfflineAccountModal] = useState(false)
  const [memoryMin, setMemoryMin] = useState("512M")
  const [memoryMax, setMemoryMax] = useState("4G")
  const [importableInstances, setImportableInstances] = useState<ImportableLauncherInstance[]>([])
  const [selectedImportIds, setSelectedImportIds] = useState<string[]>([])
  const [importingInstances, setImportingInstances] = useState(false)
  const [activeFilter, setActiveFilter] = useState<string | null>(null)
  const [importedCount, setImportedCount] = useState(0)
  const [elyByLoading, setElyByLoading] = useState(false)
  const [xnSkinsLoading, setXnSkinsLoading] = useState(false)
  const [microsoftLoading, setMicrosoftLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState("")

  useEffect(() => {
    setMounted(true)
    return () => setMounted(false)
  }, [])

  useEffect(() => {
    let cancelled = false
    const loadSettings = async () => {
      const api = window.electronAPI
      if (!api) return
      const [min, max, discoveredInstances] = await Promise.all([
        api.getSetting("memoryMin"),
        api.getSetting("memoryMax"),
        api.discoverImportableInstances?.() ?? Promise.resolve([]),
      ])
      if (cancelled) return
      setMemoryMin(normalizeMemoryValue(min, "512M"))
      setMemoryMax(normalizeMemoryValue(max, "4G"))
      setImportableInstances(discoveredInstances)
      setSelectedImportIds(discoveredInstances.map((i: ImportableLauncherInstance) => i.id))
    }
    void loadSettings()
    return () => { cancelled = true }
  }, [])

  const copy = ONBOARDING_COPY[selectedLanguage] ?? ONBOARDING_COPY.en
  const steps = copy.steps
  const anyLoginLoading = elyByLoading || xnSkinsLoading || microsoftLoading
  const isLastStep = stepIndex === steps.length - 1
  const currentStep = steps[stepIndex]
  const STEP_ICONS = [IconRocket, IconRocket, IconRocket, IconRocket, IconRocket]
  const CurrentStepIcon = STEP_ICONS[stepIndex] ?? IconRocket

  const canProceed = useMemo(() => {
    if (stepIndex === 0) return Boolean(selectedLanguage)
    if (stepIndex === 1) return Boolean(selectedTheme)
    if (stepIndex === 2) return true
    if (stepIndex === 3) return accounts.length > 0
    if (stepIndex === 4) {
      const minMb = memoryToMb(memoryMin)
      const maxMb = memoryToMb(memoryMax)
      return minMb > 0 && maxMb >= minMb
    }
    return true
  }, [accounts.length, memoryMax, memoryMin, selectedLanguage, selectedTheme, stepIndex])

  const persistLanguage = (languageId: OnboardingLanguage) => {
    setSelectedLanguage(languageId)
    changeLanguage(languageId)
    setError("")
  }

  const persistTheme = (themeId: string) => {
    onSelectTheme(themeId)
    localStorage.setItem("theme", themeId)
    const theme = presetThemes.find((t) => t.id === themeId)
    if (theme) applyTheme(theme)
    setError("")
  }

  const addOfflineAccount = () => {
    const username = offlineUsername.trim()
    if (!username) { setError(copy.errors.offlineUsername); return }
    addAccount({ id: `${Date.now()}`, type: "offline", username, isActive: accounts.length === 0 })
    setOfflineUsername("")
    setShowOfflineAccountModal(false)
    setError("")
  }

  const handleProviderLogin = async (provider: "elyby" | "xnskins" | "microsoft") => {
    setError("")
    const loadingSetters = { elyby: setElyByLoading, xnskins: setXnSkinsLoading, microsoft: setMicrosoftLoading }
    const loginFns = { elyby: "loginElyBy", xnskins: "loginXnSkins", microsoft: "loginMicrosoft" } as const
    loadingSetters[provider](true)
    try {
      const result = await (window.electronAPI as any)?.[loginFns[provider]]()
      if (result) addAccount({ id: result.id, type: provider, username: result.username, uuid: result.uuid, accessToken: result.accessToken, refreshToken: result.refreshToken, isActive: accounts.length === 0 })
    } catch (e) { setError(e instanceof Error ? e.message : copy.errors.loginFailed) }
    finally { loadingSetters[provider](false) }
  }

  const toggleImportSelection = (instanceId: string) => {
    setSelectedImportIds((c) => c.includes(instanceId) ? c.filter((id) => id !== instanceId) : [...c, instanceId])
  }

  const filterSource = (source: string) => {
    setActiveFilter((prev) => prev === source ? null : source)
  }

  const importSelectedInstances = async () => {
    if (!selectedImportIds.length) return
    setImportingInstances(true)
    setError("")
    try {
      const api = window.electronAPI
      if (!api) return
      const importFn = api.importLauncherInstances ?? api.importGdLauncherInstances
      if (!importFn) return
      const result = await importFn.call(api, selectedImportIds)
      if (!result.success) { setError(result.error || copy.errors.importFailed); return }
      setImportedCount(result.imported)
    } catch (e) { setError(e instanceof Error ? e.message : copy.errors.importFailed) }
    finally { setImportingInstances(false) }
  }

  const persistLauncherSettings = async () => {
    const api = window.electronAPI
    if (!api) return
    await Promise.all([
      api.setSetting("memoryMin", normalizeMemoryValue(memoryMin, "512M")),
      api.setSetting("memoryMax", normalizeMemoryValue(memoryMax, "4G")),
    ])
  }

  const handleContinue = async () => {
    if (!canProceed) return
    if (!isLastStep) { setError(""); setStepIndex((c) => c + 1); return }
    setSaving(true)
    setError("")
    try { await persistLauncherSettings(); onFinish() }
    catch (e) { setError(e instanceof Error ? e.message : copy.errors.settingsFailed) }
    finally { setSaving(false) }
  }

  const handleBack = () => { if (stepIndex > 0) { setError(""); setStepIndex((c) => c - 1) } }

  const renderStepContent = () => {
    switch (stepIndex) {
      case 0: return <StepLanguage selectedLanguage={selectedLanguage} copy={copy} onSelect={persistLanguage} />
      case 1: return <StepTheme selectedTheme={selectedTheme} onSelect={persistTheme} />
      case 2: return <StepImport copy={copy} importableInstances={importableInstances} selectedImportIds={selectedImportIds} activeFilter={activeFilter} importingInstances={importingInstances} importedCount={importedCount} onToggle={toggleImportSelection} onFilterSource={filterSource} onImport={importSelectedInstances} />
      case 3: return <StepAccount copy={copy} accounts={accounts as any} anyLoginLoading={anyLoginLoading} getAvatarUrl={getAvatarUrl} setActiveAccount={setActiveAccount} onProviderLogin={handleProviderLogin} onOpenOffline={() => setShowOfflineAccountModal(true)} />
      case 4: return <StepMemory copy={copy} memoryMin={memoryMin} memoryMax={memoryMax} onChange={(min, max) => { setMemoryMin(min); setMemoryMax(max) }} onError={setError} />
      default: return null
    }
  }

  if (!mounted) return null

  return createPortal(
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-background/72 px-4 py-5 backdrop-blur-sm">
      <div className="mx-auto flex h-[min(680px,calc(100vh-6rem))] w-full max-w-[980px] flex-col overflow-hidden rounded-2xl border border-border bg-card shadow-2xl">
        <div className="border-b border-border px-5 py-4">
          <div className="flex items-start justify-between gap-4">
            <div className="flex min-w-0 items-start gap-3">
              <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-primary/15 text-primary shadow-[0_0_16px_var(--glow-primary)]">
                <CurrentStepIcon className="h-5 w-5" strokeWidth={1.8} />
              </div>
              <div className="min-w-0">
                <h2 className="text-xl font-semibold text-foreground">Первоначальная настройка</h2>
                <p className="mt-1 text-sm text-muted-foreground">{currentStep.description}</p>
              </div>
            </div>
            <button type="button" onClick={onSkip}
              className="inline-flex h-10 shrink-0 items-center gap-2 rounded-xl border border-border bg-card px-3 text-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground">
              <IconX className="h-4 w-4" strokeWidth={1.8} /> {copy.skip}
            </button>
          </div>
          <div className="mt-4 h-2 overflow-hidden rounded-full bg-muted">
            <div className="h-full rounded-full bg-primary transition-all duration-300"
              style={{ width: `${((stepIndex + 1) / steps.length) * 100}%` }} />
          </div>
          <div className="mt-3 flex items-center justify-between gap-3">
            <div className="text-sm text-muted-foreground">
              Шаг {stepIndex + 1} из {steps.length}
            </div>
          </div>
          <div className="mt-4">
            <StepDots steps={steps} stepIndex={stepIndex} onSelectStep={(i) => { setError(""); setStepIndex(i) }} />
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-5">
          <div className="mx-auto max-w-5xl">
            {renderStepContent()}
            {error && (
              <div className="mt-5 rounded-xl border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive">
                {error}
              </div>
            )}
          </div>
        </div>

        {showOfflineAccountModal && (
          <OfflineModal copy={copy} offlineUsername={offlineUsername} onUsernameChange={setOfflineUsername} onAdd={addOfflineAccount} onClose={() => setShowOfflineAccountModal(false)} />
        )}

        <div className="flex items-center justify-between gap-3 border-t border-border px-5 py-4">
          <button type="button" onClick={handleBack} disabled={stepIndex === 0 || saving}
            className="inline-flex h-12 items-center justify-center gap-2 rounded-xl border border-border bg-card px-5 text-foreground transition-colors hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50">
            <IconArrowLeft className="h-4 w-4" strokeWidth={1.9} /> {copy.back}
          </button>
          <div className="flex items-center gap-3">
            <button type="button" onClick={() => void handleContinue()} disabled={!canProceed || anyLoginLoading || saving}
              className="inline-flex h-12 items-center justify-center gap-2 rounded-xl bg-primary px-6 font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-60">
              {saving ? <IconLoader2 className="h-4 w-4 animate-spin" strokeWidth={2} /> : null}
              {isLastStep ? copy.finish : copy.next}
              {!saving && <IconArrowRight className="h-4 w-4" strokeWidth={1.9} />}
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body
  )
}
