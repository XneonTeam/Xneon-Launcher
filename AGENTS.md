# AGENTS.md — Xneon Launcher

## Language

Always respond to the user in Russian.
All explanations, plans, analysis, descriptions of changes, and comments — write in Russian.
Code, function names, API, terminal commands, and error messages — keep in the original language.

## Project

Xneon Launcher — Electrobun + React 19 Minecraft launcher.
- **Renderer** (React): `components/`, `src/`, `lib/`
- **Electrobun main**: `electrobun/main/`, `electrobun/preload.ts`
- **Local packages** (`packages/`): `@xnlc/core`, `@xnlc/mods`, `@xnlc/types`, `@xnlc/nbt`, `@xnlc/servers`, `@xnlc/skins`, `@xnlc/archives`, `@xnlc/parser`, `@xnlc/share`, `@xnlc/agent` — Bun workspace (`workspace:*`). Registry fallback: `https://git.xneon.org/api/packages/MAINER4IK/npm/`
- **Server apps** (`infrastructure/`): `xnlc-share` (Bun/SQLite + Cloudflare Worker/R2) и `xnlc-liveops` (Go + клиентский контроллер). Не входят в Bun workspace; карта путей, запуск и деплой — `infrastructure/README.md`
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
Актуальные benchmarks: `benchmarks/README.md`, `bun run benchmark:scan` и
`bun run benchmark:archives`. Результаты/внутренние аудиты — в игнорируемой
`.local-research/`, не в public docs и не в package publish files.
UI получает только `PublicAccount`, сессиями владеет main. Для cleanup используйте
`registerShutdownTask`, а не собственный рекурсивный before-quit.

## Environment variables

- `XNLC_NEWS_URL` — адрес ленты новостей лаунчера (`fetch:launcher-news`). По умолчанию `https://launcher.xneon.org/news.json`.
- `XNLC_LIVEOPS_URL` — origin сервиса событийных тем (HTTPS, HTTP только для localhost); без переменной сеть LiveOps выключена. Контроллер — `electrobun/main/liveops.ts`, кэш — `<userData>/event-theme-cache`, настройка `eventTheme` отдельна от `customThemes`. Ручной выбор через `liveops:select`/`settings:set("theme")` проходит через main.

## Build pipeline

`prepare:desktop` запускает `scripts/gen-credentials.mjs`, который читает `.env` и генерирует игнорируемый Git файл `electrobun/main/cloud/credentials.generated.ts`. Без `.env` сборка проходит с пустыми значениями для облачных провайдеров.

`build:renderer` = `vite build` → `dist/`
`build:workers` = Bun → `dist-workers/`

**Windows-установщик — NSIS** (`build/installer.nsi` + `scripts/build-windows-distribution.ts`): per-user (`RequestExecutionLevel user`), без страницы выбора каталога, тихая установка `/S`, свой деинсталлятор `%LOCALAPPDATA%\Programs\xneon-launcher\Uninstall Xneon Launcher.exe`.
`bun run build` сохраняет штатные артефакты Electrobun и последним шагом добавляет `xneon-launcher-<version>-win-x64.exe`. Обычные unpacked ZIP, blockmap и latest-метафайлы прежней упаковки больше не создаются. Portable ZIP — отдельная сборка с `PortableProfile`, не копия обычного релиза.
Нужен `makensis` (NSIS 3): ищется через `XNEON_MAKENSIS`, PATH, `Program Files\NSIS` и кэш electron-builder. Установщик ставит неизменённый SDK payload в `$INSTDIR\app\{bin,Resources}` и создаёт junction `%LOCALAPPDATA%\org.xneon.launcher\<channel>` → `$INSTDIR`; ярлыки запускают `…\org.xneon.launcher\<channel>\app\bin\launcher.exe`, иначе SDK-обновления отказывают («outside its managed update directory»).
Идентификатор приложения — `org.xneon.launcher` (`electrobun/main/app-identity.ts`, portable — `org.xneon.launcher.portable`). Миграция старого `com.xneonlauncher.app` и Electron-установок сохранена: `ClearLegacyInstallRoot`, очистка старых ключей, обработчик `xneon://`, параметры `--updated --force-run /D=… --package-file=…` и `RunLauncherIfRequested` не являются лишней упаковкой. Данные `%APPDATA%\xneonlauncher` не удаляются. Обновление/переустановка сохраняют `$INSTDIR\WebView2`; удаляется только бандл `app\`.

## Key architecture notes

- **Релизы — штатные артефакты Electrobun**: `<channel>-<platform>-<arch>-update.json`, `-update-v2.json`, `.tar.zst` и SDK-установщик. Stable Windows: `win-x64-XneonLauncher-Setup.zip` + отдельный NSIS; macOS arm64: `macos-arm64-XneonLauncher.dmg`; Linux x64: `linux-x64-XneonLauncher-Setup.tar.gz`. Конвертация в прежние deb/rpm/pacman/AppImage, обычный unpacked ZIP и electron-builder metadata удалена.
- **CI validation без переупаковки** — `scripts/electrobun-artifacts.ts` проверяет identity, version/channel/arch, tar integrity, executable headers и отсутствие credentials/служебных файлов; staging копирует байты/имена без изменений и добавляет `SHA256SUMS.txt`. `validate-pre-release.ts` требует NSIS дополнительно к штатному Windows набору. `package-windows-portable.ts <new-output>` проверяет самостоятельный portable профиль; не зависит от обычного NSIS/ZIP/metadata.
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
- **Читалка новостей** — `components/launcher/news-reader-modal.tsx` на теге `<electrobun-webview>` (аналог Electron `<webview>`): тег регистрирует полный preload Electrobun, поэтому атрибуты `sandbox` (гостю доступны только события), `partition` и `transparent`/`passthrough` (пока грузится — React-оверлей виден и кликабелен) обязательны. `insertCSS` у тега нет: тему и скрытие сайтовой обвязки впрыскиваем `executeJavascript` с `<style>`. Шрифты/цвета берутся из текущих CSS-переменных темы, свежие — по событию `theme:applied`. Обычные `<a href>` в статье остаются внутри читалки (у `target` атрибут снимается).
- **Внешние ссылки из окна лаунчера**: `will-navigate` и `new-window-open` ловятся в `electrobun/platform/desktop.ts` и уходят в `shell.openExternal`, как `setWindowOpenHandler`/`will-navigate` в Electron. `new-window-open` приходит только через глобальный `Electrobun.events` (`BrowserView.on` этот тип не принимает), подписка — на `new-window-open-<webviewId>`.
- **Файлы из renderer** (`getFilePath`): у Electrobun нет `webUtils.getPathForFile`, поэтому renderer читает `File` чанками по 8 МиБ (`stageFileBegin` → `stageFileChunk` → `stageFileAbort`, `electrobun/platform/staged-files.ts`). Лимиты: файл 8 ГиБ, все временные файлы процесса 16 ГиБ; каталоги удаляются при выходе.
- **WebView2**: аргументы Chromium выставляются только через `WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS` в `electrobun/main/bootstrap.ts` до `import("./index")` — `--disable-features=FluentScrollbar,FluentOverlayScrollbars` (кастомный скроллбар читалки) и `--disable-gpu-shader-disk-cache`. `app.commandLine` у Electrobun нет.
- **Language**: all user-facing strings go through `react-i18next` (`src/i18n/`), not hardcoded.

## Common pitfalls

- After adding/editing IPC channels, run `bun run build` (not just `dev`) to catch type errors across both tsconfigs.
- `multimc.svg` and `polymc.svg` icons don't exist in `public/launcher-icons/` — only `.png` variants are available.
- **SQLite** — приложение использует `bun:sqlite` через `electrobun/platform/sqlite.ts`. База лаунчера открывается в main, WAL и снимки перед миграциями обслуживает `electrobun/db/core.ts`. Импорт Modrinth App читает `instances` и `instance_content_sets` через соединение только для чтения. `better-sqlite3` используется в тестах.
- **Колоночные миграции применяются только при `currentVersion < SCHEMA_VERSION`** (`electrobun/db/migrations.ts`). Добавили `addColumnIfMissing` — поднимите `SCHEMA_VERSION`, иначе на существующей БД колонка не появится вовсе, а запросы с ней упадут с `no such column`.
- `prismarine-nbt` was replaced by `@xnlc/nbt` — do not re-add prismarine-nbt.

## Package manager

Bun 1.4.4 uses the workspace definitions and overrides in `package.json`, the scoped registry in `.npmrc`, and the canonical `bun.lock`. Install with `bun install --frozen-lockfile`.
