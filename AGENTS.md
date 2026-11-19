# AGENTS.md — Xneon Launcher

## Language

Always respond to the user in Russian.
All explanations, plans, analysis, descriptions of changes, and comments — write in Russian.
Code, function names, API, terminal commands, and error messages — keep in the original language.

## Project

Xneon Launcher — Electrobun + React 19 Minecraft launcher.
- **Renderer** (React): `components/`, `src/`, `lib/`
- **Electrobun main**: `electrobun/main/`, `electrobun/preload.ts`
- **Local packages** (`packages/`): `@xnlc/core`, `@xnlc/mods`, `@xnlc/types`, `@xnlc/nbt`, `@xnlc/servers`, `@xnlc/skins`, `@xnlc/archives`, `@xnlc/parser`, `@xnlc/share`, `@xnlc/agent`, `@xnlc/urls` — Bun workspace (`workspace:*`). Registry fallback: `https://git.xneon.org/api/packages/MAINER4IK/npm/`
- **LiveOps client** (`electrobun/main/liveops/`): JS-контроллер ивентовых тем, который используют `liveops.ts` и `liveops-runtime.ts`. Серверные приложения в репозиторий не входят.
- **IPC contracts**: `packages/xnlc-types/src/ipc-contracts.ts` — single source of truth for channel signatures
- **Launch params**: `packages/xnlc-types/src/launch-types.ts` — `MinecraftLaunchParams`

## Commands

```bash
bun run dev          # Vite + Electrobun dev
bun run build        # production build (vite + tsc)
bun run package      # Hutch → release-electrobun/
bun run typecheck    # tsc --noEmit: renderer + main
bun run test:desktop # desktop-тесты под Bun 1.4.4
bun run test:offline # desktop + parser + archives + security/agent + Share
```

Отдельной команды lint нет. Основная проверка — `bun run build`.

Актуальное руководство: [docs/integration-guide.md](docs/integration-guide.md).
`prepare:desktop` генерирует credentials/catalog до единственной сборки workspaces.
Batch scan по умолчанию inline (меньше CPU/RSS по локальному benchmark).
`XNLC_SCAN_WORKER=1` явно включает проверенный `setScanWorkerEntry`; entry
упаковывается в `bun/workers/scan-worker.js`. Это opt-in, не гарантия более низкой памяти.
Измерительные сценарии в `benchmarks/` хранятся только локально и игнорируются Git.
Результаты/внутренние аудиты — в игнорируемой `.local-research/`, не в public docs
и не в package publish files.
UI получает только `PublicAccount`, сессиями владеет main. Для cleanup используйте
`registerShutdownTask`, а не собственный рекурсивный before-quit.

## Environment variables

- `XNLC_NEWS_URL` — адрес ленты новостей лаунчера (`fetch:launcher-news`). По умолчанию `https://launcher.xneon.org/news.json`.
- `XNLC_LIVEOPS_URL` — переопределение origin сервиса событийных тем (HTTPS, HTTP только для localhost); по умолчанию `https://liveops.xneon.org`, явно пустая строка отключает сеть LiveOps. Контроллер — `electrobun/main/liveops.ts`, кэш — `<userData>/event-theme-cache`, настройка `eventTheme` отдельна от `customThemes`. Ручной выбор через `liveops:select`/`settings:set("theme")` проходит через main.

## Build pipeline

Временно release/pre-release публикуют только Windows x64; Unix-матрицы отключены, но код упаковки сохранён. Список `targets` в `scripts/ci-pipeline.ts` должен совпадать с обеими workflow-матрицами. Ubuntu jobs тестов и подписания остаются.

`prepare:desktop` запускает `scripts/gen-credentials.mjs`, который читает `.env` и генерирует игнорируемый Git файл `electrobun/main/cloud/credentials.generated.ts`. Без `.env` сборка проходит с пустыми значениями для облачных провайдеров.

`build:renderer` = `vite build` → `dist/`
`build:workers` = Bun → `dist-workers/`

**Windows-установщик — NSIS** (`build/installer.nsi` + `scripts/build-windows-distribution.ts`): per-user (`RequestExecutionLevel user`), без страницы выбора каталога, тихая установка `/S`, свой деинсталлятор `%LOCALAPPDATA%\Programs\xneon-launcher\Uninstall Xneon Launcher.exe`.
`bun run build` и `bun run build:canary` сохраняют штатные артефакты Electrobun и последним шагом добавляют `xneon-launcher-<version>-win-x64.exe`. Обычные unpacked ZIP, blockmap и latest-метафайлы прежней упаковки больше не создаются. Portable ZIP — отдельная сборка с `PortableProfile`, не копия обычного релиза.
Нужен `makensis` (NSIS 3): ищется через `XNEON_MAKENSIS`, PATH, `Program Files\NSIS` и кэш electron-builder. Установщик ставит неизменённый SDK payload в `$INSTDIR\app\{bin,Resources}` и создаёт junction `%LOCALAPPDATA%\org.xneon.launcher\<channel>` → `$INSTDIR`; ярлыки запускают `…\org.xneon.launcher\<channel>\app\bin\launcher.exe`, иначе SDK-обновления отказывают («outside its managed update directory»).
Идентификатор приложения — `org.xneon.launcher` (`electrobun/main/app-identity.ts`, portable — `org.xneon.launcher.portable`). Миграция старого `com.xneonlauncher.app` и Electron-установок сохранена: `ClearLegacyInstallRoot`, очистка старых ключей, обработчик `xneon://`, параметры `--updated --force-run /D=… --package-file=…` и `RunLauncherIfRequested` не являются лишней упаковкой. Данные `%APPDATA%\xneonlauncher` не удаляются. Обновление/переустановка сохраняют `$INSTDIR\WebView2`; удаляется только бандл `app\`.

## Key architecture notes

- **Релизы — штатные артефакты Electrobun**: `<channel>-<platform>-<arch>-update.json`, `-update-v2.json`, `.tar.zst` и SDK-установщик. Windows: `win-x64-XneonLauncher-Setup.zip` + отдельный NSIS в **обоих** каналах (NSIS — единственный способ сменить канал из приложения); macOS arm64: `macos-arm64-XneonLauncher.dmg`; Linux x64: `linux-x64-XneonLauncher-Setup.tar.gz` плюс системные пакеты `xneon-launcher-<version>-{amd64.deb,x86_64.rpm,x86_64.pacman,x86_64.AppImage,x64.tar.xz}` в обоих каналах (собираются `scripts/package-linux.ts` из того же payload). Обычный unpacked ZIP и electron-builder metadata удалены. Подписанный Windows update feed (`scripts/sign-update-feed.ts`, `verify-signed-update-feed.ts`) хранит хеш NSIS в манифесте (`installer.file/size/sha256`), поэтому установщик проверяется по Ed25519-подписи.
- **CI validation без переупаковки** — `scripts/electrobun-artifacts.ts` проверяет identity, version/channel/arch, tar integrity, executable headers и отсутствие credentials/служебных файлов; staging копирует байты/имена без изменений и добавляет `SHA256SUMS.txt`. `validate-pre-release.ts <candidate> <output> [stable|canary]` требует NSIS в обоих каналах. `package-windows-portable.ts <new-output>` проверяет самостоятельный portable профиль; не зависит от обычного NSIS/ZIP/metadata.
- **Два релизных пайплайна**: `.github/workflows/release.yml` (тег `vX.Y.Z`, stable: NSIS, portable, stable-манифест) и `.github/workflows/pre-release.yml` (тег `vX.Y.Z-preN` или `vX.Y.Z-betaN`, canary: NSIS, portable, canary-манифест). Входные скрипты — `scripts/ci-release.ts` и `scripts/ci-pre-release.ts` поверх общего `scripts/ci-pipeline.ts`; каждый отказывается собирать версию чужого канала. `.github/workflows/ci.yml` — только PR/main проверки. Оба пайплайна поддерживают `workflow_dispatch` как preflight-сборку без публикации. ARM64 собирается на `macos-26`, x64 — на `macos-15-intel`.
- **Выбор канала и применение обновлений**: `update:set-channel` только сохраняет целевую ветку и сбрасывает прежний план; сеть, скачивание и перезапуск не запускает. Затем отдельно `update:check` → `update:download`. Для своего канала остаётся SDK, для другого — подписанный NSIS (`channel-switch.ts`), поскольку SDK отвергает чужой канал. После скачивания UI предлагает «Перезапустить сейчас» (`update:install`, общий shutdown-cleanup и закрытие БД) или «Позже» (`update:defer`). `update-state.ts` хранит выбранный канал и подписанные метаданные подготовленного обновления в `<defaultProfile>/system-cache/updates`; `update:get-state` восстанавливает UI после смены вкладки. Только явный выбор «Позже» включает применение в `bootstrap.ts` до открытия БД и окна через `update-startup.ts`; обычный выход сам по себе ничего не устанавливает. На следующем старте заново проверяются Ed25519, привязка к исходной сборке, SHA-256 NSIS либо соответствие SDK prepared-record подписанному манифесту. Однократный маркер снимается до передачи установщику, чтобы сбой не зацикливал старт. NSIS запускается с `/S --force-run`, сохраняет данные, заменяет payload и junction канала и перезапускает приложение; при `/S` он ждёт выхода приложения.
- **Vite `base: './'`** — all asset paths in HTML must be relative (`./path`), not absolute (`/path`). В пакете Electrobun HTML загружается по views://launcher/index.html.
- **`@/*` alias** resolves to project root: `@/src` → `src/`, `@/components` → `components/`.
- **IPC**: preload exposes `window.electrobunAPI` methods. Types in `src/electrobun.d.ts`. Adding a new IPC channel requires updating: handler in `electrobun/main/`, preload bridge in `electrobun/preload.ts`, type in `src/electrobun.d.ts`, and contract in `packages/xnlc-types/src/ipc-contracts.ts`.
- **Server data**: `servers.dat` uses raw NBT via `@xnlc/nbt` — **no** `{ compressed: "gzip" }` on read/write. `level.dat` **requires** `{ compressed: "gzip" }`.
- **Minecraft launch**: `electrobun/main/minecraft-launch-worker.ts` runs in a forked worker. `--quickPlayMultiplayer ip:port` is used for server connect (not `--server`/`--port`).
- **Хранение Minecraft**: обычный запуск использует `<data>/minecraft/`, сборка — собственный `intents/<имя>/`. `assets/`, `libraries/`, `versions/`, `runtime/` инстанса читаются и устанавливаются в его каталог; автоматической подмены общим Minecraft нет. Новые сборки не создают junction. `electrobun/main/shared-game-cache.ts` объединяет старый общий кэш с `<data>/minecraft/`, а старые управляемые ссылки инстансов заменяет независимыми копиями. Пользовательские файлы импортов сохраняются.
- **Build intent dirs**: `getBuildIntentPath(buildName)` → `%APPDATA%/xneonlauncher/intents/<sanitized-name>/` — isolates each build's `.minecraft`.
- **Accounts**: `src/AccountsContext.tsx` provides `activeAccount`, `accounts`.
- **Темы (пресеты и свои)**: домен живёт в `components/launcher/settings/theme-model.ts` — 20 CSS-переменных (`ThemeColorKey` ↔ `THEME_CSS_VARS`), палитра в hex, `DARK_PALETTE` (hex-эквивалент `.dark` из `src/index.css`) как стартовая точка новой темы, свечение `--glow-*` задаётся цветом и альфой и пишется 8-значным hex. `applyTheme` имеет две ветки: тема **без** `palette` (встроенный пресет) меняет только акценты и кольца, тема **с** `palette` переопределяет свои переменные, а остальные снимает — поэтому переход «своя тема → пресет» обязан убирать `--background` и прочие поверхности. Хранение и реестр — `theme-store.ts`: `useThemeRegistry()` отдаёт «пресеты + мои темы», применяет выбранную тему и пишет её в `settings:set("theme")`, а свои темы — в `settings:set("customThemes")` (JSON; CSS связанных тем и соседние .css.json живут в <userData>/themes, файлы обновляют снимок в БД, localStorage ускоряет холодный старт); `settings:updated` подхватывается на лету, поэтому тему можно создать и из main (например агентом). UI: `settings/settings-themes.tsx` («Готовые темы» + «Мои темы»), `settings/theme-editor.tsx` (все цвета + свечение, живой предпросмотр), `settings/theme-preview.tsx` (миниатюра окна). Добавляя новый цвет, правьте четыре места: `ThemeColorKey` в `types.ts`, `THEME_CSS_VARS` и `DARK_PALETTE` в `theme-model.ts`, группу в `THEME_COLOR_GROUPS` и ключ `themeEditor.vars.<key>` в локалях. Декоративные свечения фона (шапка лаунчера, панель Laby, превью скина) берут цвет из `--ambient-primary`/`--ambient-accent` (их выставляет `applyTheme`, дефолт — в `src/index.css`), а прозрачность задают сами через `color-mix`, поэтому один акцент в трёх местах светится с разной силой.
- **Скины**: одна вкладка `skins` в сайдбаре с двумя разделами — «Избранное» (`components/launcher/skins/`, локальные сохранённые скины) и «Библиотека» (`components/launcher/laby/`, каталог Laby). **Вся доменная логика — в `@xnlc/skins`** (`packages/xnlc-skins`): каталог Laby, «Избранное», локальные скины, надевание/сброс, кэш. Пакет не знает ни про Electron, ни про SQLite, ни про файлы: выход наружу описан портами (`SkinDiskCache`, `SkinLibraryStore`, `SkinAccountPort`), а их реализации — в `electrobun/main/skins/ports.ts` (база, `<data>/skins`, `<data>/cache/laby`, токены Microsoft). IPC-слой — тонкий: `electrobun/main/skins/index.ts` только приводит аргументы и зовёт домен. Каталог ходит в открытый API Laby (`https://laby.net/api/v3`, без ключа) через main, т.к. CORS-заголовков API не отдаёт; текстуры и рендеры, наоборот, берутся напрямую с CDN (`texture.laby.net/{hash}.png`, `laby.net/api/v3/render/skin/{hash}.png`) — они разрешают кросс-доменные запросы. Типы, пересекающие границу main ↔ renderer, лежат в `packages/xnlc-types/src/laby.ts` (только типы, без логики). Связь «Избранного» с каталогом — `skin_library.sourceId` (`laby:<hash>`; старые записи Craftdex — голый UUID), помощники — `labySourceId`/`labyHashFromSourceId`.
- **Laby: что защищено и чем заменено.** `/api/v3/user/{uuid}/profile` и `/api/search/names/{query}` отдают **428 Challenge token required** — обходить нельзя. Поэтому: ник ищется точно через `/user/{ник}/uniqueId`, история скинов берётся из `/user/{uuid}/textures` (не защищён, данные те же), аватарка — `laby.net/texture/profile/head/{uuid}.png?size=64`. Поиска по частичному нику нет и подсказок при вводе быть не может.
- **Laby: фильтр по тегу и конец выдачи.** Каталог (`/search/textures/skin`) серверную фильтрацию не поддерживает: `search`/`tag`/`tags`/`tag_ids`/`q` игнорируются. Единственная настоящая серверная фильтрация — `/api/v3/tag/{id}?size&offset`: она отдаёт скины одного тега и листается до конца (у крупных тегов это десятки страниц). Поэтому `LabyCatalog.page()` работает в трёх режимах: без фильтров — лента, ровно один тег без текста — серверная пагинация по тегу, несколько тегов и/или текст — локальный фильтр по пулу (до 5 страниц × 100, пулы ограничены 16 штуками по LRU). Ответ `/tag/{id}` беднее поиска: в нём нет строки `tags`, поэтому тег проставляет `mapLabyTagSkin`, а текстовый поиск внутри тег-выдачи невозможен — при тексте пул снова берётся из общей ленты. За концом выдачи Laby отвечает **403** (не пустым массивом): это штатный конец списка, а не блокировка — `LabyCatalog` превращает его в `endOfFeed`, чтобы UI не показывал ошибку доступа.
- **Скины: кэш.** Один `SkinCache` на каталог вместо прежних трёх: память (TTL, не больше 256 записей) плюс диск через порт (последнее удачное значение для офлайна, текстуры — по неизменному `image_hash`). Пустые результаты поиска в кэш не пишутся.
- **Читалка новостей** — `components/launcher/news-reader-modal.tsx` на теге `<electrobun-webview>` (аналог Electron `<webview>`): тег регистрирует полный preload Electrobun, поэтому атрибуты `sandbox` (гостю доступны только события), `partition` и `transparent`/`passthrough` (пока грузится — React-оверлей виден и кликабелен) обязательны. Адаптер `lib/news-reader-webview.ts` запускает статью один раз после native init из `about:blank` и удаляет позднего гостя при закрытии во время init (гонка SDK 2.0.6). Гостевой preload ставит тему и сообщает о `DOMContentLoaded`: штатный `dom-ready` SDK приходит лишь на `window.load`, его не ждём. `insertCSS` у тега нет: свежие CSS-переменные темы обновляем через `executeJavascript` с `<style>` по событию `theme:applied`. Один идемпотентный MutationObserver обрабатывает лишь добавленные узлы/атрибут `target`, а не весь документ на каждую мутацию. Обычные `<a href>` остаются внутри читалки, картинки/iframe по умолчанию lazy, медиа без autoplay с ручным воспроизведением. При ошибке/таймауте тег удаляется; «Повторить» создаёт нового гостя.
- **Внешние ссылки из окна лаунчера**: `will-navigate` и `new-window-open` ловятся в `electrobun/platform/desktop.ts` и уходят в `shell.openExternal`, как `setWindowOpenHandler`/`will-navigate` в Electron. `new-window-open` приходит только через глобальный `Electrobun.events` (`BrowserView.on` этот тип не принимает), подписка — на `new-window-open-<webviewId>`.
- **Файлы из renderer** (`getFilePath`): у Electrobun нет `webUtils.getPathForFile`, поэтому renderer читает `File` чанками по 8 МиБ (`stageFileBegin` → `stageFileChunk` → `stageFileAbort`, `electrobun/platform/staged-files.ts`). Лимиты: файл 8 ГиБ, все временные файлы процесса 16 ГиБ; каталоги удаляются при выходе.
- **WebView2**: аргументы Chromium выставляются только через `WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS` в `electrobun/main/bootstrap.ts` до `import("./index")` — `--disable-features=FluentScrollbar,FluentOverlayScrollbars` (кастомный скроллбар читалки) и `--disable-gpu-shader-disk-cache`. `app.commandLine` у Electrobun нет.
- **Language**: all user-facing strings go through `react-i18next` (`src/i18n/`), not hardcoded.
- **Оформление новостей лаунчера**: статьи с `newsType: ["Launcher", ...]` или origin `SERVICE_URLS.launcher` определяются `isLauncherNewsArticle` (`lib/news-url.ts`). Они сохраняют оформление сайта: без CSS читалки в preload и без повторной инъекции темы. Оптимизации медиа/ссылок и сигнал готовности остаются.
- **Картинки при навигации**: `CachedAvatar` сначала использует готовый src из памяти, затем дисковый кэш; не менять порядок, иначе на mount будет подмена data → blob. `avatarVersion` хранится через `lib/avatar-cache-version.ts`, а не обновляется при каждом запуске. Иконки `EntityIcon` и аватары закрепляют самостоятельный `Image` через `lib/decoded-image-cache.ts` (64 записи / 8 МиБ оценки RGBA + src); нельзя удерживать настоящий React DOM-узел вместе с fiber.
- **Внешние ссылки UI**: `installExternalLinks` (`lib/external-links.ts`) переносит адрес из `href` в `data-xneon-external-href`, сохраняя роль ссылки, Tab/Enter и единый роутер. Это убирает нативный status bubble WebView2 только в UI; новостные карточки и гостевая читалка сохраняют настоящий `href`.

## Common pitfalls

- After adding/editing IPC channels, run `bun run build` (not just `dev`) to catch type errors across both tsconfigs.
- `multimc.svg` and `polymc.svg` icons don't exist in `public/launcher-icons/` — only `.png` variants are available.
- **SQLite** — приложение использует `bun:sqlite` через `electrobun/platform/sqlite.ts`. База лаунчера открывается в main, WAL и снимки перед миграциями обслуживает `electrobun/db/core.ts`. Импорт Modrinth App читает `instances` и `instance_content_sets` через соединение только для чтения. `better-sqlite3` используется в тестах.
- **Колоночные миграции применяются только при `currentVersion < SCHEMA_VERSION`** (`electrobun/db/migrations.ts`). Добавили `addColumnIfMissing` — поднимите `SCHEMA_VERSION`, иначе на существующей БД колонка не появится вовсе, а запросы с ней упадут с `no such column`.
- `prismarine-nbt` was replaced by `@xnlc/nbt` — do not re-add prismarine-nbt.

## Package manager

Bun 1.4.4 uses the workspace definitions and overrides in `package.json`, the scoped registry in `.npmrc`, and the canonical `bun.lock`. Install with `bun install --frozen-lockfile`.
