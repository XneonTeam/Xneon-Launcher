import { createPortal } from "react-dom"
import { useEffect, useMemo, useState } from "react"
import { IconArrowLeft, IconArrowRight, IconCheck, IconCpu, IconDownload, IconLanguage, IconLoader2, IconPalette, IconRocket, IconShieldCheck, IconUser, IconUserMinus, IconX } from "@tabler/icons-react"
import { cn } from "@/lib/utils"
import { useAccounts } from "@/src/AccountsContext"
import { changeLanguage } from "@/src/i18n"
import { applyTheme, presetThemes } from "./settings/data"
import { languages } from "./settings/settings-language-about"

type OnboardingModalProps = {
  selectedTheme: string
  onSelectTheme: (themeId: string) => void
  onFinish: () => void
  onSkip: () => void
}

type InjectorMode = "disabled" | "authlib" | "retroauth"
type OnboardingLanguage = "ru" | "en" | "uk" | "de" | "es"

type OnboardingCopy = {
  steps: Array<{ title: string; description: string }>
  skip: string
  back: string
  next: string
  finish: string
  stepCounter: string
  importFound: string
  importSource: string
  importButton: string
  importingButton: string
  importEmpty: string
  importResult: string
  importNotStarted: string
  importCompleted: string
  modsLabel: string
  resourcepacksLabel: string
  shadersLabel: string
  accountOfflineTitle: string
  accountNicknameLabel: string
  accountOfflinePlaceholder: string
  accountOfflineAdd: string
  accountSelected: string
  accountSelect: string
  accountMissing: string
  memoryMin: string
  memoryMax: string
  memoryHint: string
  injectorSummary: string
  summaryNoAccount: string
  injectorModes: Array<{ id: InjectorMode; title: string; description: string }>
  sourceNames: Record<string, string>
  sourcePaths: Record<string, string>
  errors: {
    offlineUsername: string
    loginFailed: string
    importFailed: string
    settingsFailed: string
  }
}

const ONBOARDING_COPY: Record<OnboardingLanguage, OnboardingCopy> = {
  ru: {
    steps: [
      { title: "Язык", description: "Сначала выбери язык интерфейса." },
      { title: "Тема", description: "Теперь выбери визуальный стиль лаунчера." },
      { title: "Импорт", description: "Импортируй найденные сборки из другого лаунчера." },
      { title: "Аккаунт", description: "Добавь хотя бы один аккаунт прямо здесь." },
      { title: "Память", description: "Укажи, сколько RAM выделять игре." },
      { title: "Инжектор", description: "Выбери режим авторизации по умолчанию." },
    ],
    skip: "Пропустить",
    back: "Назад",
    next: "Далее",
    finish: "Завершить",
    stepCounter: "Шаг {{current}} из {{total}}",
    importFound: "Найдено: {{count}}.",
    importSource: "Источник:",
    importButton: "Импортировать",
    importingButton: "Импорт...",
    importEmpty: "Сборки для импорта не найдены. Поддерживаются X Launcher, GDLauncher, Prism Launcher и AstralRinth.",
    importResult: "Результат импорта",
    importNotStarted: "Импорт ещё не запускался",
    importCompleted: "Импортировано сборок: {{count}}",
    modsLabel: "модов",
    resourcepacksLabel: "РП",
    shadersLabel: "шейдеров",
    accountOfflineTitle: "Или оффлайн-аккаунт",
    accountNicknameLabel: "Никнейм",
    accountOfflinePlaceholder: "Введите ник",
    accountOfflineAdd: "Добавить",
    accountSelected: "Выбранный аккаунт",
    accountSelect: "Выбрать",
    accountMissing: "Аккаунт пока не добавлен",
    memoryMin: "Минимум, GB",
    memoryMax: "Максимум, GB",
    memoryHint: "Минимум не должен быть больше максимума. Обычный стартовый вариант: `2G` и `4G`.",
    injectorSummary: "Итог",
    summaryNoAccount: "без аккаунта",
    injectorModes: [
      { id: "retroauth", title: "RetroAuth", description: "Рекомендуемый режим по умолчанию для совместимости и HD-скинов." },
      { id: "authlib", title: "Authlib Injector", description: "Классический authlib-режим для совместимых серверов и сборок." },
      { id: "disabled", title: "Отключено", description: "Запуск без дополнительного инжектора." },
    ],
    sourceNames: { gdlauncher: "GDLauncher", prism: "Prism Launcher", astralrinth: "AstralRinth", xlauncher: "X Launcher" },
    sourcePaths: {
      xlauncher: "~/.minecraftx/instances",
      gdlauncher: "~/.local/share/gdlauncher_carbon/data/instances",
      prism: "~/.var/app/org.prismlauncher.PrismLauncher/... или ~/.local/share/PrismLauncher",
      astralrinth: "~/.local/share/AstralRinthApp/profiles",
    },
    errors: {
      offlineUsername: "Введи ник для оффлайн-аккаунта.",
      loginFailed: "Не удалось выполнить вход.",
      importFailed: "Не удалось импортировать сборки.",
      settingsFailed: "Не удалось сохранить настройки.",
    },
  },
  en: {
    steps: [
      { title: "Language", description: "Choose the launcher interface language first." },
      { title: "Theme", description: "Pick the launcher visual style." },
      { title: "Import", description: "Import detected instances from another launcher." },
      { title: "Account", description: "Add at least one account right here." },
      { title: "Memory", description: "Choose how much RAM the game should use." },
      { title: "Injector", description: "Select the default authentication mode." },
    ],
    skip: "Skip",
    back: "Back",
    next: "Next",
    finish: "Finish",
    stepCounter: "Step {{current}} of {{total}}",
    importFound: "Found: {{count}}.",
    importSource: "Source:",
    importButton: "Import",
    importingButton: "Importing...",
    importEmpty: "No instances found for import. X Launcher, GDLauncher, Prism Launcher, and AstralRinth are supported.",
    importResult: "Import result",
    importNotStarted: "Import has not been started yet",
    importCompleted: "Imported instances: {{count}}",
    modsLabel: "mods",
    resourcepacksLabel: "RPs",
    shadersLabel: "shaders",
    accountOfflineTitle: "Or add an offline account",
    accountNicknameLabel: "Nickname",
    accountOfflinePlaceholder: "Enter username",
    accountOfflineAdd: "Add",
    accountSelected: "Selected account",
    accountSelect: "Select",
    accountMissing: "No account added yet",
    memoryMin: "Minimum, GB",
    memoryMax: "Maximum, GB",
    memoryHint: "Minimum must not be greater than maximum. A common starting point is `2G` and `4G`.",
    injectorSummary: "Summary",
    summaryNoAccount: "no account",
    injectorModes: [
      { id: "retroauth", title: "RetroAuth", description: "Recommended default mode for compatibility and HD skins." },
      { id: "authlib", title: "Authlib Injector", description: "Classic authlib mode for compatible servers and modpacks." },
      { id: "disabled", title: "Disabled", description: "Launch without an additional injector." },
    ],
    sourceNames: { gdlauncher: "GDLauncher", prism: "Prism Launcher", astralrinth: "AstralRinth", xlauncher: "X Launcher" },
    sourcePaths: {
      xlauncher: "~/.minecraftx/instances",
      gdlauncher: "~/.local/share/gdlauncher_carbon/data/instances",
      prism: "~/.var/app/org.prismlauncher.PrismLauncher/... or ~/.local/share/PrismLauncher",
      astralrinth: "~/.local/share/AstralRinthApp/profiles",
    },
    errors: {
      offlineUsername: "Enter a username for the offline account.",
      loginFailed: "Sign-in failed.",
      importFailed: "Failed to import instances.",
      settingsFailed: "Failed to save settings.",
    },
  },
  uk: {
    steps: [
      { title: "Мова", description: "Спочатку обери мову інтерфейсу лаунчера." },
      { title: "Тема", description: "Тепер обери візуальний стиль лаунчера." },
      { title: "Імпорт", description: "Імпортуй знайдені збірки з іншого лаунчера." },
      { title: "Акаунт", description: "Додай хоча б один акаунт прямо тут." },
      { title: "Пам'ять", description: "Вкажи, скільки RAM виділяти грі." },
      { title: "Інжектор", description: "Обери типовий режим авторизації." },
    ],
    skip: "Пропустити",
    back: "Назад",
    next: "Далі",
    finish: "Завершити",
    stepCounter: "Крок {{current}} з {{total}}",
    importFound: "Знайдено: {{count}}.",
    importSource: "Джерело:",
    importButton: "Імпортувати",
    importingButton: "Імпорт...",
    importEmpty: "Збірки для імпорту не знайдено. Підтримуються X Launcher, GDLauncher, Prism Launcher і AstralRinth.",
    importResult: "Результат імпорту",
    importNotStarted: "Імпорт ще не запускався",
    importCompleted: "Імпортовано збірок: {{count}}",
    modsLabel: "модів",
    resourcepacksLabel: "РП",
    shadersLabel: "шейдерів",
    accountOfflineTitle: "Або офлайн-акаунт",
    accountNicknameLabel: "Нікнейм",
    accountOfflinePlaceholder: "Введіть нік",
    accountOfflineAdd: "Додати",
    accountSelected: "Вибраний акаунт",
    accountSelect: "Обрати",
    accountMissing: "Акаунт ще не додано",
    memoryMin: "Мінімум, GB",
    memoryMax: "Максимум, GB",
    memoryHint: "Мінімум не повинен бути більшим за максимум. Звичний стартовий варіант: `2G` і `4G`.",
    injectorSummary: "Підсумок",
    summaryNoAccount: "без акаунта",
    injectorModes: [
      { id: "retroauth", title: "RetroAuth", description: "Рекомендований режим за замовчуванням для сумісності та HD-скінів." },
      { id: "authlib", title: "Authlib Injector", description: "Класичний authlib-режим для сумісних серверів і збірок." },
      { id: "disabled", title: "Вимкнено", description: "Запуск без додаткового інжектора." },
    ],
    sourceNames: { gdlauncher: "GDLauncher", prism: "Prism Launcher", astralrinth: "AstralRinth", xlauncher: "X Launcher" },
    sourcePaths: {
      xlauncher: "~/.minecraftx/instances",
      gdlauncher: "~/.local/share/gdlauncher_carbon/data/instances",
      prism: "~/.var/app/org.prismlauncher.PrismLauncher/... або ~/.local/share/PrismLauncher",
      astralrinth: "~/.local/share/AstralRinthApp/profiles",
    },
    errors: {
      offlineUsername: "Введи нік для офлайн-акаунта.",
      loginFailed: "Не вдалося виконати вхід.",
      importFailed: "Не вдалося імпортувати збірки.",
      settingsFailed: "Не вдалося зберегти налаштування.",
    },
  },
  de: {
    steps: [
      { title: "Sprache", description: "Wähle zuerst die Sprache der Launcher-Oberfläche." },
      { title: "Thema", description: "Wähle jetzt den visuellen Stil des Launchers." },
      { title: "Import", description: "Importiere gefundene Instanzen aus einem anderen Launcher." },
      { title: "Konto", description: "Füge direkt hier mindestens ein Konto hinzu." },
      { title: "Speicher", description: "Lege fest, wie viel RAM das Spiel nutzen soll." },
      { title: "Injector", description: "Wähle den Standardmodus für die Anmeldung." },
    ],
    skip: "Überspringen",
    back: "Zurück",
    next: "Weiter",
    finish: "Fertig",
    stepCounter: "Schritt {{current}} von {{total}}",
    importFound: "Gefunden: {{count}}.",
    importSource: "Quelle:",
    importButton: "Importieren",
    importingButton: "Importiere...",
    importEmpty: "Keine Instanzen zum Import gefunden. X Launcher, GDLauncher, Prism Launcher und AstralRinth werden unterstützt.",
    importResult: "Importergebnis",
    importNotStarted: "Import wurde noch nicht gestartet",
    importCompleted: "Importierte Instanzen: {{count}}",
    modsLabel: "Mods",
    resourcepacksLabel: "RPs",
    shadersLabel: "Shader",
    accountOfflineTitle: "Oder Offline-Konto",
    accountNicknameLabel: "Nickname",
    accountOfflinePlaceholder: "Namen eingeben",
    accountOfflineAdd: "Hinzufügen",
    accountSelected: "Ausgewähltes Konto",
    accountSelect: "Auswählen",
    accountMissing: "Noch kein Konto hinzugefügt",
    memoryMin: "Minimum, GB",
    memoryMax: "Maximum, GB",
    memoryHint: "Das Minimum darf nicht größer als das Maximum sein. Ein üblicher Startwert ist `2G` und `4G`.",
    injectorSummary: "Zusammenfassung",
    summaryNoAccount: "kein Konto",
    injectorModes: [
      { id: "retroauth", title: "RetroAuth", description: "Empfohlener Standardmodus für Kompatibilität und HD-Skins." },
      { id: "authlib", title: "Authlib Injector", description: "Klassischer authlib-Modus für kompatible Server und Modpacks." },
      { id: "disabled", title: "Deaktiviert", description: "Start ohne zusätzlichen Injector." },
    ],
    sourceNames: { gdlauncher: "GDLauncher", prism: "Prism Launcher", astralrinth: "AstralRinth", xlauncher: "X Launcher" },
    sourcePaths: {
      xlauncher: "~/.minecraftx/instances",
      gdlauncher: "~/.local/share/gdlauncher_carbon/data/instances",
      prism: "~/.var/app/org.prismlauncher.PrismLauncher/... oder ~/.local/share/PrismLauncher",
      astralrinth: "~/.local/share/AstralRinthApp/profiles",
    },
    errors: {
      offlineUsername: "Gib einen Namen für das Offline-Konto ein.",
      loginFailed: "Anmeldung fehlgeschlagen.",
      importFailed: "Instanzen konnten nicht importiert werden.",
      settingsFailed: "Einstellungen konnten nicht gespeichert werden.",
    },
  },
  es: {
    steps: [
      { title: "Idioma", description: "Primero elige el idioma de la interfaz del launcher." },
      { title: "Tema", description: "Ahora elige el estilo visual del launcher." },
      { title: "Importar", description: "Importa las instancias detectadas desde otro launcher." },
      { title: "Cuenta", description: "Añade al menos una cuenta aquí mismo." },
      { title: "Memoria", description: "Define cuánta RAM debe usar el juego." },
      { title: "Injector", description: "Elige el modo de autenticación predeterminado." },
    ],
    skip: "Omitir",
    back: "Atrás",
    next: "Siguiente",
    finish: "Finalizar",
    stepCounter: "Paso {{current}} de {{total}}",
    importFound: "Encontradas: {{count}}.",
    importSource: "Origen:",
    importButton: "Importar",
    importingButton: "Importando...",
    importEmpty: "No se encontraron instancias para importar. Se admiten X Launcher, GDLauncher, Prism Launcher y AstralRinth.",
    importResult: "Resultado de la importación",
    importNotStarted: "La importación aún no se ha iniciado",
    importCompleted: "Instancias importadas: {{count}}",
    modsLabel: "mods",
    resourcepacksLabel: "RPs",
    shadersLabel: "shaders",
    accountOfflineTitle: "O cuenta offline",
    accountNicknameLabel: "Apodo",
    accountOfflinePlaceholder: "Introduce un nombre",
    accountOfflineAdd: "Añadir",
    accountSelected: "Cuenta seleccionada",
    accountSelect: "Seleccionar",
    accountMissing: "Todavía no se ha añadido una cuenta",
    memoryMin: "Mínimo, GB",
    memoryMax: "Máximo, GB",
    memoryHint: "El mínimo no debe ser mayor que el máximo. Un punto de partida habitual es `2G` y `4G`.",
    injectorSummary: "Resumen",
    summaryNoAccount: "sin cuenta",
    injectorModes: [
      { id: "retroauth", title: "RetroAuth", description: "Modo predeterminado recomendado para compatibilidad y skins HD." },
      { id: "authlib", title: "Authlib Injector", description: "Modo authlib clásico para servidores y modpacks compatibles." },
      { id: "disabled", title: "Desactivado", description: "Iniciar sin un injector adicional." },
    ],
    sourceNames: { gdlauncher: "GDLauncher", prism: "Prism Launcher", astralrinth: "AstralRinth", xlauncher: "X Launcher" },
    sourcePaths: {
      xlauncher: "~/.minecraftx/instances",
      gdlauncher: "~/.local/share/gdlauncher_carbon/data/instances",
      prism: "~/.var/app/org.prismlauncher.PrismLauncher/... o ~/.local/share/PrismLauncher",
      astralrinth: "~/.local/share/AstralRinthApp/profiles",
    },
    errors: {
      offlineUsername: "Introduce un nombre para la cuenta offline.",
      loginFailed: "No se pudo iniciar sesión.",
      importFailed: "No se pudieron importar las instancias.",
      settingsFailed: "No se pudieron guardar los ajustes.",
    },
  },
}

function normalizeMemoryValue(value: string | undefined, fallback: string) {
  const trimmed = value?.trim()
  if (!trimmed) return fallback
  return trimmed.toUpperCase().endsWith("G") ? trimmed.toUpperCase() : `${trimmed}G`
}

function parseMemoryNumber(value: string) {
  return Number.parseInt(value.replace(/[^\d]/g, ""), 10)
}

function formatMessage(template: string, values: Record<string, string | number>) {
  return template.replace(/\{\{(\w+)\}\}/g, (_, key: string) => String(values[key] ?? ""))
}

function getAvatarUrl(account: { uuid?: string; type?: string }, username: string) {
  const isElyBy = account.type === "elyby"
  const value = isElyBy ? username : (account.uuid || username)
  const params = new URLSearchParams()
  if (isElyBy) {
    params.set("skin_type", "ely")
  } else if (account.type === "xnskins") {
    params.set("skin_type", "xneon")
  } else if (account.type === "microsoft") {
    params.set("skin_type", "microsoft")
  } else if (account.type === "offline") {
    return "https://mcskinapi-three.vercel.app/avatar/Steve?skin_type=microsoft"
  }

  if (params.has("skin_type")) {
    return `https://mcskinapi-three.vercel.app/avatar/${encodeURIComponent(value)}?${params.toString()}`
  }

  return `https://mcskinapi-three.vercel.app/avatar/${encodeURIComponent(value)}`
}

type LauncherSource = "gdlauncher" | "prism" | "multimc" | "polymc" | "astralrinth" | "xlauncher"

const LAUNCHER_SOURCE_ICON_SRC: Record<LauncherSource, string> = {
  prism: "/launcher-icons/prism.png",
  gdlauncher: "/launcher-icons/gdlauncher.png",
  multimc: "/launcher-icons/multimc.svg",
  polymc: "/launcher-icons/polymc.svg",
  xlauncher: "/launcher-icons/xlauncher.svg",
  astralrinth: "/launcher-icons/astralrinth.webp",
}

function LauncherSourceIcon({ source, className }: { source: LauncherSource; className?: string }) {
  return (
    <img
      src={LAUNCHER_SOURCE_ICON_SRC[source]}
      alt=""
      className={cn("object-contain", className)}
      loading="lazy"
      decoding="async"
      aria-hidden="true"
    />
  )
}

const STEP_ICONS = [IconLanguage, IconPalette, IconDownload, IconUser, IconCpu, IconShieldCheck]

function getStepState(index: number, currentIndex: number) {
  if (index < currentIndex) return "done"
  if (index === currentIndex) return "current"
  return "upcoming"
}

export function OnboardingModal({
  selectedTheme,
  onSelectTheme,
  onFinish,
  onSkip,
}: OnboardingModalProps) {
  const { accounts, addAccount, activeAccount, setActiveAccount } = useAccounts()
  const [mounted, setMounted] = useState(false)
  const [stepIndex, setStepIndex] = useState(0)
  const [selectedLanguage, setSelectedLanguage] = useState<OnboardingLanguage>(() => {
    const stored = localStorage.getItem("language")
    return stored && stored in ONBOARDING_COPY ? stored as OnboardingLanguage : "ru"
  })
  const [offlineUsername, setOfflineUsername] = useState("")
  const [showOfflineAccountModal, setShowOfflineAccountModal] = useState(false)
  const [memoryMin, setMemoryMin] = useState("2G")
  const [memoryMax, setMemoryMax] = useState("4G")
  const [injectorMode, setInjectorMode] = useState<InjectorMode>("retroauth")
  const [importableInstances, setImportableInstances] = useState<ImportableLauncherInstance[]>([])
  const [selectedImportIds, setSelectedImportIds] = useState<string[]>([])
  const [importingInstances, setImportingInstances] = useState(false)
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

      const [min, max, authlibEnabled, retroauthEnabled, discoveredInstances] = await Promise.all([
        api.getSetting("memoryMin"),
        api.getSetting("memoryMax"),
        api.getSetting("authlibInjectorEnabled"),
        api.getSetting("retroauthInjectorEnabled"),
        api.discoverImportableInstances?.() ?? Promise.resolve([]),
      ])

      if (cancelled) return

      setMemoryMin(normalizeMemoryValue(min, "2G"))
      setMemoryMax(normalizeMemoryValue(max, "4G"))

      if (authlibEnabled === "true") {
        setInjectorMode("authlib")
      } else if (retroauthEnabled === "true") {
        setInjectorMode("retroauth")
      } else {
        setInjectorMode("disabled")
      }

      setImportableInstances(discoveredInstances)
      setSelectedImportIds(discoveredInstances.map((instance) => instance.id))
    }

    void loadSettings()
    return () => { cancelled = true }
  }, [])

  const copy = ONBOARDING_COPY[selectedLanguage] ?? ONBOARDING_COPY.en
  const steps = copy.steps
  const anyLoginLoading = elyByLoading || xnSkinsLoading || microsoftLoading
  const isLastStep = stepIndex === steps.length - 1
  const currentStep = steps[stepIndex]
  const CurrentStepIcon = STEP_ICONS[stepIndex] ?? IconRocket
  const selectedLanguageMeta = languages.find((item) => item.id === selectedLanguage)
  const selectedThemeMeta = presetThemes.find((item) => item.id === selectedTheme)
  const selectedImportInstances = importableInstances.filter((instance) => selectedImportIds.includes(instance.id))
  const discoveredSourceCount = new Set(importableInstances.map((instance) => instance.source)).size
  const memoryPresets = [
    { id: "starter", min: "2G", max: "4G" },
    { id: "balanced", min: "4G", max: "6G" },
    { id: "heavy", min: "6G", max: "8G" },
  ]
  const providerCards = [
    {
      id: "microsoft" as const,
      title: "Microsoft",
      description: "Official Mojang / Microsoft sign-in.",
      active: microsoftLoading,
      accent: "from-sky-500/20 to-cyan-400/5",
      color: "#2563EB",
    },
    {
      id: "elyby" as const,
      title: "Ely.By",
      description: "Sign in with an Ely.By account.",
      active: elyByLoading,
      accent: "from-emerald-500/20 to-lime-400/5",
      color: "#217e5c",
    },
    {
      id: "xnskins" as const,
      title: "XN Skins",
      description: "Sign in with XN Skins support.",
      active: xnSkinsLoading,
      accent: "from-fuchsia-500/20 to-orange-400/5",
      color: "#f97316",
    },
  ]
  const accountTypeCards = [
    ...providerCards,
    {
      id: "offline" as const,
      title: copy.accountOfflineTitle,
      description: copy.accountOfflinePlaceholder,
      active: false,
      accent: "from-zinc-500/10 to-zinc-400/5",
      color: "#757575",
    },
  ]

  const canProceed = useMemo(() => {
    if (stepIndex === 0) return Boolean(selectedLanguage)
    if (stepIndex === 1) return Boolean(selectedTheme)
    if (stepIndex === 2) return true
    if (stepIndex === 3) return accounts.length > 0
    if (stepIndex === 4) {
      const min = parseMemoryNumber(memoryMin)
      const max = parseMemoryNumber(memoryMax)
      return Number.isFinite(min) && Number.isFinite(max) && min > 0 && max >= min
    }
    if (stepIndex === 5) return Boolean(injectorMode)
    return true
  }, [accounts.length, injectorMode, memoryMax, memoryMin, selectedLanguage, selectedTheme, stepIndex])

  const persistLanguage = (languageId: OnboardingLanguage) => {
    setSelectedLanguage(languageId)
    changeLanguage(languageId)
    setError("")
  }

  const persistTheme = (themeId: string) => {
    onSelectTheme(themeId)
    localStorage.setItem("theme", themeId)
    const theme = presetThemes.find((item) => item.id === themeId)
    if (theme) applyTheme(theme)
    setError("")
  }

  const addOfflineAccount = () => {
    const username = offlineUsername.trim()
    if (!username) {
      setError(copy.errors.offlineUsername)
      return
    }

    addAccount({
      id: `${Date.now()}`,
      type: "offline",
      username,
      isActive: accounts.length === 0,
    })
    setOfflineUsername("")
    setShowOfflineAccountModal(false)
    setError("")
  }

  const handleProviderLogin = async (provider: "elyby" | "xnskins" | "microsoft") => {
    setError("")

    try {
      if (provider === "elyby") {
        setElyByLoading(true)
        const result = await window.electronAPI?.loginElyBy()
        if (result) {
          addAccount({
            id: result.id,
            type: "elyby",
            username: result.username,
            uuid: result.uuid,
            accessToken: result.accessToken,
            refreshToken: result.refreshToken,
            isActive: accounts.length === 0,
          })
        }
      } else if (provider === "xnskins") {
        setXnSkinsLoading(true)
        const result = await window.electronAPI?.loginXnSkins()
        if (result) {
          addAccount({
            id: result.id,
            type: "xnskins",
            username: result.username,
            uuid: result.uuid,
            accessToken: result.accessToken,
            refreshToken: result.refreshToken,
            isActive: accounts.length === 0,
          })
        }
      } else {
        setMicrosoftLoading(true)
        const result = await window.electronAPI?.loginMicrosoft()
        if (result) {
          addAccount({
            id: result.id,
            type: "microsoft",
            username: result.username,
            uuid: result.uuid,
            accessToken: result.accessToken,
            refreshToken: result.refreshToken,
            isActive: accounts.length === 0,
          })
        }
      }
    } catch (loginError) {
      const message = loginError instanceof Error ? loginError.message : copy.errors.loginFailed
      setError(message)
    } finally {
      setElyByLoading(false)
      setXnSkinsLoading(false)
      setMicrosoftLoading(false)
    }
  }

  const persistLauncherSettings = async () => {
    const api = window.electronAPI
    if (!api) return

    const normalizedMin = normalizeMemoryValue(memoryMin, "2G")
    const normalizedMax = normalizeMemoryValue(memoryMax, "4G")

    await Promise.all([
      api.setSetting("memoryMin", normalizedMin),
      api.setSetting("memoryMax", normalizedMax),
      api.setSetting("authlibInjectorEnabled", injectorMode === "authlib" ? "true" : "false"),
      api.setSetting("retroauthInjectorEnabled", injectorMode === "retroauth" ? "true" : "false"),
    ])
  }

  const toggleImportSelection = (instanceId: string) => {
    setSelectedImportIds((current) =>
      current.includes(instanceId)
        ? current.filter((id) => id !== instanceId)
        : [...current, instanceId]
    )
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
      if (!result.success) {
        setError(result.error || copy.errors.importFailed)
        return
      }
      setImportedCount(result.imported)
    } catch (importError) {
      const message = importError instanceof Error ? importError.message : copy.errors.importFailed
      setError(message)
    } finally {
      setImportingInstances(false)
    }
  }

  const handleContinue = async () => {
    if (!canProceed) return

    if (!isLastStep) {
      setError("")
      setStepIndex((current) => current + 1)
      return
    }

    setSaving(true)
    setError("")

    try {
      await persistLauncherSettings()
      onFinish()
    } catch (saveError) {
      const message = saveError instanceof Error ? saveError.message : copy.errors.settingsFailed
      setError(message)
    } finally {
      setSaving(false)
    }
  }

  const handleBack = () => {
    if (stepIndex === 0) return
    setError("")
    setStepIndex((current) => current - 1)
  }

  const renderStepDots = () => (
    <div className="grid gap-2 sm:grid-cols-3 xl:grid-cols-6">
      {steps.map((step, index) => {
        const StepIcon = STEP_ICONS[index] ?? IconRocket
        const state = getStepState(index, stepIndex)

        return (
          <button
            key={step.title}
            type="button"
            onClick={() => {
              setError("")
              setStepIndex(index)
            }}
            className={cn(
              "flex items-center gap-3 rounded-xl border px-3 py-3 text-left transition-all duration-200",
              state === "current"
                ? "border-primary bg-primary/10 shadow-[0_0_16px_var(--glow-primary)]"
                : state === "done"
                  ? "border-border bg-muted/30 hover:border-primary/35"
                  : "border-border bg-card hover:border-primary/35 hover:bg-muted/20"
            )}
          >
            <div
              className={cn(
                "flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border",
                state === "current"
                  ? "border-primary/30 bg-primary/15 text-primary"
                  : state === "done"
                    ? "border-emerald-400/20 bg-emerald-500/10 text-emerald-300"
                    : "border-border bg-background text-muted-foreground"
              )}
            >
              {state === "done" ? <IconCheck className="h-4 w-4" strokeWidth={2.2} /> : <StepIcon className="h-4 w-4" strokeWidth={1.9} />}
            </div>
            <div className="min-w-0">
              <div className="truncate text-sm font-medium text-foreground">{step.title}</div>
            </div>
          </button>
        )
      })}
    </div>
  )

  const renderStepContent = () => {
    if (stepIndex === 0) {
      return (
        <div className="space-y-5">
          <div className="grid gap-3 lg:grid-cols-2">
            {languages.map((language) => (
              <button
                key={language.id}
                type="button"
                onClick={() => persistLanguage(language.id as OnboardingLanguage)}
                className={cn(
                  "group relative overflow-hidden rounded-2xl border p-4 text-left transition-all duration-200",
                  selectedLanguage === language.id
                    ? "border-primary bg-primary/10 shadow-[0_0_18px_var(--glow-primary)]"
                    : "border-border bg-card hover:border-primary/40"
                )}
              >
                <div className="relative flex items-center gap-4">
                  <div className="rounded-xl border border-border bg-background p-3">{language.flagSvg}</div>
                  <div className="min-w-0 flex-1">
                    <div className="text-base font-semibold text-foreground">{language.nativeName}</div>
                    <div className="mt-1 text-sm text-muted-foreground">{language.name}</div>
                  </div>
                  <div
                    className={cn(
                      "flex h-8 w-8 items-center justify-center rounded-full border transition-colors",
                      selectedLanguage === language.id
                        ? "border-primary bg-primary text-primary-foreground"
                        : "border-border bg-background text-transparent"
                    )}
                  >
                    <IconCheck className="h-4 w-4" strokeWidth={2.4} />
                  </div>
                </div>
              </button>
            ))}
          </div>
        </div>
      )
    }

    if (stepIndex === 1) {
      return (
        <div className="space-y-5">
          <div className="grid grid-cols-2 gap-4">
            {presetThemes.map((theme) => (
              <button
                key={theme.id}
                type="button"
                onClick={() => persistTheme(theme.id)}
                className={cn(
                  "relative overflow-hidden rounded-xl border p-4 text-left transition-all duration-200",
                  selectedTheme === theme.id
                    ? "border-primary shadow-[0_0_15px_var(--glow-primary)]"
                    : "border-border hover:border-primary/50"
                )}
                style={{ backgroundColor: theme.background }}
              >
                <div className="mb-3 flex gap-2">
                  <div className="h-8 w-8 rounded-lg shadow-inner" style={{ backgroundColor: theme.primary }} />
                  <div className="h-8 w-8 rounded-lg shadow-inner" style={{ backgroundColor: theme.accent }} />
                  <div className="h-8 w-8 rounded-lg border border-white/20 shadow-inner" style={{ backgroundColor: theme.background }} />
                </div>
                <span className="font-medium text-white">{theme.name}</span>
                {selectedTheme === theme.id && (
                  <div className="absolute right-2 top-2 flex h-6 w-6 items-center justify-center rounded-full bg-primary">
                    <IconCheck className="h-4 w-4 text-primary-foreground" strokeWidth={2} />
                  </div>
                )}
              </button>
            ))}
          </div>
        </div>
      )
    }

    if (stepIndex === 2) {
      const grouped = importableInstances.reduce<Record<string, ImportableLauncherInstance[]>>((acc, inst) => {
        const key = inst.source
        if (!acc[key]) acc[key] = []
        acc[key].push(inst)
        return acc
      }, {})

      const sourceBadge = (source: string) => {
        if (source === "xlauncher") return "bg-emerald-500/15 text-emerald-300 border-emerald-400/25"
        if (source === "gdlauncher") return "bg-sky-500/15 text-sky-300 border-sky-400/25"
        if (source === "prism") return "bg-violet-500/15 text-violet-300 border-violet-400/25"
        if (source === "astralrinth") return "bg-cyan-500/15 text-cyan-300 border-cyan-400/25"
        return "bg-muted text-muted-foreground border-border"
      }

      return (
        <div className="space-y-5">
          {importableInstances.length > 0 ? (
            <>
              <div className="flex items-center justify-between gap-3">
                <div className="flex flex-wrap gap-2">
                  {Object.entries(grouped).map(([source, instances]) => (
                    <div key={source} className={cn("inline-flex items-center gap-2 rounded-full border px-4 py-2 text-sm", sourceBadge(source))}>
                      <LauncherSourceIcon source={source as LauncherSource} className="h-4 w-4 shrink-0" />
                      <span>{copy.sourceNames[source] ?? source}</span>
                      <span className="text-current/70">•</span>
                      <span>{instances.length}</span>
                    </div>
                  ))}
                </div>
                <button
                  type="button"
                  onClick={() => void importSelectedInstances()}
                  disabled={!selectedImportIds.length || importingInstances}
                  className="inline-flex h-11 shrink-0 items-center justify-center gap-2 rounded-xl bg-primary px-4 font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {importingInstances ? <IconLoader2 className="h-4 w-4 animate-spin" strokeWidth={2} /> : <IconDownload className="h-4 w-4" strokeWidth={1.9} />}
                  {importingInstances
                    ? copy.importingButton
                    : `${copy.importButton}${selectedImportIds.length ? ` (${selectedImportIds.length})` : ""}`}
                </button>
              </div>

              <div className="grid max-h-[340px] gap-3 overflow-y-auto pr-1 xl:grid-cols-2">
                {importableInstances.map((instance) => {
                  const counts = [
                    instance.modCount ? `${instance.modCount} ${copy.modsLabel}` : null,
                    instance.resourcepackCount ? `${instance.resourcepackCount} ${copy.resourcepacksLabel}` : null,
                    instance.shaderCount ? `${instance.shaderCount} ${copy.shadersLabel}` : null,
                  ].filter(Boolean).join(" • ")

                  return (
                    <button
                      key={instance.id}
                      type="button"
                      onClick={() => toggleImportSelection(instance.id)}
                      className={cn(
                        "relative overflow-hidden rounded-2xl border p-4 text-left transition-all duration-200",
                        selectedImportIds.includes(instance.id)
                          ? "border-primary bg-primary/10 shadow-[0_0_18px_var(--glow-primary)]"
                          : "border-border bg-card hover:border-primary/40"
                      )}
                    >
                      <div className="flex items-start gap-4">
                        <div className="flex h-14 w-14 shrink-0 items-center justify-center overflow-hidden rounded-xl border border-border bg-background">
                          {instance.icon ? (
                            <img src={instance.icon} alt="" className="h-full w-full object-cover" />
                          ) : (
                            <span className="text-lg font-semibold text-muted-foreground">{instance.name.slice(0, 1).toUpperCase()}</span>
                          )}
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <div className="truncate text-base font-semibold text-foreground">{instance.name}</div>
                            <span className={cn("inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-medium", sourceBadge(instance.source))}>
                              <LauncherSourceIcon source={instance.source} className="h-3.5 w-3.5 shrink-0" />
                              {copy.sourceNames[instance.source] ?? instance.source}
                            </span>
                          </div>
                          <div className="mt-2 text-sm text-muted-foreground">{instance.version} • {instance.modLoader}</div>
                          {counts && <div className="mt-3 text-sm text-muted-foreground">{counts}</div>}
                        </div>
                        <div
                          className={cn(
                            "flex h-8 w-8 shrink-0 items-center justify-center rounded-full border transition-colors",
                            selectedImportIds.includes(instance.id)
                              ? "border-primary bg-primary text-primary-foreground"
                              : "border-border bg-background text-transparent"
                          )}
                        >
                          <IconCheck className="h-4 w-4" strokeWidth={2.4} />
                        </div>
                      </div>
                    </button>
                  )
                })}
              </div>

              {importedCount > 0 && (
                <div className="rounded-xl border border-primary/20 bg-primary/5 px-4 py-3 text-sm text-foreground">
                  {formatMessage(copy.importCompleted, { count: importedCount })}
                </div>
              )}
            </>
          ) : (
            <div className="rounded-2xl border border-dashed border-border bg-card p-8 text-center text-sm leading-6 text-muted-foreground">
              {copy.importEmpty}
            </div>
          )}
        </div>
      )
    }

    if (stepIndex === 3) {
      return (
        <div className="space-y-5">
          <div className="grid grid-cols-2 gap-4 xl:grid-cols-4">
            {accountTypeCards.map((provider) => (
              <button
                key={provider.id}
                type="button"
                disabled={anyLoginLoading && provider.id !== "offline"}
                onClick={() => {
                  if (provider.id === "offline") {
                    setShowOfflineAccountModal(true)
                    setError("")
                    return
                  }
                  void handleProviderLogin(provider.id)
                }}
                className={cn(
                  "relative overflow-hidden rounded-xl border border-border bg-muted/30 p-4 text-left transition-all duration-200 hover:border-primary/50 hover:bg-muted/50",
                  provider.id !== "offline" && "disabled:cursor-not-allowed disabled:opacity-60"
                )}
              >
                <div
                  className="mb-3 flex h-12 w-12 items-center justify-center rounded-xl"
                  style={{ backgroundColor: `${provider.color}20`, color: provider.color }}
                >
                  {provider.id === "microsoft" ? (
                    <svg className="h-6 w-6" viewBox="0 0 128 128" xmlns="http://www.w3.org/2000/svg">
                      <path fill="currentColor" d="M67.328 67.331h60.669V128H67.328zm-67.325 0h60.669V128H.003zM67.328 0h60.669v60.669H67.328zM.003 0h60.669v60.669H.003z"/>
                    </svg>
                  ) : provider.id === "elyby" ? (
                    <svg className="h-6 w-6" viewBox="0 0 480 480" xmlns="http://www.w3.org/2000/svg">
                      <path fill="currentColor" d="M262 207.5V351h-37V64h37zM193.5 98v14.5H86V197h93v30H86v94l54.3.2 54.2.3v29l-72.7.3-72.8.2V83l72.3.2 72.2.3zm135.9 55.7c.3 1 7.3 31.7 15.6 68.3 8.4 36.6 15.5 67.3 15.8 68.3.4 1 7.8-26.8 18.2-68.3l17.5-70h20.2c12.5 0 20.3.4 20.3 1 0 .5-6.3 22.9-14 49.7-7.8 26.9-22.4 77.8-32.6 113.3s-19.5 67.2-20.6 70.5c-4.4 12.9-13.6 28.5-20.1 34.2-8.6 7.6-23 11.4-35.5 9.4-8.9-1.5-13.3-2.5-13.4-3.1-.1-.3.7-6.7 1.7-14.3l1.9-13.7 6.2.6c16.6 1.7 21-3.3 30.9-35.2l4.7-15.2-5.1-16.8c-2.7-9.3-10.4-35.6-17.1-58.4-19.1-65.1-35-119.4-35.5-120.8-.3-.9 4.1-1.2 20-1.2 18.5 0 20.4.2 20.9 1.7"/>
                    </svg>
                  ) : provider.id === "xnskins" ? (
                    <svg className="h-6 w-6" viewBox="0 0 192 192" xmlns="http://www.w3.org/2000/svg">
                      <path d="M 121.270 53.270 L 93 81.539 93 86.387 C 93 90.685, 93.440 91.676, 96.882 95.118 C 100.594 98.829, 102.357 99.451, 108 99.039 C 109.813 98.907, 117.168 92.210, 134.750 74.686 L 159 50.515 159 88.493 L 159 126.471 146.236 113.736 L 133.472 101 126.244 101 L 119.016 101 111.008 108.754 L 103 116.508 103 126.876 C 103 138.904, 103.732 138.905, 92.871 126.857 L 85.778 118.988 89.363 115.019 C 93.760 110.153, 94.655 106.955, 92.869 102.487 C 92.037 100.404, 80.782 88.072, 64.162 71.030 L 36.823 43 19.709 43 L 2.595 43 16.024 56.750 C 35.123 76.307, 55.993 97.939, 59.465 101.779 L 62.430 105.058 33.215 134.285 C 17.147 150.360, 4 163.847, 4 164.256 C 4 164.665, 11.982 165, 21.739 165 L 39.477 165 55.296 149.250 L 71.114 133.500 86.307 149.285 L 101.500 165.071 109.827 165.035 C 117.581 165.002, 118.346 164.808, 120.939 162.215 C 123.315 159.838, 123.831 158.300, 124.445 151.746 C 124.841 147.520, 124.845 139.549, 124.454 134.031 C 124.062 128.514, 123.997 124, 124.308 124 C 124.619 124, 133.974 133.225, 145.097 144.500 L 165.320 165 171.144 165 C 176.166 165, 177.418 164.598, 180.234 162.083 L 183.500 159.165 183.774 103.301 L 184.048 47.437 172.678 36.218 L 161.307 25 155.423 25 L 149.539 25 121.270 53.270" fill="currentColor"/>
                    </svg>
                  ) : (
                    <IconUserMinus className="h-6 w-6" />
                  )}
                </div>
                <div className="font-medium text-foreground">{provider.title}</div>
                <div className="mt-1 text-sm text-muted-foreground">{provider.description}</div>
                {provider.active && <IconLoader2 className="absolute right-4 top-4 h-5 w-5 animate-spin text-primary" strokeWidth={2} />}
              </button>
            ))}
          </div>

          {accounts.length > 0 && (
            <div className="space-y-3">
              {accounts.map((account) => (
                <div
                  key={account.id}
                  className={cn(
                    "flex items-center gap-4 rounded-xl border p-4 transition-all duration-200",
                    account.isActive
                      ? "border-primary bg-primary/10 shadow-[0_0_15px_var(--glow-primary)]"
                      : "border-border bg-muted/30 hover:border-primary/50"
                  )}
                >
                  <div className="h-12 w-12 shrink-0 overflow-hidden rounded-xl">
                    <img src={getAvatarUrl(account, account.username)} alt="" className="h-full w-full object-cover" />
                  </div>

                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="truncate font-medium text-foreground">{account.username}</span>
                      {account.isActive && (
                        <span className="shrink-0 rounded-full bg-primary/20 px-2 py-0.5 text-xs font-medium text-primary">
                          {copy.accountSelected}
                        </span>
                      )}
                    </div>
                    <span className="text-sm text-muted-foreground">{account.type}</span>
                  </div>

                  {!account.isActive && (
                    <button
                      type="button"
                      onClick={() => setActiveAccount(account.id)}
                      className="flex shrink-0 items-center gap-1.5 rounded-lg bg-muted/50 px-3 py-2 text-sm text-muted-foreground transition-colors hover:bg-primary/20 hover:text-primary"
                    >
                      <IconCheck className="h-4 w-4" strokeWidth={1.75} />
                      {copy.accountSelect}
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )
    }

    if (stepIndex === 4) {
      return (
        <div className="space-y-5">
          <div className="grid gap-3 lg:grid-cols-3">
            {memoryPresets.map((preset) => {
              const isActive = memoryMin === preset.min && memoryMax === preset.max
              return (
                <button
                  key={preset.id}
                  type="button"
                  onClick={() => {
                    setMemoryMin(preset.min)
                    setMemoryMax(preset.max)
                    setError("")
                  }}
                  className={cn(
                    "rounded-2xl border p-4 text-left transition-all duration-200",
                    isActive
                      ? "border-primary bg-primary/10 shadow-[0_0_18px_var(--glow-primary)]"
                      : "border-border bg-card hover:border-primary/40"
                  )}
                >
                  <div className="text-sm uppercase tracking-[0.18em] text-muted-foreground">{preset.id}</div>
                  <div className="mt-2 text-xl font-semibold text-foreground">{preset.min} / {preset.max}</div>
                </button>
              )
            })}
          </div>

          <div className="grid gap-3 xl:grid-cols-[0.95fr_1.05fr]">
            <div className="rounded-2xl border border-border bg-card p-5 xl:col-span-2">
              <div className="grid gap-4 sm:grid-cols-2">
                <label className="space-y-2">
                  <span className="text-sm font-medium text-foreground">{copy.memoryMin}</span>
                  <div className="flex h-12 items-center rounded-2xl border border-border bg-background/70 px-4">
                    <input
                      value={memoryMin.replace(/G$/i, "")}
                      onChange={(event) => setMemoryMin(`${event.target.value.replace(/[^\d]/g, "")}G`)}
                      inputMode="numeric"
                      className="w-full bg-transparent text-foreground outline-none"
                    />
                    <span className="text-sm text-muted-foreground">GB</span>
                  </div>
                </label>
                <label className="space-y-2">
                  <span className="text-sm font-medium text-foreground">{copy.memoryMax}</span>
                  <div className="flex h-12 items-center rounded-2xl border border-border bg-background/70 px-4">
                    <input
                      value={memoryMax.replace(/G$/i, "")}
                      onChange={(event) => setMemoryMax(`${event.target.value.replace(/[^\d]/g, "")}G`)}
                      inputMode="numeric"
                      className="w-full bg-transparent text-foreground outline-none"
                    />
                    <span className="text-sm text-muted-foreground">GB</span>
                  </div>
                </label>
              </div>
            </div>
          </div>

          <div className="rounded-2xl border border-border bg-card p-5 text-sm leading-6 text-muted-foreground">
            {copy.memoryHint}
          </div>
        </div>
      )
    }

    return (
      <div className="space-y-5">
        <div className="grid gap-3">
          {copy.injectorModes.map((mode) => (
            <button
              key={mode.id}
              type="button"
              onClick={() => {
                setInjectorMode(mode.id)
                setError("")
              }}
              className={cn(
                "rounded-2xl border p-5 text-left transition-all duration-200",
                injectorMode === mode.id
                  ? "border-primary bg-primary/10 shadow-[0_0_18px_var(--glow-primary)]"
                  : "border-border bg-card hover:border-primary/40"
              )}
            >
              <div className="flex items-center justify-between gap-4">
                <div>
                  <div className="text-base font-semibold text-foreground">{mode.title}</div>
                  <div className="mt-2 text-sm leading-6 text-muted-foreground">{mode.description}</div>
                </div>
                <div
                  className={cn(
                    "flex h-9 w-9 shrink-0 items-center justify-center rounded-full border transition-colors",
                    injectorMode === mode.id
                      ? "border-primary bg-primary text-primary-foreground"
                      : "border-border bg-background text-transparent"
                  )}
                >
                  <IconCheck className="h-4 w-4" strokeWidth={2.4} />
                </div>
              </div>
            </button>
          ))}
        </div>
      </div>
    )
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
            <button
              type="button"
              onClick={onSkip}
              className="inline-flex h-10 shrink-0 items-center gap-2 rounded-xl border border-border bg-card px-3 text-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            >
              <IconX className="h-4 w-4" strokeWidth={1.8} />
              {copy.skip}
            </button>
          </div>

          <div className="mt-4 h-2 overflow-hidden rounded-full bg-muted">
            <div
              className="h-full rounded-full bg-primary transition-all duration-300"
              style={{ width: `${((stepIndex + 1) / steps.length) * 100}%` }}
            />
          </div>

          <div className="mt-3 flex items-center justify-between gap-3">
            <div className="text-sm text-muted-foreground">
              {formatMessage(copy.stepCounter, { current: stepIndex + 1, total: steps.length })}
            </div>
          </div>

          <div className="mt-4">
            {renderStepDots()}
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
          <div className="absolute inset-0 z-10 flex items-center justify-center bg-background/80 px-4 backdrop-blur-sm">
            <div className="w-full max-w-md rounded-2xl border border-border bg-card p-6 shadow-2xl">
              <div className="mb-6 flex items-center justify-between">
                <h3 className="text-lg font-semibold text-foreground">{copy.accountOfflineTitle}</h3>
                <button
                  type="button"
                  onClick={() => setShowOfflineAccountModal(false)}
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
                    onChange={(event) => setOfflineUsername(event.target.value)}
                    placeholder={copy.accountOfflinePlaceholder}
                    className="w-full rounded-xl border border-border bg-input px-4 py-3 text-foreground outline-none placeholder:text-muted-foreground focus:border-primary focus:ring-1 focus:ring-primary"
                    autoFocus
                    onKeyDown={(event) => {
                      if (event.key === "Enter") addOfflineAccount()
                    }}
                  />
                </div>

                <div className="flex gap-3 pt-2">
                  <button
                    type="button"
                    onClick={() => setShowOfflineAccountModal(false)}
                    className="flex flex-1 items-center justify-center gap-2 rounded-xl border border-border bg-muted/30 px-4 py-3 text-foreground transition-colors hover:bg-muted/50"
                  >
                    <IconArrowLeft className="h-4 w-4" strokeWidth={1.75} />
                    {copy.back}
                  </button>
                  <button
                    type="button"
                    onClick={addOfflineAccount}
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
        )}

        <div className="flex items-center justify-between gap-3 border-t border-border px-5 py-4">
          <button
            type="button"
            onClick={handleBack}
            disabled={stepIndex === 0 || saving}
            className="inline-flex h-12 items-center justify-center gap-2 rounded-xl border border-border bg-card px-5 text-foreground transition-colors hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50"
          >
            <IconArrowLeft className="h-4 w-4" strokeWidth={1.9} />
            {copy.back}
          </button>

          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => void handleContinue()}
              disabled={!canProceed || anyLoginLoading || saving}
              className="inline-flex h-12 items-center justify-center gap-2 rounded-xl bg-primary px-6 font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-60"
            >
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
