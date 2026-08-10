export type OnboardingLanguage = "ru" | "en" | "uk" | "de" | "es"
export type LauncherSource = "gdlauncher" | "prism" | "multimc" | "polymc" | "astralrinth" | "xlauncher" | "modrinthapp"

export type OnboardingCopy = {
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
  sourceNames: Record<string, string>
  sourcePaths: Record<string, string>
  errors: {
    offlineUsername: string
    loginFailed: string
    importFailed: string
    settingsFailed: string
  }
}

export const ONBOARDING_COPY: Record<OnboardingLanguage, OnboardingCopy> = {
  ru: {
    steps: [
      { title: "Язык", description: "Сначала выбери язык интерфейса." },
      { title: "Тема", description: "Теперь выбери визуальный стиль лаунчера." },
      { title: "Импорт", description: "Импортируй найденные сборки из другого лаунчера." },
      { title: "Аккаунт", description: "Добавь хотя бы один аккаунт прямо здесь." },
      { title: "Память", description: "Укажи, сколько RAM выделять игре." },
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
    importEmpty: "Сборки для импорта не найдены. Поддерживаются X Launcher, GDLauncher, Prism Launcher, Modrinth App и AstralRinth.",
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
    sourceNames: { gdlauncher: "GDLauncher", prism: "Prism Launcher", astralrinth: "AstralRinth", xlauncher: "X Launcher", modrinthapp: "Modrinth App" },
    sourcePaths: {
      xlauncher: "~/.minecraftx/instances",
      gdlauncher: "~/.local/share/gdlauncher_carbon/data/instances",
      prism: "~/.var/app/org.prismlauncher.PrismLauncher/... или ~/.local/share/PrismLauncher",
      astralrinth: "~/.local/share/AstralRinthApp/profiles",
      modrinthapp: "~/.local/share/modrinth-app/profiles или %APPDATA%/ModrinthApp/profiles",
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
    importEmpty: "No instances found for import. X Launcher, GDLauncher, Prism Launcher, Modrinth App, and AstralRinth are supported.",
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
    sourceNames: { gdlauncher: "GDLauncher", prism: "Prism Launcher", astralrinth: "AstralRinth", xlauncher: "X Launcher", modrinthapp: "Modrinth App" },
    sourcePaths: {
      xlauncher: "~/.minecraftx/instances",
      gdlauncher: "~/.local/share/gdlauncher_carbon/data/instances",
      prism: "~/.var/app/org.prismlauncher.PrismLauncher/... or ~/.local/share/PrismLauncher",
      astralrinth: "~/.local/share/AstralRinthApp/profiles",
      modrinthapp: "~/.local/share/modrinth-app/profiles or %APPDATA%/ModrinthApp/profiles",
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
    importEmpty: "Збірки для імпорту не знайдено. Підтримуються X Launcher, GDLauncher, Prism Launcher, Modrinth App і AstralRinth.",
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
    sourceNames: { gdlauncher: "GDLauncher", prism: "Prism Launcher", astralrinth: "AstralRinth", xlauncher: "X Launcher", modrinthapp: "Modrinth App" },
    sourcePaths: {
      xlauncher: "~/.minecraftx/instances",
      gdlauncher: "~/.local/share/gdlauncher_carbon/data/instances",
      prism: "~/.var/app/org.prismlauncher.PrismLauncher/... або ~/.local/share/PrismLauncher",
      astralrinth: "~/.local/share/AstralRinthApp/profiles",
      modrinthapp: "~/.local/share/modrinth-app/profiles або %APPDATA%/ModrinthApp/profiles",
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
    importEmpty: "Keine Instanzen zum Import gefunden. X Launcher, GDLauncher, Prism Launcher, Modrinth App und AstralRinth werden unterstützt.",
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
    sourceNames: { gdlauncher: "GDLauncher", prism: "Prism Launcher", astralrinth: "AstralRinth", xlauncher: "X Launcher", modrinthapp: "Modrinth App" },
    sourcePaths: {
      xlauncher: "~/.minecraftx/instances",
      gdlauncher: "~/.local/share/gdlauncher_carbon/data/instances",
      prism: "~/.var/app/org.prismlauncher.PrismLauncher/... oder ~/.local/share/PrismLauncher",
      astralrinth: "~/.local/share/AstralRinthApp/profiles",
      modrinthapp: "~/.local/share/modrinth-app/profiles oder %APPDATA%/ModrinthApp/profiles",
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
    importEmpty: "No se encontraron instancias para importar. Se admiten X Launcher, GDLauncher, Prism Launcher, Modrinth App y AstralRinth.",
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
    sourceNames: { gdlauncher: "GDLauncher", prism: "Prism Launcher", astralrinth: "AstralRinth", xlauncher: "X Launcher", modrinthapp: "Modrinth App" },
    sourcePaths: {
      xlauncher: "~/.minecraftx/instances",
      gdlauncher: "~/.local/share/gdlauncher_carbon/data/instances",
      prism: "~/.var/app/org.prismlauncher.PrismLauncher/... o ~/.local/share/PrismLauncher",
      astralrinth: "~/.local/share/AstralRinthApp/profiles",
      modrinthapp: "~/.local/share/modrinth-app/profiles o %APPDATA%/ModrinthApp/profiles",
    },
    errors: {
      offlineUsername: "Introduce un nombre para la cuenta offline.",
      loginFailed: "No se pudo iniciar sesión.",
      importFailed: "No se pudieron importar las instancias.",
      settingsFailed: "No se pudieron guardar los ajustes.",
    },
  },
}
