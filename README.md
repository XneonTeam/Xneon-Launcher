<p align="center"><a href="https://launcher.xneon.org" target="_blank"><img alt="Xneon Launcher" width="120" src="https://launcher.xneon.org/icon.png"></a></p>

<h1 align="center">Xneon Launcher</h1>

<p align="center">
  <a href="https://github.com/XneonTeam/Xneon-Launcher/releases/latest"><img height="45" src="./.github/badges/version.svg" alt="Version"></a>&nbsp;
  <a href="https://github.com/XneonTeam/Xneon-Launcher/blob/main/LICENSE"><img height="45" src="./.github/badges/license.svg" alt="License"></a>&nbsp;
  <img height="45" src="./.github/badges/runtime.svg" alt="Electrobun">
  <br>
  <img height="45" src="./.github/badges/react.svg" alt="React">&nbsp;
  <img height="45" src="./.github/badges/vite.svg" alt="Vite">
  <br>
  <img height="45" src="./.github/badges/windows.svg" alt="Windows">&nbsp;
  <img height="45" src="./.github/badges/macos.svg" alt="macOS">&nbsp;
  <img height="45" src="./.github/badges/linux.svg" alt="Linux">
</p>

<p align="center">
  <strong>Xneon Launcher</strong> — современный лаунчер для Minecraft с открытым исходным кодом: сборки и моды, локальные серверы, облачная синхронизация, скины, статистика и AI-помощник в одном приложении.
</p>

<p align="center">
  🔗 <a href="https://docs.xneon.org"><strong>docs.xneon.org</strong></a> — документация лаунчера, тем, скинов и AI-помощника.
</p>

## Возможности

### Игра
- 🚀 **Запуск Minecraft** — Vanilla, Fabric, Quilt, Forge, NeoForge, LiteLoader и OptiFine; есть подготовка старых версий Forge и Legacy FML
- ⚡ **Быстрая игра** — быстрый переход в миры и недавние серверы с MOTD, онлайном, версией и пингом. Панель доступна на всех версиях, а Quick Play-параметры передаются только клиентам Java Edition 1.20+ (снапшоты от `23w14a`)
- ⚙️ **Гибкий запуск** — Java, память, аргументы JVM, команды до и после запуска, wrapper, переменные окружения, поведение лаунчера после старта игры
- 📊 **Статистика** — время в игре, сессии, аптайм серверов, графики активности и топы сборок
- 📜 **Логи запуска** — уровни, поиск, копирование и разбор краша через AI

### Контент
- 📥 **Modrinth, CurseForge и FTB** — поиск, установка и обновление модов, ресурспаков, шейдеров и модпаков
- 🗂 **Сборки** — изолированные профили со своими модами, мирами и настройками, категории, корзина, экспорт и импорт сборки в ZIP
- 🔄 **Автообновление контента** — бейджи обновлений, ченджлоги и обновление всего сразу
- 🧩 **Зависимости** — установка обязательных модов, проверка совместимости с версией загрузчика, распознавание уже установленного по проекту

### Серверы
- 🎮 **Локальные серверы** — мастер создания (Vanilla, Forge, Fabric, Quilt, NeoForge, Paper, Spigot, Bukkit, Purpur, Folia, Sponge, BungeeCord, Velocity, Waterfall или свой JAR), автозагрузка Java и ядра, консоль, файловый менеджер, `server.properties`, игроки (whitelist, операторы, баны), группы, корзина и экспорт в ZIP
- 🌐 **XN Connect** — сервер получает внешний адрес `connect.xneon.org`: друзья заходят без белого IP и настройки проброса портов

### Аккаунты и оформление
- 🔐 **Аккаунты** — Microsoft, Ely.by, XNSkins и оффлайн-режим, встроенный authlib-injector; аватары обновляются после смены скина
- 🎨 **Скины** — библиотека и каталог Laby с поиском и фильтрами, избранное, плащи и 3D-превью; результаты сканирования сохраняются при переключении вкладок
- ☁️ **Облако** — Google Drive, Dropbox, Яндекс.Диск, OneDrive, WebDAV и S3; просмотр и выборочная синхронизация сборок, серверов и аккаунтов, импорт и экспорт тем
- 🤖 **AI-помощник** — отдельные чаты, вложения с контекстом лаунчера, инструменты для работы со сборками и серверами, план действий и подтверждение операций. Поддерживаются OpenAI-совместимые API, Anthropic Messages, Google Gemini и Ollama
- 💾 **Хранилище** — разбор занятого места по категориям, повторное использование результатов сканирования при возврате во вкладку и очистка мусора
- 🌍 **Языки** — русский, английский, украинский, немецкий, испанский
- 🖼 **Темы** — готовые и собственные палитры с настройкой всех цветов, фона, эффектов интерфейса и свечения; CSS-редактор, импорт и экспорт `.xntheme`, синхронизация через облако
- ✨ **Анимации тем** — настройка появления содержимого или собственная CSS-анимация; панели и загруженные карточки появляются отдельно

## Скриншоты

| Редактор собственной темы на основе Core | AI-агент |
|---|---|
| ![Палитра Core в редакторе собственной темы](docs/screenshots/1.0.7/theme-editor.png) | ![Страница AI-агента с карточкой Sodium](docs/screenshots/1.0.7/ai-agent.png) |

| Главная | Сборки |
|---|---|
| ![Главная](docs/screenshots/1.0.7/home.png) | ![Сборки](docs/screenshots/1.0.7/builds.png) |

| Серверы | Консоль сервера |
|---|---|
| ![Серверы](docs/screenshots/1.0.7/servers.png) | ![Консоль сервера](docs/screenshots/1.0.7/server-console.png) |

| Скины | Статистика |
|---|---|
| ![Скины](docs/screenshots/1.0.7/skins.png) | ![Статистика](docs/screenshots/1.0.7/stats.png) |

| Облако | Хранилище |
|---|---|
| ![Облако](docs/screenshots/1.0.7/cloud.png) | ![Хранилище](docs/screenshots/1.0.7/settings-storage.png) |

| Аккаунты | Настройки игры |
|---|---|
| ![Аккаунты](docs/screenshots/1.0.7/accounts.png) | ![Настройки игры](docs/screenshots/1.0.7/settings-game.png) |

| Темы | Логи |
|---|---|
| ![Готовые темы](docs/screenshots/1.0.7/settings-themes.png) | ![Логи запуска](docs/screenshots/1.0.7/logs.png) |

| Общие сведения о сборке | Настройки сборки |
|---|---|
| ![Общие сведения о сборке Fabulously Optimized](docs/screenshots/1.0.7/build-general.png) | ![Настройки сборки Fabulously Optimized](docs/screenshots/1.0.7/build-settings.png) |

| Экспорт сборки | Плагины сервера |
|---|---|
| ![Экспорт сборки Fabulously Optimized](docs/screenshots/1.0.7/build-export.png) | ![Каталог плагинов сервера](docs/screenshots/1.0.7/server-addons.png) |

| Свойства сервера | Игроки сервера |
|---|---|
| ![Свойства сервера](docs/screenshots/1.0.7/server-properties.png) | ![Игроки сервера](docs/screenshots/1.0.7/server-players.png) |

| Настройки сервера | |
|---|---|
| ![Настройки сервера](docs/screenshots/1.0.7/server-settings.png) | |

## Быстрый старт

Добавьте **Bun 1.4.4** и **Hutch 0.29.0** в PATH. Для стандартной Windows-сборки Electrobun нужны Windows PowerShell и 64-битный компилятор C# из .NET Framework 4.x; для дополнительного Windows-установщика — **NSIS 3** (`makensis` или `XNEON_MAKENSIS`). Приложение использует WebView2.

```bash
# Установка зависимостей
bun install --frozen-lockfile

# Сборка dev и запуск Electrobun
bun run dev

# Проверка типов
bun run typecheck

# Production-сборка и упаковка в дистрибутив
bun run build
bun run package
```

## Импорт из других лаунчеров

Локальный импорт поддерживает архивы Modrinth (`.mrpack`), CurseForge (ZIP с `manifest.json`) и сборок, экспортированных из Xneon (ZIP с `xnlauncher.json`). Произвольные архивы готовых клиентских версий этим способом не импортируются.

Xneon автоматически обнаружит установленные сборки из:

| Лаунчер | Windows | macOS | Linux |
|---------|---------|-------|-------|
| Prism Launcher | `%APPDATA%\PrismLauncher\instances` | `~/Library/Application Support/PrismLauncher` | `~/.local/share/PrismLauncher` |
| MultiMC | `%APPDATA%\MultiMC\instances` | `~/Library/Application Support/multimc` | `~/.local/share/MultiMC` |
| PolyMC | `%APPDATA%\PolyMC\instances` | `~/Library/Application Support/PolyMC` | `~/.local/share/PolyMC` |
| GDLauncher Carbon | `%APPDATA%\gdlauncher_carbon\data\instances` | `~/Library/Application Support/gdlauncher_carbon/data/instances` | `~/.local/share/gdlauncher_carbon` |
| XMCL / X Launcher | `%APPDATA%\xmcl\instances` или `~\.minecraftx\instances` | `~/Library/Application Support/{xmcl,.minecraftx}/instances` | `~/.config/xmcl/instances` или `~/.minecraftx/instances` |
| Modrinth App | `%APPDATA%\ModrinthApp\app.db` | `~/Library/Application Support/ModrinthApp/app.db` | `~/.local/share/ModrinthApp/app.db` |
| Millida Launcher | `%APPDATA%\net.millida.launcher\minecraft\profiles` | `~/Library/Application Support/net.millida.launcher/minecraft/profiles` | `~/.local/share/net.millida.launcher/minecraft/profiles` |

### Что переносится вместе со сборкой

При импорте создаётся отдельная сборка Xneon с названием и иконкой исходной. В неё копируются:

- моды, ресурспаки и шейдеры;
- миры, настройки, скриншоты и остальные файлы игровой папки;
- выбранный профиль из общего каталога `versions` другого лаунчера: JSON, JAR и наследование через `inheritsFrom`;
- версия Minecraft, загрузчик и его версия.

Профили `versions` переносятся из Prism Launcher, MultiMC, PolyMC, GDLauncher Carbon, XMCL, Modrinth App и Millida Launcher. После импорта такой профиль используется `@xnlc/core` через `customVersionPath` и доступен сборке для запуска. При ручной смене Minecraft или загрузчика в Xneon привязка к импортированному профилю сбрасывается.

Если лаунчер установлен в нестандартном месте, в окне импорта можно вручную выбрать его корневую папку, каталог сборок или одну конкретную сборку. Для Modrinth App можно указать корень данных, `profiles` или `app.db`; для Millida — корень данных, игровой корень или `profiles`. Перенос игрового корня Millida через `game-root.txt` и внешние сборки XMCL через `instances.json` определяются автоматически.

## Разработка

Актуальные команды, IPC, Workers, владение сессиями и тестовые entrypoints:
[руководство по интеграции](docs/integration-guide.md).
Поддержка платформ и команды native runners: [platform builds](docs/platform-builds.md).
Проверки и границы offline/live: [testing](docs/testing.md).

Документация для разработчиков и авторов тем: [docs.xneon.org](https://docs.xneon.org).

### Архитектура

- **Renderer** (`components/`, `src/`, `lib/`) — интерфейс на React 19 + Vite 8 + Tailwind 4
- **Backend** (`electrobun/main/`) — обработчики RPC, база данных, запуск Minecraft в отдельном worker-процессе
- **Пакеты** (`packages/`) — доменная логика, подключённая как Bun-воркспейс:
  - `@xnlc/core` — движок запуска Minecraft и загрузчики
  - `@xnlc/mods` — клиенты Modrinth, CurseForge и FTB
  - `@xnlc/servers` — ядра серверов, установка и управление процессами
  - `@xnlc/skins` — домен скинов: каталог Laby, библиотека, надевание
  - `@xnlc/agent` — AI-провайдеры, потоковые ответы, инструменты, контекст и чаты помощника
  - `@xnlc/nbt` — чтение и запись NBT (`level.dat`, `servers.dat`)
  - `@xnlc/types` — общие типы и IPC-контракты
  - `@xnlc/urls` — общие адреса сервисов и настраиваемые источники Minecraft
  - `@xnlc/archives` — общий потоковый ZIP слой
  - `@xnlc/parser` — метаданные, требования загрузчиков и batch scan-worker
  - `@xnlc/share` — манифесты, ветки, слияние и файловые транзакции Share

### Команды

```bash
bun run dev           # сборка интерфейса и воркеров, запуск через Electrobun
bun run build         # typecheck + сборка renderer и main
bun run package       # Stable → release-electrobun/stable/
bun run typecheck     # renderer + main tsconfig
bun run test:desktop  # desktop-тесты под Bun 1.4.4
bun run test:offline  # воспроизводимый offline gate, без внешних сервисов
```

После сборки Windows x64 можно проверить изоляцию каналов через
`bun scripts/test-channel-artifacts.mjs` и нативную подготовку обновления
через `bun scripts/test-native-update.ts stable` и `bun scripts/test-native-update.ts canary`.

### Структура

```
components/launcher/   # UI-компоненты (страницы, модалки, настройки)
electrobun/main/         # Backend Electrobun: RPC, БД, сборки, серверы, облако
electrobun/preload.ts    # API интерфейса поверх Electrobun RPC
lib/                   # Общие утилиты renderer (кэш, форматирование, ссылки)
packages/              # Локальные пакеты @xnlc/*
src/                   # Точка входа renderer, i18n, контексты, хуки
public/                # Статические файлы и иконки лаунчеров
docs/screenshots/      # Скриншоты для README и релизов
```

### Данные лаунчера

| Платформа | Каталог |
|---|---|
| Windows | `%APPDATA%\xneonlauncher` |
| macOS | `~/Library/Application Support/xneonlauncher` |
| Linux | `~/.xneonlauncher` |

SQLite (`data.db`, драйвер `bun:sqlite`) хранит аккаунты и их данные авторизации, настройки (включая ИИ, MCP и метаданные тем), записи сборок, серверов, скинов, статистику, облачные конфигурации и историю чатов. Файлы остаются в исходных каталогах профиля: `themes/`, `theme-media/`, `minecraft/`, `intents/` (сборки, моды, миры и скриншоты), `mc-servers/`, `skins/` и `cache/`. Явные пути сборок и внешних ресурсов сохраняются.

Перед первым открытием существующей базы для записи и при переходе между версиями схемы лаунчер проверяет файл и создаёт согласованный снимок `data.db.electrobun-v<исходная>-to-v<целевая>.bak`. Снимок включает подтверждённые записи из WAL и проверяется перед применением транзакции миграции. При ошибке проверки лаунчер показывает путь к базе и причину ошибки на экране запуска.

Для локальной разработки `XNEON_BUN_DATA_DIR` явно задаёт корень тестового профиля. Относительный путь разрешается от рабочего каталога, а тестовый `data-location.json` хранится в указанном корне. Укажите отдельную папку с тестовыми данными. Автоматического импорта из тестового профиля в основной нет.

## Лицензия

[GPL-3.0](LICENSE)

## Благодарности

- [Prism Launcher](https://prismlauncher.org/) — за вдохновение в области управления инстансами
- [X Minecraft Launcher](https://xmcl.app) — за отличный пример Electron-лаунчера
- [Modrinth](https://modrinth.com), [CurseForge](https://curseforge.com) и [FTB](https://api.modpacks.ch) — за API для модов и модпаков
- [skinview3d](https://github.com/bs-community/skinview3d) и [three.js](https://threejs.org) — за 3D-превью скинов
- [better-sqlite3](https://github.com/WiseLibs/better-sqlite3) — для тестовых баз прежнего формата
- [shadcn/ui](https://ui.shadcn.com) — за компоненты интерфейса
- [Tabler Icons](https://tabler-icons.io) — за иконки
