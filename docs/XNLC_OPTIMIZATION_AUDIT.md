# Xneon Launcher — аудит оптимизации и архитектуры (analysis-only)

Дата: сессия аудита, ветка 1.0.6 (последний коммит `359b25b`). Режим: только чтение — код, конфигурация, БД и пакеты не изменялись. Метод: 7 параллельных зон инспекции (main/preload/IPC, builds, mods/launch, db, packages, renderer, фоновые сервисы) + собственное чтение ключевых файлов (`electron/main/index.ts`, `window.ts`, `runtime.ts`, `ipc-router.ts`, `db/core.ts`, `builds/scanner.ts`, `builds/content-resolver.ts`, `builds/metadata.ts`, `builds/helpers.ts`, `builds/update-checker.ts`, `minecraft-core.ts`, `mods.ts`, `jar-cache.ts`, `components/launcher/instance/use-builds.ts`, `lib/modrinth-metadata.ts`) + два предыдущих аудита в репозитории (`CODE_DEDUP_AUDIT.md`, `electron-dedup-audit.md`).

# Executive Summary

Экосистема уже частично оптимизирована (последние коммиты `647c8bf` «лёгкий список сборок», `2fcd70c` «точечное сохранение»): есть двухуровневый кэш сканирования (`file_snapshots` + `resources` в SQLite), ленивая загрузка тяжёлого контента сборок, фоновое сетевое обогащение, launch-пайплайн вынесен в fork-worker. Это хороший фундамент.

Главные оставшиеся проблемы по убыванию влияния:

1. **Тройной/четверной проход по одним и тем же JAR-файлам**: sha1 (`content-resolver.ts:hashResource`), полное чтение в adm-zip ради метаданных (`builds/metadata.ts:readModMetadataFromArchive`), второе полное чтение ради MurmurHash2 CurseForge (`builds/fingerprint.ts:computeFingerprint` — синхронный побайтовый JS в main-процессе), плюс независимый четвёртый парсинг в `mods-loader-requirements.ts`. Три несвязанных кэша.
2. **fsync-шторм в БД**: `synchronous = FULL` (`db/core.ts:195`) + нетранзакционные циклы upsert'ов в `content-resolver.ts` (N+1 по коммиту на файл).
3. **Тяжёлый `loadBuilds()` (`SELECT *` с JSON-колонками, ~183 МБ текста на 17 сборок по комментарию `db/builds.ts:147-149`) вызывается из ~12 мест**, где нужны 1–4 лёгких поля — включая `launch-orchestrator.ts:247` при каждом выходе из игры.
4. **Renderer: ноль code-splitting'а** — `launcher.tsx:3-14` статически импортирует все страницы, three/skinview3d/recharts/prismjs/react-markdown грузятся при старте; `manualChunks` в `vite.config.mts:43-71` это не спасает. WebGL-контекст + rAF-цикл на каждый скин в библиотеке.
5. **IPC-контракт расходится с реальностью**: найден реальный баг — хендлер `launcher:discover-from-path` есть (`system.ts:183`), тип есть, вызов из renderer есть (`instance-create-dialog.tsx:171`), а preload-метода нет → runtime TypeError. Плюс мёртвые legacy-контракты `cloud:*` и дрейф сигнатур.
6. **Повторный полный rescan папки модов после каждой установки/удаления мода** (цикл `addModToBuild → reloadBuilds → syncBuildContent → scanIntentDir`).

# Current Architecture

Монорепо pnpm (`packages/*`), Electron 43 + React 19, better-sqlite3 v13 (Node-API prebuilds).

- **Main** (`electron/main/`, 89 файлов): `index.ts` регистрирует 15 групп IPC-хендлеров (~215 каналов) при загрузке модуля; окно создаётся в `app.whenReady` до инициализации БД (`window.ts:127-137`); БД и runtime-paths инициализируются параллельно; `@xnlc/mods` и `discord-rpc` — dynamic import с fire-and-forget прогревом (`index.ts:37-38`).
- **Preload** (`electron/preload.ts`, 46,8 KB): единый объект `window.electronAPI` через `exposeInMainWorld`; плюс два почти идентичных auth-моста (`auth-preload.ts`, `auth-xnskins-preload.ts`).
- **Renderer**: `src/App.tsx` (3 контекста: Accounts, LaunchLogs, ActivityCenter) → `components/launcher/launcher.tsx` (все страницы статически) → страницы/хуки.
- **Пакеты**: `@xnlc/types` (только типы), `@xnlc/core` (движок запуска, worker-safe, без electron-импортов), `@xnlc/mods` (HTTP-клиенты Modrinth/CurseForge/FTB), `@xnlc/nbt`, `@xnlc/servers`. Линковка — junction через `scripts/sync-local-xnlc.mjs` (в root package.json при этом semver-диапазоны `^1.0.x`, не `workspace:*`).
- **Запуск игры**: IPC `minecraft:launch` → `launch-orchestrator.ts` (main) → `fork("minecraft-launch-worker.js")` → `@xnlc/core` `services/launch-pipeline.ts`. Worker одноразовый на запуск.
- **Хранилище**: `data.db` (WAL), схема идемпотентная без версионирования (`DB_FORMAT_VERSION = 1` никогда не инкрементировался); тяжёлые списки модов хранятся JSON-строками в таблице `builds`.

# Architecture Map

Фактический (не предполагаемый) поток:

```
Renderer (React)
  ├─ window.electronAPI (electron/preload.ts, ~150 методов)
  │    └─ ipcRenderer.invoke ──► ~215 ipcMain.handle в 15 модулях electron/main/*
  │                                 ├─ electron/db/* (dbHelpers фасад → core.ts → better-sqlite3, sync)
  │                                 ├─ builds/scanner → content-resolver → metadata/fingerprint (fs, adm-zip, main-процесс!)
  │                                 ├─ @xnlc/mods (ленивый import; Modrinth/CurseForge/FTB HTTP)
  │                                 ├─ minecraft.ts → ipc-router.ts → callHandler → XnlcHandler (@xnlc/core)
  │                                 └─ launch: launch-orchestrator → fork(worker) → @xnlc/core launch-pipeline → fs/network
  ├─ push-события main→renderer (~25 каналов: minecraft:*, import:progress, stats:updated, mc-server:*, ...)
  └─ ПРЯМОЙ fetch в обход main: lib/modrinth-metadata.ts → api.modrinth.com (renderer)
```

Отклонения от «чистой» схемы: (1) renderer ходит в Modrinth API напрямую, дублируя сетевой слой main; (2) `ipc-router.ts` используется только 2 модулями из 15 (minecraft.ts ~44 канала, quick-play.ts 3); (3) `auth.ts` регистрирует хендлеры на верхнем уровне модуля, а не в register-функции; (4) канал `content:install-remote` живёт внутри `builds/index.ts:805` (чужой домен), `xn-connect:*` — внутри `mc-server-handlers.ts:1245-1276`, `read-local-file` без доменного префикса — в `skins.ts:106`.

# Critical Findings

1. **Баг: разрыв preload ↔ handler.** `launcher:discover-from-path`: хендлер `system.ts:183`, тип `ipc-contracts.ts:382`, вызов `instance-create-dialog.tsx:171` — preload-метод отсутствует → TypeError при выборе кастомного пути импорта.
2. **Баг-кандидат: `.litemod` невидим для сканера.** `content-drop.ts:24` принимает `.litemod`, `scanner.ts:63` сканирует только `/\.(jar|zip)(\.disabled)?$/i` — принятый дропом файл исчезнет из списка после rescan (парсер `litemod.json` в `metadata.ts:94` при этом есть).
3. **Блокировка main-процесса MurmurHash2**: `fingerprint.ts:computeFingerprint` — синхронный побайтовый JS-цикл по всему содержимому JAR (сотни МБ на больших паках) в main-процессе. Смягчено флагом `cfChecked` и чанками по 4, но при первом скане новых модов UI фризится.
4. **Dropbox теряет авторизацию через ~4 часа**: `cloud/providers/dropbox.ts:60-99` запрашивает `token_access_type:"offline"`, но не сохраняет refresh_token и не имеет refresh-логики — единственный OAuth-провайдер без неё.
5. **Утечка discord-rpc Client**: `discord-rpc.ts:loginWithRuntimeDir` — при неудачном login() client с listeners не destroy'ится; retry каждые 15 с создаёт новый. Нет destroy на before-quit.
6. **Мёртвые подписчики метрик сервера**: `mc-server-handlers.ts:624-645` — `metricsSubscribers` не чистятся при destroyed webContents; таймер 1 с живёт, пока жив мёртвый подписчик.
7. **Расхождение типов БД**: `DbBuild` (`@xnlc/types domain-types.ts:55`) vs `BuildJson` (`electron/db/builds.ts:4`) разошлись в обе стороны (`modpackVersionId`, `windowOverride*` только в BuildJson; `defaultAccountId` только в DbBuild). Источник истины неясен.
8. **Несогласованный fallback БД**: при недоступности SQLite accounts/builds/settings хранятся в памяти, а `ai.ts`, `mc-servers.ts`, `cloud.ts`, `skins.ts`, `resources.ts`, `snapshots.ts` молча теряют записи (`aiAddMessage` — no-op).
9. **Сироты в БД**: `deleteMcServer`/`purgeTrashedMcServers` (`db/mc-servers.ts:76-84`) не чистят `server_sessions`.
10. **Security-заметки**: `read-local-file` (`skins.ts:106`) читает произвольный путь из renderer без вайтлиста; три реализации проверки «путь внутри папки» с разным поведением регистра (`builds/helpers.ts:683` vs `:188` vs `:273`).

# Performance Findings

**Сканирование контента инстанса** (20 инстансов × 100–200 модов):
- Тёплый путь хорош: readdir ×3 + 1 stat на файл + 2 батч-запроса SQLite; неизменённые JAR не перечитываются (`file_snapshots` по size+mtime, `resources` по sha1).
- Холодный путь (K новых модов): K × (1 чтение sha1 + 1 полное чтение в adm-zip + 1 полное чтение murmur) ≈ 3 полных прохода по данным; AdmZip держит весь JAR в памяти без капа размера (в отличие от `mods-loader-requirements.ts` с порогом 80 МБ), чанки по 8 → пики памяти в сотни МБ.
- `scanner.ts:scanIntentDir` обходит mods/resourcepacks/shaderpacks последовательно (`:90`, `:101`) — три прохода resolver'а вместо одного объединённого.
- `mergeContent` в `use-builds.ts:135-142` — O(N²) fuzzy-fallback (`existing.find` внутри `incoming.map`): 300 модов = ~90k сравнений строк на rescan.

**Запуск игры** (всё в worker, UI не страдает, но время запуска страдает):
- Assets статятся 3–4 раза за запуск: `countAssets`/`countTotalSize` (`assets-manager.ts:139`) + `downloadAssets:78` — ~5–13 тыс. синхронных stat-вызовов на прогретом кэше.
- `resolveLibraries` (`libraries-manager.ts:130`) прогоняется 4 раза за запуск (download, classpath, natives ×2).
- Java резолвится дважды в worker: `resolveRequiredJavaVersionForPayload:325` и `prepareJavaEnvironmentForInstallers:344`.

**Миры и скриншоты**:
- `worlds.ts:dirSize` — полный рекурсивный обход каждого мира (кап 200 000 entries) с stat на каждый файл, параллельно по всем мирам, при каждом `worlds:list`.
- `worlds.ts:listScreenshots` — читает каждый скриншот целиком, декодирует, ресайзит в PNG→base64 одним IPC-payload; `screenshots:get` перекодирует даже JPEG в PNG (раздувает payload).

**Проверка обновлений**: fs-операций 0 (sha1 из БД), сеть батчами по 100 (Modrinth), фоллбеки поштучно при concurrency 4 — разумно. Мелочь: `getResources` вызывается 3 раза (по типам контента) вместо одного (`update-checker.ts:322`).

# Database Findings

Слой: `core.ts` (queryAll/run/prepare/transaction, кэш prepared statements лимит 200) → 11 доменных модулей → фасад `dbHelpers` → ~23 потребителя в main. Лишних репозиториев нет — плюс. Индексы покрывают запросы в целом хорошо.

1. **N+1 и fsync-шторм** (`content-resolver.ts`): `enrichWithModrinthInBackground:237-268` — `getResources([sha1])` + `upsertResource` на каждый мод (хотя `resourceBySha1` уже загружен батчем на :322); `enrichWithCurseforgeInBackground:518-549` — до 3 запросов на файл, `markResourcesCurseforgeChecked([sha1])` по одному при батчевом API; `resolveContentEntries:308-311` — `upsertFileSnapshot` на файл без транзакции. Каждый `run()` при `synchronous=FULL` (`core.ts:195`) = fsync.
2. **Тяжёлые чтения**: `loadBuilds()` (`db/builds.ts:140`, `SELECT *` + JSON.parse всех тяжёлых полей) вызывается там, где нужны лёгкие поля: `launch-orchestrator.ts:247` (каждый выход из игры), `system.ts:139,156,191,214`, `builds/index.ts:125,209,529,677,735`, `storage.ts:87,329`, `cloud/handlers.ts:260,374`. `updateBuildFields` (`db/builds.ts:442-445`) всегда читает тяжёлые колонки — даже при смене только `icon`.
3. **`saveAllBuilds` (`db/builds.ts:249`)**: «DELETE всех + вставка всех» с предварительным чтением и парсингом всего тяжёлого контента (до ~183 МБ JSON).
4. **Статистика**: `listGameSessions()` (`db/stats.ts:42`) тянет всю таблицу без WHERE по диапазону; фильтрация в JS (`main/stats.ts:66-69`); renderer опрашивает каждые 5 с. Индекс `game_sessions(buildId, buildName)` не помогает `DELETE ... WHERE buildName IN (...)` (`stats.ts:70`).
5. **Нет кэша настроек**: `getSetting` — sync-чтение SQLite на каждый вызов; `config.ts` геттеры и `ai-agent.ts:103-106,329-331,359-407` дёргают одни и те же ключи постоянно.
6. **Кэш обновлений модов целиком в одной строке settings** (`update-checker.ts:290`, порог компакции 1 МБ).
7. **Кэш prepared statements**: при переполнении лимита 200 — полный `statementCache.clear()` (`core.ts:99-102`), динамические `IN (?,?,…)` плодят записи на каждую длину массива.
8. **Миграции без версионирования**: `user_version` — маркер «открывалось better-sqlite3», а не версия схемы; ~30 `PRAGMA table_info` при каждом старте (дёшево, но упорядоченные data-миграции невозможны).
9. **Мелочи**: `builds/index.ts:224` — DELETE в цикле вместо `IN (...)`; `stats.ts:63-73` — два DELETE без транзакции; `aiDeleteSession` вручную удаляет сообщения при наличии FK ON DELETE CASCADE.

# Electron Findings

**Main — старт**: регистрация хендлеров eager (дёшево), окно до БД, БД+paths параллельно, `loadInstancesRoot` + `migrateIntentDirNames` при каждом старте (`window.ts:141-142`). Лениво: `@xnlc/mods`, `discord-rpc`, `@xnlc/core/microsoft`, launch-worker. Блокирующее на старте — только sync better-sqlite3 open/pragma/схема.

**Main — дефекты жизненного цикла** (подробности в Critical/сервисах):
- `auth.ts:304-311,398-405` — 30-с таймаут-таймеры логина не снимаются при успехе (правильный finally-паттерн есть рядом в `pollDeviceToken:533`); OAuth loopback в 4 cloud-провайдерах — `setTimeout(120000)` не снимается при успехе.
- `xn-connect-manager.stopAll()` существует, но не вызывается при quit.
- Temp-zip при облачной выгрузке удаляется только на успешном пути (`cloud/handlers.ts` upload-*, нет finally).
- Скачивание из облака целиком в память во всех 6 провайдерах (arrayBuffer→Buffer→writeFile); `s3.ts:226-239` и upload читает файл целиком, прогресс фиктивный 50/100.
- `system.ts:248-325` Java-детект НЕ кэшируется: 8 reg query + перебор 7 каталогов + последовательный spawn `java -XshowSettings:properties` (6 с таймаут) на каждый найденный java.exe → 10–20 процессов, до 30 с, повторяется при каждом вызове. Из renderer дёргается из 5 компонентов без общего кэша.
- `servers.ts:18,24` — sync `readFileSync`/`writeFileSync` servers.dat в main; `mc-server-handlers.ts:697-812,879-979` — sync fs в 21 хендлере.
- `storage.ts:scanBuilds` — двойной обход: полный `getDirectorySize` + повторный обход 8 подпапок.

**Preload**: 46,8 KB, ~150 методов; два почти идентичных auth-моста (`auth-preload.ts` ↔ `auth-xnskins-preload.ts`, известно из `CODE_DEDUP_AUDIT.md` H3 — не исправлено); общий параметризованный мост есть (`auth-callback-bridge.ts`), но используется не полностью.

# IPC Findings

215 регистраций, дубликатов каналов нет. Домены: window(5), auth(9+dynamic), system/db/shell/java(25), mods(22), minecraft(~44), builds(~35), worlds/screenshots(15), servers(3), quickplay(3), ai(12), skins(11), stats(1), storage(2), cloud(14), mc-server(50), updater(4). Push-событий ~25 каналов.

1. **Двойной стандарт регистрации**: `ipc-router.ts` (ctxHandler/rawHandler) используется только minecraft.ts и quick-play.ts; остальные 13 модулей — прямой `ipcMain.handle`. Семантика ошибок различается: ctxHandler глотает ошибку и возвращает fallback (renderer не отличит ошибку от пустого результата), raw — `{success,error}`.
2. **Контракт не «single source of truth»**: `IpcInvokeMap` не содержит ~20 реальных каналов (minecraft:{paper,purpur,folia,velocity,waterfall,sponge}-*, quickplay:*, почти все mc-server:*, update:*, servers:ping, worlds:copy/reset-icon, mods:ftb-catalog-facets, read-local-file, launcher:discover-from-path); `IpcEventMap` не содержит ~12 push-каналов. Рассинхрон сигнатур: `mods:ftb-search` (контракт 2 аргумента, preload шлёт 3), `db:load-builds-light` типизирован как `DbBuild[]`, фактически `BuildLightJson`; `mc-server:download-progress` типизирован двумя разными формами в одном файле контрактов.
3. **Мёртвые legacy-контракты cloud**: `cloudLogin/cloudRegister/cloudGetUser/cloudGetStorageInfo/cloudGetFiles/...` (ipc-contracts.ts:500-510) — Omit'нуты, хендлеров и preload-методов нет; имена конфликтуют с новым provider-API. `build:upload-to-cloud` — мёртвый контракт.
4. **Избыточные payload**: `db:load-builds` (system.ts:133) отдаёт полные сборки по IPC — renderer его реально не использует (только `loadBuildsLight`); `db:save-builds` шлёт полный массив всех сборок при каждом сохранении; `screenshots:get`/`screenshots:list` — base64 по IPC; `build:get-content-updates-cache` + `-counts` — counts выводимы из cache (два канала вместо одного).
5. **Гранулярность**: 12 каналов whitelist/ops/ban — идентичный read-modify-write JSON каркас (кандидат на один канал с op); 9 каналов `mc-server:fs-*`; ~35 однотипных `minecraft:get-*-versions` прокси.
6. **Pull там, где есть push**: после мутаций worlds/screenshots/servers/whitelist хендлеры возвращают только `{success}` — renderer обязан перезапрашивать; `stats-page.tsx:180` поллит `stats:overview` каждые 5 с, хотя push-подписки `onStatsUpdated`/`onMcServerStateChange` рядом триггерят тот же load(). Коллизия имени: `mc-server:metrics` — и invoke, и push-канал подписки.

# UI Findings

1. **Нет code-splitting'а**: `launcher.tsx:3-14` статически импортирует все страницы → three+skinview3d (~600 КБ), recharts+d3, prismjs (+5 `?raw` языков), react-markdown (5 файлов) в стартовом графе. `manualChunks` (`vite.config.mts:43-71`) + `modulePreload:false` не спасают: чанки скачиваются и парсятся при старте. Комментарий про «lazy tabs» в конфиге не соответствует коду.
2. **WebGL на каждый скин**: `skin-grid.tsx:150` → `skin-card.tsx:80` → `skin-viewer-3d.tsx:20-21` — `new SkinViewer` + бесконечный rAF `IdleAnimation` на каждую карточку библиотеки, без IntersectionObserver. Браузерный лимит ~16 WebGL-контекстов.
3. **Виртуализации нет нигде** (0 совпадений react-window/virtual/virtuoso): `logs-page.tsx:542` — до 2000 строк с regex-токенизацией `tokenizeLog` (~15 регэкспов на строку) при каждом рендере фильтра; `console-tab.tsx:197` — все строки консоли сервера, буфер `use-mc-servers.ts:178` без cap; `instance-content-tab.tsx:549` — 300+ модов без виртуализации и memo строк.
4. **Иконки модов**: `instance-content-tab.tsx:565` — `<img src>` без lazy/кэша: 300+ HTTP к CDN при каждом открытии вкладки. Эталонный `cached-avatar.tsx` (память+localStorage+dedup) существует, но не применён.
5. **Три независимых источника сборок**: `use-builds.ts` (модульные кэши), `use-home-versions.ts:48`, `cloud-file-browser.tsx:534,547` (последний — полный `loadBuilds()` ради id/name/icon + дублированный useEffect 533-556). Аккаунты: контекст + localStorage + прямое чтение в cloud-file-browser. Тема: три источника.
6. **Утроенное состояние поиска модов**: `instance/index.tsx:37-77` — mr/cf/ftb копии одной структуры вместо параметризованного хука; `InstanceDetail` ~50 пропсов.
7. **Побочные эффекты в setState-апдейтерах**: `AccountsContext.tsx:130,133,154` (IPC внутри setAccounts — риск двойного вызова в StrictMode).
8. **Неравномерный кэш данных**: `lib/swr.ts dataCache` используется выборочно; `instance-detail.tsx:229,315,561,614` и `instance-content-tab.tsx:589-593` дёргают API напрямую.
9. **i18n** — локали ленивые (хорошо), но `App.tsx:21,35` блокирует рендер до initI18n.
10. **Прямой fetch из renderer**: `lib/modrinth-metadata.ts` — batched, с кэшем, но дублирует сетевой слой main (`@xnlc/mods`) и не делится кэшем с ним.

# XNLC Types Findings

- Runtime-кода нет — соответствует назначению. Но `ipc-contracts.ts:80` импортирует `ServerStatusResult` из `@xnlc/servers` при пустых deps и обратной зависимости servers→types → **циклическая пара types↔servers** (type-only, рантайм не ломается, граф сборки цикличен).
- Дубли с расхождениями: `DbBuild` vs `BuildJson` (см. Critical #7); `AuthSession` (types vs core `types/index.ts:190` — разная опциональность); `LaunchRequestOptions`/`ResolvedLaunchRequest` (launch-types.ts ≡ core `launch-utils.ts:12,25`); `JarDeclaredDependency`/`JarDependencyInspection` ≡ `mods-jar-deps.ts:37,44`; `ContentDrop*` ≡ `content-drop.ts:4-21`; `LoaderRequirementReport` живёт в main и `src/electron.d.ts:28-51`, а в types его нет.
- Мод-типы дублируются в `@xnlc/mods types.ts` с фактической потерей данных: `ModLoaderFilter` там без `"forge"` (`mods/types.ts:34` vs `mod-types.ts:9`).
- Три параллельных описания IPC в одном файле (IpcInvokeMap + IpcEventMap + ElectronAPIExplicit/Extra) + preload.ts + electron.d.ts = 4–5 мест синхронизации.
- Мёртвые экспорты: `VersionEntry`, deprecated-алиасы `ElyByPayload/XnSkinsPayload/MicrosoftPayload`.

# XNLC Core Findings

- Worker-safe (без electron-импортов) — позволяет fork-worker. Реально используется ~15 из ~60 экспортов; CLI-пережитки в XnlcHandler (`interactiveLaunch` readline, `launchVanilla/Fabric/...` шорткаты, `handler.ts:238-342`) — в приложении не вызываются.
- Дубли с electron: `getLoaderProfileName` (`builds/helpers.ts:654`) — сознательное зеркало `LoaderService.getProfileName` (`loader-service.ts:232`); `normalizeJavaPath` — побайтовые копии в worker и `core/utils/index.ts:432-435`; платформенные пути `paths.ts` vs `launch-utils.ts:82`.
- Внутренние перф-проблемы: assets 3–4 прохода stat'ов; `resolveLibraries` ×4 за запуск; внутренний дубль сравнения версий (`shared-helpers.ts:84` vs `profile-builder.ts:36`); `writeClasspathFile` (`launch-builder.ts:177`) — мёртвый код, при этом защиты от переполнения командной строки Windows (>32k) нет.
- Мёртвые экспорты: `LaunchError` (нигде не выбрасывается), `ensureAuthlibInjector`, `collectSupportedVersions`, `sha1Hash*`, `formatBytes`, `normalizeJavaPath`.
- Хорошее: `retry.ts` (fetchWithRetry) используется 8 файлами electron — эталон консолидации; Downloader с tmp+rename, ретраями, fallbackUrls, skipIfExists по size.

# Other XNLC Packages

- **@xnlc/mods**: чистые HTTP-клиенты без deps; свой 429/retry-after (специализирован, допустимо). electron `mods.ts` — тонкий слой без дублей. Мёртвые внешние экспорты: `ftbGetDetailsVersion`, `splitFtbTags`, `ftbCatalog`, `ftbSearchModpacks`, `ftbFeaturedModpacks`, `ftbGetModpack`, `MOD_SORT_OPTIONS`, `CONTENT_TYPE_FACETS`.
- **@xnlc/nbt**: ~400 строк, дублей NBT нет, использование корректно (servers.dat raw, level.dat gzip).
- **@xnlc/servers**: ~2000 строк; все `get*Versions` используются; `jar-analyzer.ts:51` — четвёртый независимый adm-zip парсер (серверные jar); экспорты `parseHost`, `STARTUP_DONE_PATTERNS` и др. — внешне мёртвые. `ServerStatusResult` дублируется структурно в renderer `controls.tsx:54-67`.
- Межпакетное: sha1 — 3 реализации (core in-memory, content-resolver потоковая, mc-server-handlers sync-чанкованная); сравнение версий — 3 копии; URL-константы размазаны (core `constants/urls.ts` vs `system.ts:18` vs `auth.ts:9-15,72-80`).
- `mc-server-handlers.ts:1003-1015` — локальная копия Modrinth `version_files` ≡ `modrinthGetFilesByHash`, при уже импортированном @xnlc/mods.

# API Findings

- **Дублирование семантики**: `db:load-builds` / `db:load-builds-light` / `db:load-build-content` — осмысленная тройка (полный/лёгкий/контент), но полный канал не нужен renderer'у и опасен. `update:check` + `update:info` — pull поверх push-событий.
- **Пересекающиеся домены**: `content:install-remote` внутри builds; `xn-connect:*` внутри mc-server-handlers; `read-local-file` без префикса.
- **Сетевые API**: Modrinth/CF/FTB доступ есть и через main (`@xnlc/mods`), и напрямую из renderer (`lib/modrinth-metadata.ts`) — два кэша, две точки отказа.
- **Категории/лоадеры/версии**: `mods:modrinth-categories` и т.п. не кэшируются в main — каждый вызов = HTTP (смягчается renderer-кэшем `category-badge.tsx`, но main-сторона голая).
- **Нет bulk-API для настроек**: `settings:get/set` по одному ключу за IPC (22 вызова setSetting из renderer).

# What Can Be Combined

## WHAT CAN BE COMBINED — XNLC и electron

1. **Три JAR-парсера модов → один инспектор.**
   - CURRENT: `builds/metadata.ts:readModMetadataFromArchive` (имена/версии/иконки), `mods-jar-deps.ts:readDeclaredDependencies` (deps), `mods-loader-requirements.ts:readModLoaderRequirements` (требования лоадера) — каждый сам открывает JAR (readFile + AdmZip) и парсит те же fabric.mod.json/quilt.mod.json/mods.toml. Плюс 3 разных кэша (SQLite resources, Map по URL, Map по size+mtime).
   - OVERLAP: чтение архива и разбор трёх форматов метаданных — дословно пересекается (`findEntryName` ≡ `findModsTomlEntry`).
   - PROPOSED: единый `jar-inspector` (в electron/main или в @xnlc/mods): «(path,size,mtime) → { metadata, dependencies, loaderRequirements }», один проход по zip, общий кэш в SQLite рядом с file_snapshots.
   - API: `inspectJar(path): Promise<JarInspection>`; потребители — scanner, mods:inspect-jar-dependencies, mods:check-loader-requirements.
   - BENEFIT: до 3 полных чтений JAR → 1; один кэш; меньше памяти (нет параллельных AdmZip буферов); консистентные результаты.
   - RISK: средняя миграция трёх вызывающих сайтов; формат кэша — миграция БД (новая таблица или колонка).

2. **Мод-типы → один источник в @xnlc/types.** CURRENT: `@xnlc/mods types.ts` ≡ `mod-types.ts` с расхождением `ModLoaderFilter` (потерян "forge"). PROPOSED: mods реэкспортирует из types. BENEFIT: устранение тихого бага фильтрации Forge. RISK: низкий, type-only.

3. **`getLoaderProfileName` → экспорт из @xnlc/core** (`loader-service.ts:232`), удалить зеркало `builds/helpers.ts:654` + `LOADER_PROFILE_RE`. RISK: низкий.

4. **Сравнение версий → одна реализация.** CURRENT: `core/shared-helpers.ts:84`, `core/profile-builder.ts:36`, `builds/version-range.ts:18`, `update-checker.ts:75-101` (extractSemverNumbers/compareSemver) — 4 копии. PROPOSED: одна в @xnlc/core или @xnlc/types-utils, остальные импортируют. RISK: низкий, но семантики чуть различаются (semver-extract vs version-parts) — нужна сверка тестами.

5. **Версионный fingerprint+sha1+метаданные за одно чтение файла.** CURRENT: `hashResource` (стрим), `readModMetadataFromArchive` (полный readFile), `computeFingerprint` (полный readFile). PROPOSED: один стрим с tee sha1+murmur; метаданные — чтение только central directory ZIP. BENEFIT: 3 чтения → 1 на новый файл; уходит блокирующий murmur из main. RISK: средний (свой минимальный ZIP-reader вместо adm-zip для central directory).

6. **Cloud-провайдеры**: 6 копий token-store, 3 копии OAuth refresh, 4 копии loopback-flow (~60 строк каждая, порты 18932/34/35/36), 3 рассинхронизированные копии CATEGORY_MAP (`cloud/handlers.ts:361,415`, `upload-worker.ts:30`). PROPOSED: общий `oauth-loopback.ts` и `token-store.ts` в `cloud/`, единая CATEGORY_MAP. RISK: низкий-средний, поведение провайдеров идентично по каркасу.

7. **Импортёры** (`import/*`): общий скелет discover в 5 файлах, 4 копии нормализации лоадера, 2 идентичные getXxxDbPath, `countFilesInDirs` с полным рекурсивным обходом ради счётчика. PROPOSED: параметризованный discover-фреймворк поверх существующего `import/helpers.ts` (он уже общий). RISK: низкий.

8. **mc-server-handlers.ts (1367 строк, 54 хендлера)**: 12 хендлеров списков игроков с идентичным каркасом → фабрика; 8 fs-хендлеров с 8 копиями traversal-check → общий helper; `findJavaPath:1301` дублирует Java-детект system.ts; мёртвый двойной resolve лоадера в install-pack (:1089-1101,:1108-1114); 5 хендлеров xn-connect (:1243-1284) перенести в свой модуль. RISK: низкий-средний.

9. **Мелкая консолидация**: `mc-server-handlers.ts:1003-1015` → `modrinthGetFilesByHash`; `normalizeJavaPath` worker→core; `formatBytes` ×5 и форматтеры дат ×3 (известно из CODE_DEDUP_AUDIT M1/M3, частично не исправлено: `server/files-tab.tsx:66-70` своя копия); `sendToRenderer` ×4 (electron-dedup-audit H1 — проверить статус; каноническая версия в `runtime.ts:102-107`).

# What Should Stay Separate

- **@xnlc/nbt** — изолированный маленький пакет без пересечений; слияние ничего не даёт.
- **@xnlc/servers ≠ @xnlc/core** — серверные процессы и клиентский запуск — разные bounded context'ы и жизненные циклы.
- **@xnlc/mods ≠ @xnlc/core** — внешние каталоги vs локальная установка; mods сознательно без зависимостей.
- **`downloadBuffer` (electron, память+IPC-прогресс) ≠ core Downloader (файл+sha1)** — разная семантика.
- **Java-детект `system.ts` (UI-скан установленных Java) ≠ `JavaManager` (скачивание рантаймов)** — допустимо, но нужен общий кэш результата первого.
- **@xnlc/types — только типы**: перенос runtime-кода в него сломает роль пакета (и увеличит связность). Исключение — общие чистые функции-утилиты, если решите их туда класть, осознанно.
- **Типы vs runtime в целом, API-клиенты vs доменная логика** — текущее разделение правильное, проблема только в дублировании контрактов.

# Duplication Findings

Сверка с предыдущими аудитами: `CODE_DEDUP_AUDIT.md` (H1 типы миров ×5, H2 IPC-поверхность ×3, H3 auth-пreload ×2, H4 toErrorMessage ×38, M1 formatBytes ×5, M4 data root ×2) и `electron-dedup-audit.md` (H1 sendToRenderer ×4, H3 RelayState ×2). Частично исправлено: `electron/main/errors.ts` с `toErrorMessage`/`opFailure` существует и используется (`builds/index.ts:1`); `getLauncherDataRoot` вынесен в `paths.ts`. НЕ закрыто: типы миров/скриншотов (локальные копии в `worlds.ts:14-44`, `preload.ts:43-73`, `instance/types.ts:130-159`, `electron.d.ts:22-52` — с дрейфом `hasLevelData`), IPC-контракты (дрейф cloud), auth-preload, formatBytes (есть ещё 6-я копия `server/files-tab.tsx:66-70`).

Новые дубли этого аудита: JAR-парсеры ×3(+1), sha1 ×3, сравнение версий ×4, `loadModsModule` ×2 (`mods.ts:29` со FTB-кэшем и `builds/helpers.ts:488` без — тонкая несогласованность: FTB-кэш ставится только если первым сработал mods.ts), `formatDisplayNameFromFileName` (helpers.ts:405 ≡ use-builds.ts:942,1079), isPathInside ×3, Java-детект ×2 (system.ts + mc-server-handlers:1301), Modrinth version_files ×2, device-code flow ×3 в accounts-page, блоки Java/XnConnect ×2 в server-диалогах, confirm-диалоги ×4.

# Overengineering Findings

- **ipc-router.ts** — абстракция ради 47 из 215 каналов, два стиля регистрации, разная семантика ошибок. Рекомендация: либо принять везде, либо (проще) удалить и вернуть прямой `ipcMain.handle` в minecraft.ts/quick-play.ts, убрав fallback-глотание ошибок.
- **Тройное описание IPC-поверхности** в `ipc-contracts.ts` (IpcInvokeMap + ElectronAPIExplicit + ElectronAPIExtra с Omit-хирургией) — один генерируемый/выводимый интерфейс заменил бы всё.
- **Утроенное состояние поиска** в `instance/index.tsx` — параметризованный хук `useModSearch(source)`.
- **Fallback-ветки `!isDbAvailable()` в каждой функции каждого db-модуля** — централизуемо одной обёрткой; и несогласованность (молчаливая потеря записей в 6 модулях) хуже, чем её отсутствие.
- **`saveAllBuilds` (DELETE+INSERT всех)** — с появлением `updateBuildFields` массовый путь нужен только импорту/восстановлению; сейчас доступен как общий `db:save-builds` и тащит чтение+парсинг всего контента.
- **Внутренние типы-дубли с Omit** (`ElectronAPI = Omit<Explicit,...> & Extra`) — признак накопленных поколений API.

# Dead / Redundant Code

- `content-resolver.ts:resolveContentEntry` (:100-207) — экспортируется, нигде не вызывается, расходится с батч-версией. Кандидат на удаление.
- IPC `db:load-builds` (`system.ts:133`) — renderer не использует (grep: только loadBuildsLight в `use-home-versions.ts:48`, `use-home-launch.ts:90`).
- Мёртвые контракты: legacy `cloud:*` (ipc-contracts.ts:500-510), `build:upload-to-cloud` (:138).
- `launch-builder.ts:writeClasspathFile` — результат никто не использует (а защита от >32k cmdline нужна).
- @xnlc/core: `LaunchError`, `ensureAuthlibInjector`, `collectSupportedVersions`, CLI-шорткаты XnlcHandler, `ask()`/readline.
- @xnlc/mods: `ftbGetDetailsVersion` и внутренние экспорты (ftbCatalog и пр.).
- @xnlc/servers: `parseHost`, STARTUP/STOPPING/EULA-паттерны — внешне не используются.
- **emoji-mart — мёртвая зависимость**: `@emoji-mart/data`, `@emoji-mart/react`, `emoji-mart` в package.json + чанк в `vite.config.mts:65`, импортов в коде 0.
- `.tmp-*` логи в корне репозитория (12 файлов) — мусор, не код.
- Оговорка: пакеты публикуются в приватный registry — «мёртвые» экспорты пакетов могут быть осознанным публичным API; в границах монорепо они мертвы.

# Caching Opportunities

Существующие кэши (работают): file_snapshots (sha1 по size+mtime), resources (метаданные по sha1), updatesCacheMemo + settings-кэш обновлений, jar-cache (скачанные по URL JAR, TTL 3 дня), MetaClient дисковый TTL-кэш манифестов, buildsLightCache/buildContentCache (renderer, TTL 3 с), dataCache (lib/swr.ts), cached-avatar, category-badge promise-кэш, mods-loader-requirements двухуровневый кэш, FTB каталог на диске.

Предлагаемые:

| ЧТО | ГДЕ | ПОЧЕМУ | TTL/ИНВАЛИДАЦИЯ | ПАМЯТЬ |
|---|---|---|---|---|
| Результат Java-детекта | main, модульный promise/кэш (`system.ts:248`) | 10–20 процессов до 30 с; 5 вызывающих компонентов | инвалидация по кнопке «обновить»/смене настройки | KB |
| Настройки (settings:get) | `db/settings.ts` Map-кэш | sync SQLite на каждый getSetting (config.ts, ai-agent) | инвалидация в setSetting | KB |
| Иконки модов (HTTP) | renderer, по образцу cached-avatar | 300+ запросов к CDN на открытие вкладки | TTL 24 ч | лимит МБ |
| Полные скриншоты по клику | renderer | повторное открытие = повторный IPC+decode | по mtime | KB–МБ |
| Миниатюры скриншотов | main, `<shots>/.thumbs/*.jpg` | сейчас читаются все файлы целиком на каждый list | по mtime исходника | диск |
| Размеры миров (dirSize) | main, по (path, mtime saves/*) | до 200k stat на мир | по mtime level.dat/папки | KB |
| level.dat метаданные мира | main | gunzip NBT на каждый worlds:list | по (path, mtime) | KB |
| Категории/лоадеры/версии Modrinth/CF | main, `mods.ts` | статичные данные, сейчас HTTP на вызов | TTL часы | KB |
| JAR-инспекция (metadata+deps+requirements) | SQLite рядом с file_snapshots | устраняет 3 кэша и 3 чтения | по (path,size,mtime) | диск |

# Parallelization Opportunities

- `scanner.ts:scanIntentDir` (:90,:101): три директории (mods/resourcepacks/shaderpacks) последовательно → `Promise.all` (БД-запросы resolver'а уже батчевые, конфликтов нет).
- Хэширование toHash-файлов уже параллельно (Promise.all без лимита — стоит ограничить, как PARSE_CHUNK=8).
- Старт main: `initRuntimePaths`+`initDatabase` уже параллельны; `loadInstancesRoot`+`migrateIntentDirNames` можно присоединить к тому же Promise.all (миграции нужен instancesRoot — оставить последовательность, но запускать до createWindow? Нет: окно раньше важнее для perceived startup).
- **Должно остаться серийным**: SQLite-записи (одно соединение), миграции, порядок launch-шагов в worker, OAuth flow.
- Не раздувать параллелизм сети: CHECK_CONCURRENCY=4 и download concurrency 5/10 — разумные пределы.

# Worker / Background Processing Opportunities

- **Сканирование модов (холодный путь) → worker_threads**: `resolveContentEntries` toParse-цикл + fingerprint. CPU+IO-связанные, грузят main (286 модов — задокументированный кейс в `content-resolver.ts:438-442`). Паттерн воркера уже есть (`minecraft-launch-worker.ts`, `cloud/upload-worker.ts`). Стоит: да, для папок >50 новых JAR; SQLite-записи оставить в main (батчами по результату воркера).
- **MurmurHash2** — в тот же воркер или в один стрим с sha1 (см. Combined #5). Минимальный вариант без воркера: стриминг + `setImmediate`-yield'ы.
- **dirSize миров / storage:scan** — кандидаты в воркер при больших деревьях; проще — ленивость+кэш (см. Caching).
- **Zip при облачной выгрузке** уже в `upload-worker.ts` — эталон.
- better-sqlite3 оставить в main: синхронный движок в воркере с передачей результатов даст латентность IPC выше выигрыша на мелких запросах; тяжесть решается устранением тяжёлых запросов (loadBuilds), а не потоками.

# Startup Optimization

**CURRENT STARTUP** (main): dotenv → import auth (регистрация 9 хендлеров) → регистрация 15 модулей → fire-and-forget `import("@xnlc/mods")` + `import discord-rpc` → whenReady → createWindow → loadURL → ‖(initRuntimePaths, initDatabase: sync open+pragma+~30 PRAGMA+seed+deleteOrphans) → loadInstancesRoot → migrateIntentDirNames → (CLI --launch).

**CURRENT STARTUP** (renderer): entry → ВСЕ страницы статически (three/recharts/prismjs/markdown парсятся) → initI18n блокирует рендер → Launcher → контексты → страницы дёргают IPC (loadBuildsLight, accounts, settings ×N, news).

**Рекомендации:**
1. React.lazy страниц (skins/stats/cloud/accounts/server-detail) — убирает ~600+ КБ парса из старта. Самая дешёвая и большая победа.
2. `discord-rpc` module-level `setTimeout(1500)` при импорте (`discord-rpc.ts:296`) — стартует RPC независимо от готовности; оставить dynamic import, но инициализировать после did-finish-load.
3. `migrateIntentDirNames` при каждом старте — делать один раз (флаг в settings) после первой успешной миграции; сейчас — loadBuildsLight + fs-скан на каждый запуск.
4. Батч-предзагрузка настроек: один IPC `settings:get-many` для стартового набора (тема, язык, javaPath…) вместо ~14 одиночных getSetting.
5. auth.ts — привести к register-функции (консистентность; не перф).
6. Renderer: не блокировать рендер на initI18n (fallback на keys уже есть).
7. initializeSchema: при совпадении user_version пропускать ~30 PRAGMA (микро, но бесплатно после введения версионирования).

# Scalability Analysis

| Масштаб | Поведение |
|---|---|
| 1–5 инстансов | Всё хорошо; холодные сканы маленькие. |
| 10–20 (текущая цель) | Узкие места: открытие большой сборки (холодный скан 100–300 модов: 3 чтения/JAR + murmur в main = фризы секунды); `mergeContent` O(N²) заметен при 300 модах; `loadBuilds()` из 12 мест тащит десятки–183 МБ JSON (пик — `db:save-builds` и выход из игры); вкладка «Моды» перечитывает JAR'ы второй системой. |
| 50 | game_sessions растёт: `stats:overview` (вся таблица в JS каждые 5 с) и DELETE по buildName без индекса деградируют; builds-таблица с JSON-контентом (50 × 10–20 МБ) делает любой `SELECT *` неприемлемым; statementCache thrash от IN-запросов. |
| 100 | Без выноса JSON-контента из строки builds в отдельную таблицу контента и без worker-сканера main-процесс станет узким местом по CPU и RAM; IPC-payload полного контента сборки (десятки МБ) — по сериализации. |

Сеть и диск масштабируются лучше (батчи Modrinth, shared-minecraft links, дедуп по sha1 между инстансами — сильные стороны).

# Proposed Target Architecture

**CURRENT → PROPOSED** (без смены стека и границ процессов):

1. Сканирование: `scanner → JarInspector (один проход: sha1+murmur стримом + central-directory metadata) → SQLite (jar_inspections/resources, batch-транзакции)`; воркер для холодных пачек. Сейчас: 3 чтения + 3 кэша + N+1 коммиты.
2. Данные сборок: light-таблица builds + отдельная таблица контента (или строгий запрет `SELECT *` вне `loadBuildContent`); IPC — только light + точечные мутации. Сейчас: JSON-мегастроки и `loadBuilds()` из 12 мест.
3. IPC: один источник контракта (`ipc-contracts.ts` → типизированный preload), единый стиль регистрации, invalidate-события после мутаций вместо повторных pull'ов. Сейчас: 4–5 мест синхронизации + дрейф.
4. Сеть: весь Modrinth/CF/FTB трафик — через main (`@xnlc/mods`) с main-сторонними кэшами; renderer `lib/modrinth-metadata.ts` уходит на IPC-эндпоинт.
5. Renderer: lazy-страницы, виртуализация логов/списков, единый стор сборок/аккаунтов (контекст поверх модульных кэшей use-builds), статические превью скинов.
6. Пакеты: @xnlc/types — единственный владелец контрактов и доменных типов (ServerStatusResult перенести туда, разорвав цикл types↔servers); @xnlc/mods реэкспортирует мод-типы; @xnlc/core экспортирует getLoaderProfileName/normalizeJavaPath; без слияния пакетов.
7. Сервисы: общий oauth-loopback/token-store для cloud; stopAll() на quit; единый finally-cleanup таймеров.

# Prioritized Roadmap

**P0 — Critical (баги/корректность):**
1. Preload-метод `discoverFromPath` отсутствует (`system.ts:183` ↔ `instance-create-dialog.tsx:171`). Сложность: XS. Риск: нет. API: да (preload). 
2. `.litemod` рассинхрон (`content-drop.ts:24` vs `scanner.ts:63`). XS. Риск: нет.
3. Dropbox без refresh_token (`cloud/providers/dropbox.ts:60-99`). S–M. Риск: низкий (auth-flow).
4. Типы `ModLoaderFilter` без "forge" в @xnlc/mods — тихая фильтрационная багия. XS (types-пакет). XNLC: да.
5. Мёртвые подписчики метрик (`mc-server-handlers.ts:624-645`) + отсутствие destroyed-cleanup. XS. 
6. `db:load-builds` отключить от renderer/удалить (`system.ts:133`) — мегабайтный IPC без потребителя. XS.

**P1 — High Impact (перф):**
7. Единый JarInspector + единое чтение (sha1+murmur+metadata за проход) — `content-resolver.ts`, `metadata.ts`, `fingerprint.ts`, `mods-jar-deps.ts`, `mods-loader-requirements.ts`. L. Риск: средний. Ожидание: 3× меньше дискового I/O на холодном скане, уход фризов main.
8. Батч-транзакции в content-resolver (все циклы upsert/mark) + `synchronous=NORMAL` (`db/core.ts:195`). S–M. Риск: низкий (WAL+NORMAL — стандарт). Ожидание: fsync-шторм → 1 fsync на батч.
9. `loadBuilds()` → `loadBuildsLight()` в 12 точках (список в Database Findings #2) + `updateBuildFields` без чтения контент-колонок при лёгких полях. M. Риск: низкий-средний (проверить поля). Ожидание: уход 1,5–2 с блокировок и 183 МБ парсов.
10. React.lazy страниц + удалить emoji-mart. S. Риск: низкий. Ожидание: заметно быстрее старт renderer.
11. Убрать rescan-цикл после установки/удаления мода (`use-builds.ts:899,1125,1189` — точечные обновления по образцу `persistLocalAddition:920`). M. Риск: средний (merge-семантика).
12. Кэш Java-детекта + общий renderer promise-кэш (5 потребителей). S. 
13. `mergeContent` O(N²) → индекс (`use-builds.ts:135-142`). XS–S.
14. Статистика в SQL (`stats.ts:listGameSessions` WHERE+GROUP BY) и убрать 5-с поллинг (`stats-page.tsx:180`). S.
15. discord-rpc destroy на quit + cleanup неудачных login (`discord-rpc.ts`). XS.

**P2 — Medium:**
16. Виртуализация logs-page/console-tab + cap буфера (`use-mc-servers.ts:178`). M.
17. Миниатюры скриншотов на диске + ленивый dirSize миров. M.
18. Единый IPC-контракт: вычистить legacy cloud, синхронизировать IpcInvokeMap/IpcEventMap с реальностью, типизировать preload контрактом. M–L. Риск: низкий (type-only), высокий выигрыш поддержки.
19. Унификация облачных провайдеров (oauth-loopback, token-store, CATEGORY_MAP ×3). M.
20. worker для холодного сканирования больших папок. M–L. Риск: средний.
21. Консолидация mc-server-handlers (фабрика списков игроков, fs-helper, вынос xn-connect). M.
22. Кэш настроек в db/settings.ts. XS.
23. `resolveLibraries` мемоизация + один проход assets в @xnlc/core. M (XNLC-пакет). Ожидание: −тысячи stat'ов на запуск игры.
24. WebGL скинов → статические превью/IntersectionObserver. M.
25. Параллельный обход трёх директорий в scanner. XS.

**P3 — Cleanup:**
26. Удалить мёртвый код (resolveContentEntry, writeClasspathFile, мёртвые экспорты пакетов, legacy-контракты). S.
27. Сравнение версий → одна реализация; sha1 → одна потоковая; isPathInside ×3 → одна. S.
28. ipc-router — принять везде или удалить. S.
29. db-миграции с версионированием user_version. M.
30. Параметризация device-code flow ×3 (accounts-page) и server-диалогов. M.
31. Фолбэк БД — централизовать и устранить молчаливую потерю записей. S–M.
32. Типы миров/XnConnect/ServerStatusResult → @xnlc/types (закрыть H1/H3 прежних аудитов). S–M.

# Recommended Implementation Order

1. **P0-баги** (1–6): дешёвые, сразу повышают корректность; заодно «разминают» контрактный слой.
2. **БД-фундамент** (8, 9, 22): synchronous=NORMAL + батч-транзакции + light-чтения — убирают главные блокировки main без смены API.
3. **Сканирование** (7, 13, 25, затем 20): JarInspector как новый модуль → перевод потребителей по одному → воркер в конце, когда формат результатов стабилен.
4. **Renderer-перф** (10, 11, 14, 16): независимые, измеримые победы; lazy-страницы первыми.
5. **Контракты и типы** (18, 32, 4): после стабилизации API из шагов 2–3, чтобы не править контракты дважды.
6. **Консолидация сервисов** (19, 21, 15) и **XNLC-пакеты** (23, 27): точечные PR по пакетам.
7. **Cleanup** (26–31) последним — когда дубли уже никто не использует.

# Expected Impact

- **Старт**: lazy-страницы и уборка мёртвого кода — качественно быстрее first paint (сотни КБ JS меньше парсится); main-стартап и так неплох — выигрыш малый (миграция по флагу, схема по версии).
- **Открытие инстанса (100–300 модов, холодно)**: −60–70% дискового I/O (3 чтения → 1), уход секундных фризов main (murmur/парсинг из event loop), пики RAM ниже (нет 8×AdmZip буферов). Тёплый путь уже быстрый — не изменится.
- **Выход из игры**: устранение чтения 183 МБ JSON на каждый выход (п.9) — секунды → миллисекунды.
- **Запуск игры**: −тысячи sync stat'ов (п.23) — заметно на HDD/слабом CPU; UI и так изолирован worker'ом.
- **SQLite**: fsync-шторм → батч-коммиты; статистика перестаёт сканировать всю таблицу каждые 5 с.
- **IPC**: уход мегабайтных payload (`db:load-builds`, скриншоты, список миров с иконками) — меньше сериализации и GC в обоих процессах.
- **Renderer**: виртуализация логов (2000 строк × 15 регэкспов → видимые строки), иконки с кэшем (300 HTTP → 0 повторных), WebGL-контексты под контролем.
- **Поддерживаемость**: один источник контрактов/типов, −4 парсера JAR → 1, уход 4–5 мест синхронизации IPC.

Численные оценки даны только там, где есть прямые свидетельства в коде (комментарии про 183 МБ/1,5–2 с/286 модов, счётчики stat-вызовов); остальное — качественно.

# Risks and Compatibility Concerns

- **Пакеты публикуются в приватный registry** (git.xneon.org): «мёртвые» экспорты могут быть внешним API — удалять только после проверки внешних потребителей. Линковка junction (`sync:xnlc`) + semver-диапазоны вместо `workspace:*` — изменения пакетов требуют дисциплины версионирования.
- **`synchronous=NORMAL`**: при отключении питания теоретически теряются последние транзакции (не при падении процесса); для лаунчера приемлемо, но это сознательный компромисс.
- **Свой ZIP central-directory reader** (вместо adm-zip) — аккуратно с экзотикой (zip64, unicode-fallback имени файла); adm-zip сейчас всё это молча обрабатывает.
- **Единый JarInspector меняет семантику merge'а источников** (scanner vs loader-requirements дают разные срезы) — нужна сверка полей, иначе регрессии отображения.
- **Контрактные чистки IPC** ломают TypeScript-сборку renderer при рассинхроне — делать одним PR с `pnpm run build` (оба tsconfig).
- **Убирание rescan после установки**: mergeContent несёт эвристики источника (modrinth vs curseforge) — точечные обновления должны их сохранить, иначе вернётся баг «источник затирается догадкой сканера» (см. комментарий use-builds.ts:146-165).
- **Fallback-режим БД**: любая централизация должна сохранить текущее поведение для accounts/builds/settings и явно задокументировать поведение остальных.
- **Публикация пакетов с type-переносами** (ServerStatusResult → types) меняет импорты потребителей @xnlc/servers — major/minor-бамп по договорённости.

# Статус выполнения (сессия правок)

Шесть пунктов из Executive Summary закрыты в коде. Проверка: `tsc --noEmit` (renderer), `tsc -p tsconfig.node.json` (electron), `vite build` — все зелёные.

| # | Проблема | Что сделано |
|---|---|---|
| 1 | Тройной/четвёртый проход по JAR | Новый `electron/main/builds/jar-inspector.ts`: один `readFile` на файл даёт sha1 + отпечаток CurseForge + метаданные + требования загрузчика + объявленные зависимости; общий кэш по `(path, size, mtime)` (лимит 800, файлы >80 МБ — только потоковый sha1). Парсеры вынесены в `builds/loader-requirements.ts` и `builds/jar-dependencies.ts`, поэтому публичные `mods-loader-requirements.ts` / `mods-jar-deps.ts` больше не читают тот же JAR повторно, а берут результат из кэша инспектора. `scanner.scanIntentDir` обходит mods/resourcepacks/shaderpacks параллельно. Удалён мёртвый `resolveContentEntry` вместе с `hashResource`. |
| 2 | fsync-шторм в БД | `synchronous = NORMAL` (WAL) вместо `FULL`. Добавлены батч-транзакции `upsertResources`, `upsertFileSnapshots`, `setResourcesCurseforge`: все циклы content-resolver (снапшоты, разбор новых JAR, Modrinth/CurseForge-обогащение) пишут одной транзакцией, а фоновые обогатители читают ресурсы батчем вместо N+1 `getResources([sha1])`. |
| 3 | Тяжёлый `loadBuilds()` | Добавлены точечные `findBuildByName` / `findBuildById`. На лёгкие чтения переведены: `launch-orchestrator.ts:247` (каждый выход из игры), `system.ts` (save-builds, update-build-fields, оба импортёра), `builds/index.ts` (конфликт модпака, очистка статистики, экспорт zip, восстановление из корзины), `builds/helpers.ts` (cleanup профилей загрузчика), `storage.ts` (скан и очистка), `cloud/handlers.ts` (выгрузка и импорт сборки). `saveAllBuilds` принимает и лёгкие сборки (тяжёлый контент сохраняет `keepOr` из БД), `updateBuildFields` читает тяжёлые колонки только если запрос их меняет. Полный `SELECT *` остался только там, где контент реально нужен (экспорт модлиста). |
| 4 | Renderer: нет code-splitting'а | Все страницы, кроме главной, переведены на `React.lazy` + `Suspense`. В сборке появились отдельные чанки `skinview` (517 КБ), `markdown` (291 КБ), `instance`, `stats-page`, `logs-page`, `server-detail-page`, `cloud`, `settings`, `servers-page`, `accounts-page` — при старте они больше не парсятся. WebGL: `skin-card.tsx` создаёт `SkinViewer` только для карточек в зоне видимости (IntersectionObserver, rootMargin 200px) вместо контекста и rAF-цикла на каждый скин библиотеки. |
| 5 | Расхождение IPC-контракта | Добавлен отсутствовавший preload-метод `discoverFromPath` (`launcher:discover-from-path`) — выбор кастомного пути импорта больше не падает с TypeError. Удалены мёртвые legacy-контракты `cloud:*` (token-based), `uploadBuildToCloud` и `build:upload-to-cloud` вместе с Omit-хирургией. В `IpcInvokeMap` добавлены реально существующие каналы (paper/purpur/folia/velocity/waterfall/sponge, mc-server:*, quickplay:*, update:*, servers:ping, worlds:copy/reset-icon, mods:ftb-catalog-facets, read-local-file, launcher:discover-from-path), в `IpcEventMap` — ~12 push-каналов. Исправлены сигнатуры: `mods:ftb-search` (три аргумента), `db:load-builds-light` → новый тип `DbBuildLight`, `McServerDownloadProgress` приведён к фактической форме (bytes*, свободный `phase`). |
| 6 | Повторный полный rescan после установки/удаления мода | В `use-builds.ts` добавлен `refreshBuildContent(buildId)`: после установки/удаления/обновления контента синхронизируется только изменённая сборка, а не весь список. Полный `reloadBuilds()` (перечитывание всех сборок + сетевое обогащение имён по всем сборкам) заменён на четырёх точках: `addModToBuild`, `addContentToBuild`, `removeContentFromBuild`, `updateItemVersion`. Снапшот контента обновляется вместе с состоянием, чтобы debounce-слой не писал сборку заново. Сам скан папки остался (он подтверждает фактические файлы), но стал заметно дешевле за счёт п.1–п.2. |

Отдельно (не входило в шесть пунктов), но сделано по ходу:

- `mods-loader-requirements.ts` и `mods-jar-deps.ts` перестали держать собственные «читающие» пути: оба берут результат из инспектора.
- `checkLoaderRequirements` лишился дублирующего файлового кэша требований — единственный кэш теперь у инспектора (остался кэш готовых отчётов по подписи папки).

Осознанно не сделано:

- `db:load-builds` (полный) оставлен как fallback renderer'а: `loadBuildsLight` используется везде, но при отсутствии метода в preload рендерер падает на старый канал.
- `recharts` в `manualChunks` — мёртвое правило (в коде импортов нет), но зависимость числится в `devDependencies`; удаление требует `pnpm install` и не входит в эту сессию.
- Полное устранение скана папки после установки мода требует точечного IPC «инспекция одного файла» + обновление `installedMods` — отдельная задача со средним риском (см. Risks: эвристики источника).

# Статус выполнения — P0-пакет (баги, корректность, безопасность)

Закрыты все семь пунктов из блока P0. Проверка: `tsc --noEmit` (renderer), `tsc -p tsconfig.node.json` (electron, включая запись в `dist-electron`), `vite build` — зелёные.

| Проблема | Что сделано |
|---|---|
| Dropbox терял авторизацию через ~4 ч | `cloud/providers/dropbox.ts`: `refresh_token` и `expires_at` теперь сохраняются при обмене кода, добавлен `refreshAccessToken` (grant_type=refresh_token) и proactive-обновление за минуту до истечения — как в yandex-disk/onedrive/google-drive. Старые записи без refresh_token требуют повторного входа (ожидаемо). |
| `.litemod` невидим для сканера | `builds/scanner.ts`: регулярка расширений расширена до `/\.(jar|zip|litemod)(\.disabled)?$/i` — принятый дропом лайтмод больше не исчезает после rescan. |
| `read-local-file` читал произвольный путь | `skins.ts`: чтение разрешено только внутри `<data>/skins` (проверка через `path.relative`, защита от `..` и абсолютных путей) и только файлов ≤ 16 МБ. Все записи библиотеки скинов лаунчер создаёт сам в этом каталоге (`skins:save-to-library`, `skins:import-from-url`), поэтому превью не ломается. |
| Сироты в `server_sessions` | `db/stats.ts`: добавлены `deleteServerSessionsForDeletedServer` (по id строго, по имени — только осиротевшие) и разовая `deleteOrphanServerSessions`. `db/mc-servers.ts`: `purgeTrashedMcServers` и `deleteMcServer` сначала запоминают id/имя удаляемых серверов и чистят статистику. Уборка также вызывается при старте (`db/index.ts`, рядом с `deleteOrphanGameSessions`). |
| Утечка discord-rpc Client | `discord-rpc.ts`: при неудачном `client.login()` клиент уничтожается (`destroy`) перед пробросом ошибки; добавлен `shutdownDiscordRpc()` (destroy клиента + снятие retry-таймера + флаг `shuttingDown`, чтобы retry не перезапускал подключение) и регистрация на `app.on("before-quit")`. |
| Мёртвые подписчики метрик сервера | `mc-server-handlers.ts`: `pushServerMetrics` удаляет destroyed/отсутствующие `webContents` из `metricsSubscribers`, чистит пустые наборы и гасит таймер через `stopMetricsTimerIfIdle` — таймер 1 с больше не тикает вечно после закрытия окна. |
| Temp-zip облачной выгрузки без `finally` | `cloud/handlers.ts`: `cloud:upload-build`, `cloud:upload-server`, `cloud:upload-account` и `cloud:download-and-import` выносят временные файлы в `finally` — архив или json в temp удаляется и при ошибке (раньше оставался до ручной очистки). |

Что осталось из аудита после этого блока (не P0): кэш Java-детекта, статистика в SQL и отказ от 5-секундного поллинга, cap буфера консоли, виртуализация логов и списка модов, worker для холодного сканирования, консолидация дублей (sha1 ×3, сравнение версий ×4, cloud token-store ×6), версионирование миграций.

# Верификация фиксов (сессия проверки)

Проверка выполнялась не по коду, а исполнением собранного `dist-electron` в Node с заглушкой `electron` (подмена `app.getPath`, `ipcMain` с реестром хендлеров, `webContents`) — на копии реальной БД и на настоящих JAR сборок. Живая БД не изменялась: снапшот снят через `VACUUM INTO` из read-only соединения.

| Что проверялось | Как | Результат |
|---|---|---|
| Единый инспектор JAR | `inspectJar` на реальном `asynclogger-2.2.1+26.1.2-fabric.jar` (584 КБ) | sha1 совпал с独立 `crypto`; отпечаток CurseForge совпал со старой реализацией (`computeFingerprint`); метаданные прочитаны («Async Logger»); повторный запрос — 27.4 мс → 0.22 мс (данные из кэша, диск не читается); порядок sha1 → ZIP → отпечаток не портит результат |
| Холодный скан сборки | `scanIntentDir` на реальном инстансе Create+ (149 файлов + 14 jar во вложенной `.connector`) на пустой БД | 163 мода, у всех sha1; 161 мод с версией из архива; прогресс доходит до 100%; 3.9 с холодный → 31 мс тёплый (×126); тёплый даёт идентичные id |
| fsync-шторм / батчи | заполнение `file_snapshots` и `resources` тем же сканом | 168 снапшотов, 165 ресурсов — запись идёт батчами, ошибок нет |
| `loadBuilds()` vs light | замер на реальных 17 сборках (23.4 МБ тяжёлого JSON) | 52.2 мс → 0.7 мс (**×70**) |
| `updateBuildFields` без чтения контента | смена `icon` у сборки с 163 модами | 8.7 мс, `mods` остались 163 (тяжёлые колонки не читались) |
| `saveAllBuilds(light)` | сохранение light-массива всех 17 сборок | 226 мс, расхождений по mods/rp/shaders/installedMods — **0 из 17** (контент восстановлен через `keepOr`) |
| Очистка сирот статистики | `initDatabase()` на копии живой БД | удалено ровно 74 сироты `server_sessions` (79 → 5, остались сессии серверов в корзине) и 4 сироты `game_sessions`; повторный запуск — 0 |
| `deleteMcServer` / `purgeTrashedMcServers` | вызовы на копии БД | сервер удаляется, корзина чистится, `server_sessions` удалённых уходят, сирот не остаётся |
| read-local-file (вайтлист) | прямой вызов хендлера из реестра | внутри `<data>/skins` — читается; `C:/Windows/win.ini` — null; выход через `..` — null; соседний `data.db` — null; файл > 16 МБ — null; пустой путь — null |
| `.litemod` в сканере | `scanIntentDir` на папке с `.jar`, `.litemod`, `.litemod.disabled`, `.JAR`, `.zip`, `.txt` | все моды видны, `.disabled` даёт `enabled: false`, `.txt` отсекается; `formatDisplayNameFromFileName("beta.litemod")` → «Beta» |
| Dropbox refresh | `DropboxProvider.isAuthenticated()` с мок-`fetch` и истёкшим токеном | запрос `grant_type=refresh_token` с сохранённым токеном; новый `access_token` и `expires_at` записаны; живой токен refresh не вызывает; legacy-запись без refresh и пустой конфиг не ломаются |
| Temp-файлы облака (`finally`) | вызов `cloud:upload-account` с фейковым провайдером | файл удалён после **успеха**, после **ошибки провайдера** и после **исключения** `getProvider` |
| Утечка discord-rpc | заглушка `discord-rpc` через ESM-хук: `login()` всегда падает | клиент создан и **уничтожен** (clients=1, destroyed=1); `shutdownDiscordRpc()` гасит retry и после него новые клиенты не создаются; подписка на `before-quit` зарегистрирована |
| Мёртвые подписчики метрик | `metrics-subscribe` с фейковым `webContents` (сначала живой, потом destroyed) и фейковым `serverManager` | пока подписчик жив — тик идёт и данные уходят; после «закрытия окна» send прекращается, `getMetricsSync` вызывает ровно один тик (вычистивший подписчика) и дальше счётчик не растёт — таймер погашен |
| Code-splitting renderer | анализ `dist/`: `index.html` и стартовый чанк | `index.html` не содержит ссылок ни на один тяжёлый чанк; в стартовом чанке (168 КБ) нет `SkinViewer`/`IdleAnimation`; `skinview`, `markdown`, `instance`, `stats-page`, `logs-page`, `servers-page`, `settings` присутствуют только как динамические импорты |
| Rescan после установки мода | грепы по `use-builds.ts` | полный `reloadBuilds()` остался только в первичной загрузке, `cloud:imported` и восстановлении из корзины; 4 точки установки/удаления/обновления контента используют `refreshBuildContent` |

**Найдено и исправлено во время проверки.** Фикс `.litemod` был неполным: сканер лайтмод уже видел, но ещё четыре места продолжали знать только `.jar`/`.zip` — `builds/helpers.ts` (поиск заменяемого файла — заменённый лайтмод оставался в папке), `import/helpers.ts` (`isImportedContentEntry` и имя в списке контента — лайтмоды терялись при импорте сборки), `instance-detail.tsx` и `use-builds.ts` (имя локального мода показывалось как `beta.litemod`). Все четыре приведены к общему набору расширений.

**Что проверить динамически не удалось.** Запуск самого Electron в этой среде невозможен: песочница запрещает создание mojo/named-pipe каналов (`FATAL: platform_channel.cc Check failed`), поэтому окно приложения не поднимается. Из-за этого не проверялись «в бою»: WebGL-превью скинов с IntersectionObserver, реальная отрисовка lazy-вкладок и запуск игры с записью статистики в `launch-orchestrator` (последнее подтверждено только тем, что `findBuildByName`/`updateBuildPlaytime` работают на копии БД).

# Найдено при живой проверке (вне плана аудита)

Запуск лаунчера отдельным процессом (вне песочницы) позволил проверить рантайм: `[DB] Очищено записей статистики удалённых серверов: 74` — разовая уборка сирот сработала в бою; вкладка скинов подгружает `three`/`skinview3d` только при открытии, WebGL-превью создаются (2 canvas); консоль без ошибок от новых правок.

**Исправленный баг: debounced-сохранение правок сборки падало и теряло весь патч.**
`db:update-build-fields` писал `NULL` в текстовые колонки, объявленные `NOT NULL DEFAULT ''` (`javaPath`, `javaArgs`, `memoryMin`, `memoryMax`, `server`, `serverPort`, команды запуска) — в консоли renderer это выглядело как `[Builds] Debounced save failed: SqliteError: NOT NULL constraint failed: builds.javaPath`. Поскольку цикл сохранения патчей не был изолирован, ошибка одной сборки прерывала сохранение остальных, а снапшот не обновлялся — ошибка повторялась при каждом debounce, то есть правки сборки молча не сохранялись.

- `electron/db/builds.ts`: `NOT_NULL_TEXT_COLUMNS` — для этих колонок сброс (`undefined`) пишется пустой строкой (`''` читается обратно как `undefined`, смысл сброса сохраняется); nullable-поля по-прежнему получают `NULL`.
- `components/launcher/instance/use-builds.ts`: каждый патч сохраняется в своём `try/catch` — одна проблемная сборка больше не блокирует остальные.
- Проверено: 11/11 на копии БД (сброс → `''`, nullable → `NULL`, значения и соседние поля патча сохраняются), плюс живой вызов в приложении вернул OK, в БД записалась пустая строка.

**UI-правка по запросу пользователя:** левая половина вкладки контента («Установлен») получила пагинацию — раньше она рендерила все элементы сразу (163 карточки с иконками на Create+), тогда как правая половина («Результаты поиска») пагинацию уже имела. Использован тот же компонент `Pagination` и та же константа `MODS_PER_PAGE = 20`, что справа; страница сбрасывается при смене поискового запроса, сборки и типа контента, а «повисшая» после удаления мода страница подрезается к актуальному числу страниц. В DOM теперь максимум 20 карточек вместо 163 — это частично снимает пункт «300+ модов без виртуализации» для левой панели (файл `components/launcher/instance/instance-content-tab.tsx`).

# Статус выполнения — P1-блок (перф)

Проверка: `tsc --noEmit` (renderer), `tsc -p tsconfig.node.json` (electron, с записью в `dist-electron`), `vite build`, плюс исполняемые тесты на копии БД и с заглушками main-модулей.

| Проблема | Что сделано |
|---|---|
| Java-детект без кэша (до 30 с и 10–20 процессов на каждый вызов) | `system.ts`: скан вынесен в `scanJavaInstallations`, результат кэшируется на 5 минут, параллельные вызовы разделяют один скан (in-flight). Из renderer можно форсировать обновление: `detectJavaInstallations(force)` — кнопка «Обновить» добавлена в модалку выбора Java у сборки (`instance-build-java.tsx`) и в настройках лаунчера (`settings-java.tsx` + `settings/index.tsx`). Проверено исполняемо: первый вызов — 14 `execAsync`, второй — 0 новых и 0 мс, force — новый скан, два параллельных force не двоят работу (11/11). |
| Статистика читала всю `game_sessions`/`server_sessions` и фильтровала в JS | `db/stats.ts`: добавлены `listGameSessionsInRange` / `listServerSessionsInRange` (`WHERE startedAt >= ? AND startedAt <= ?`), `main/stats.ts` использует их; добавлены индексы `game_sessions(buildName)` и `server_sessions(serverName)` под очистку по имени. Проверено: 13/13 (диапазон, суммы, широкий диапазон, индексы). |
| Постоянный 5-секундный поллинг страницы статистики | `StatsOverview` получил `gameActiveStartedAt` и `activeServerSessions`; `stats-page.tsx` тикает только пока запущена игра или сервер, а в остальное время обновляется по push-событиям (`stats:updated`, смена состояния сервера). |
| Буфер консоли сервера рос безгранично (renderer) | `use-mc-servers.ts`: потолок `MAX_SERVER_LOG_LINES = 5000` (в main буфер уже был ограничен `MAX_LOG_BUFFER = 2000` в `@xnlc/servers`). |
| Иконки модов грузились все сразу | `instance-content-tab.tsx` и `addon-row.tsx`: `loading="lazy" decoding="async"` — запросы к CDN идут по мере прокрутки. |
| Логи: повторная токенизация при каждом рендере | `logs-page.tsx`: кэш разбора строк на токены (`tokenizeLogCached`, лимит 4000 записей) — `LogRow` уже был `memo`, теперь и разбор не повторяется при смене фильтра/поиска. Виртуализация списка остаётся в P2. |

# Статус выполнения — остаток аудита (блок A + часть блока B)

Проверка: `tsc --noEmit` (renderer), `tsc -p tsconfig.node.json` (с записью в `dist-electron`), `vite build`, плюс исполняемый тест версионирования схемы на копии реальной БД (9/9).

## Блок A — корректности

| Проблема | Что сделано |
|---|---|
| `ModLoaderFilter` без `forge` (тихая багия фильтрации) | `packages/xnlc-mods/src/types.ts`: набор приведён к значениям `@xnlc/types` (`vanilla \| forge \| fabric \| quilt \| neoforge`). Раньше Forge-фильтр молча не добавлял facets в Modrinth. |
| Кэш настроек | `db/settings.ts`: Map-кэш + `clearSettingsCache()`, инвалидация в `setSetting` (единственная точка записи). `getSetting` больше не делает sync-запрос SQLite на каждое обращение (config.ts, ai-agent, IPC из renderer). |
| Таймеры не снимались при успехе | `auth.ts` (`exchangeElyByCode`, `exchangeXnSkinsCode`): 30-секундный таймер снимается в `finally`; `cloud/providers/{dropbox,yandex-disk,onedrive,google-drive}.ts`: `clearTimeout` на успехе и на ошибке — таймер ожидания колбэка больше не держит процесс 2 минуты и не резолвит завершённый промис повторно. |
| `xn-connect-manager.stopAll()` не вызывался | `main/index.ts`: подписка на `app.on("before-quit")` закрывает relay-туннели. |
| Две реализации поиска Java | Единая `findJavaBinarySync()` в `system.ts` (JAVA_HOME, каталоги, `where java`); дубль `findJavaPath` из `mc-server-handlers.ts` удалён (67 строк). |
| Молчаливая потеря записей в fallback-режиме БД | `core.ts`: `warnDbUnavailable(operation)` (лог один раз на операцию); применён в `ai.ts`, `mc-servers.ts`, `skins.ts`, `cloud.ts` — 18 мест. |
| `DbBuild` vs `BuildJson` разошлись | В `DbBuild` добавлены `modpackVersionId`, `windowOverride/Width/Height`; в `BuildJson` — `defaultAccountId`. |
| Полный `db:load-builds` в renderer | Renderer переведён на light: `use-home-launch`, `use-home-versions`, `use-builds` (загрузка, восстановление из корзины), `use-import`, `cloud-file-browser` (3 вызова → 1, удалён дублирующий useEffect). `persistLocalAddition` пишет контент точечно через `updateBuildFields` вместо чтения всего массива. Канал `db:load-builds` удалён из preload, `IpcInvokeMap`, `ElectronAPIExplicit` и main; `dbHelpers.loadBuilds` остался для внутренних нужд main (экспорт модлиста). |
| Мёртвый код и мусор | Удалён неиспользуемый `writeClasspathFile` (`@xnlc/core`); из корня убраны логи/архивы прошлых сессий (включая `.tmp-export-test.zip` 1.06 ГБ). |

## Блок B — часть

| Проблема | Что сделано |
|---|---|
| Логи/консоль: дорогой рендер | Логи: кэш токенизации + рендер максимум 1500 строк с подсказкой. Консоль сервера: рендер максимум 1200 последних строк (`logs.showingLast`), при буфере 5000 (renderer) / 2000 (main). Ключ локализации добавлен в ru/en/de/es/uk. |
| Скриншоты: чтение и перекодирование всех файлов | `worlds.ts`: миниатюры кэшируются на диске (`<shots>/.thumbs/*.png`, пересборка только если исходник новее) и в памяти по mtime+size; `screenshots:get` отдаёт JPEG как `image/jpeg` без PNG-перекодирования. |
| `dirSize` миров на каждый `worlds:list` | `worlds.ts`: кэш по mtime каталога с TTL 60 с — повторные открытия вкладки не обходят дерево заново. |
| Миграции без версионирования | `migrations.ts`: `SCHEMA_VERSION = 2` в `user_version`; колоночные миграции выполняются только при `user_version < SCHEMA_VERSION`, поэтому на актуальной БД ~30 `PRAGMA table_info` на старте не выполняются. Проверено на копии реальной БД: миграция 1 → 2, данные (17 сборок, 5 серверов) целы, повторный старт без миграций. |

## Блок B — продолжение (B3, B7, B8)

| Проблема | Что сделано |
|---|---|
| Холодный скан JAR блокировал main (~4 с на 163 мода) | Новый worker-поток: `builds/scan-worker.ts` (инспекция файлов) + `builds/scan-worker-client.ts` (запуск, чанки, таймаут 120 с, гарантированный `terminate`). `content-resolver` при пачке ≥ 24 новых JAR делегирует разбор воркеру, а main только пишет результаты в SQLite батчем. Результаты воркера кладутся в общий кэш main (`primeJarInspectionCache`) — иначе зависимости и требования загрузчика перечитали бы те же JAR. При падении или таймауте воркера остаток файлов (не обработанные — без дублей) разбирается локально. Чтобы воркер мог загрузить модули, zip/toml-утилиты вынесены в `builds/archive-utils.ts` (без electron и БД), а `helpers.ts` больше не импортирует `runtime` статически. Проверено: 149 JAR за 3.9 с в потоке, main не заблокирован (252 тика таймера за это время), sha1/отпечаток/имя совпадают с main-разбором (12/12). |
| Мемоизация `resolveLibraries` (5 вызовов за запуск) | `WeakMap<VersionJson, ResolvedLibrary[]>` в `LibrariesManager`: разбор выполняется один раз на объект версии, повторные вызовы (classpath, countTotalFiles, countTotalSize, natives ×2) бесплатны. |
| Ассеты статились 3–4 раза за запуск | `AssetsManager.readyCache` (Map по пути объекта): `countAssets`, `countTotalSize` и `downloadAssets` больше не делают повторные `existsSync`/`statSync` по 5–13 тысячам объектов; `downloadAssets` обновляет кэш, есть `clearReadyCache()`. |
| Нет защиты от переполнения командной строки Windows (>32767) | `java-runner.ts`: `writeJavaArgFileIfTooLong` — при длине команды больше лимита (30 000 на Windows, 120 000 на остальных) аргументы java выносятся в `@argfile` (JVM читает его сама), файл удаляется после выхода процесса. Для обёрток (optirun/flatpak) не применяется — они парсят аргументы сами. Проверено: команда 52 984 → 94 символа, содержимое файла корректно квотится, простые аргументы не квотируются (18/18 вместе с мемоизацией). |
| Токен-хранилище дублировалось в 6 провайдерах | `cloud/token-store.ts`: `readCloudToken` / `writeCloudToken` / `clearCloudToken` / `getValidCloudToken` (проверка срока → refresh → запись). Все шесть провайдеров (dropbox, yandex-disk, google-drive, onedrive, s3, webdav) переведены на него; копий `getCloudConfig`/`setCloudConfig`/`removeCloudConfig` в провайдерах больше нет. Проверено: 12/12 (запись/чтение, битый JSON не роняет, refresh по сроку, ошибка refresh отдаёт прежний токен, Dropbox обновляет и чистит через общее хранилище). |
| Карта категорий архива дублировалась (3 копии, 2 варианта) | `cloud/categories.ts`: `BUILD_CATEGORY_DIRS`, `SERVER_CATEGORY_DIRS`, `EXPORT_CATEGORY_DIRS`, `SHARED_GAME_ENTRIES`, `categoriesOf`. Модуль не тянет electron — его использует и `upload-worker`. |

## Блок B — консолидация (B4)

| Проблема | Что сделано |
|---|---|
| 11 хендлеров списков игроков с дословно скопированным каркасом | `mc-server-handlers.ts`: списки (whitelist, ops, banned-players, banned-ips) описываются декларативно (`PLAYER_LISTS`: каналы, файл, поле-идентификатор, команды, доп. поля), из описания регистрируются все 12 хендлеров. Имена каналов сохранены как были (`ban-player`/`unban-player`, `ban-ip`/`unban-ip`). Проверено: 18/18 — все каналы на месте, дубликаты по регистру не добавляются, у ops `level=4`, у банов `created`/`source`, для banned-ips идентификатор — сам ip, команды уходят только запущенному серверу, удаление отсутствующей записи не падает и не шлёт команду. |
| 8 fs-хендлеров с копиями traversal-check | Введена одна `resolveInsideServer` (сравнение через `path.relative` вместо `startsWith`). Это не только убрало 8 копий, но и закрыло дыру: проверка `startsWith(serverDir)` пропускала соседнюю папку с общим префиксом (`.../mc-servers/abc-other` для `.../mc-servers/abc`). Применена и в `mc-server:resolve-installed`, и при распаковке `server-overrides`, и при установке модпака. Проверено: 15/15 — `..`, двойной `..`, абсолютный путь, соседняя папка с общим префиксом, запись/создание/удаление/перемещение наружу отклоняются, легитимные операции внутри работают. |
| Общий скелет обхода инстансов скопирован в 4 импортёрах | `import/helpers.ts`: `discoverInstancesFromDirs(dirs, readInstance)` — readdir, только подкаталоги, чтение каждого, единая сортировка по имени (ru). Применён в `gdlauncher.ts`, `mmc-like.ts`, `modrinthapp.ts`, `xlauncher.ts` (в Modrinth App замыкание сохраняет связку с записью из БД). Проверено: 7/7 — не-каталоги пропускаются, `null`-инстансы фильтруются, отсутствующий каталог не роняет обход, порядок сортировки единый. |

`mc-server-handlers.ts` уменьшился с 1374 до 1250 строк при сохранении поведения.

## Блок B — IPC (B5)

| Проблема | Что сделано |
|---|---|
| Двойной стандарт регистрации + «ctxHandler глотает ошибку» | `ipc-router.ts` не удалён и не размножен на 215 каналов: разделение зафиксировано как осознанное правило (в шапке модуля описано, когда `ctxHandler`, когда `rawHandler`/прямой `ipcMain.handle`). Устранён реальный дефект: сбой `ctxHandler`-канала раньше попадал только в консоль main-процесса — теперь ошибка пишется в runtime-журнал лаунчера (`callHandler` в `minecraft-core.ts` вызывает `logRuntime`), то есть её видно на странице «Логи». Поведение каналов не изменилось (fallback по-прежнему возвращается). Проверено: 6/6 — fallback отдаётся, запись `[IPC] Failed to <канал>: …` есть в журнале, `rawHandler` по-прежнему прокидывает ошибку вызывающему. |

Единый стиль «всё через router» сознательно не вводился: он не меняет поведение, но требует переписать ~215 регистраций с риском регрессий.

## Блок B — облачный loopback (B3, завершение)

| Проблема | Что сделано |
|---|---|
| 4 копии OAuth loopback-flow (Google Drive, OneDrive, Dropbox, Яндекс Диск) | `cloud/oauth-loopback.ts`: единый каркас — сервер на порту, открытие URL авторизации, приём `code`, обмен, страницы успеха/ошибки, закрытие сервера и снятие таймера. Провайдер передаёт только свои параметры (`providerId`, порт, `buildAuthUrl`, `exchange`). Бонусом закрыты два дефекта копий: таймер ожидания снимается всегда (раньше после успеха он держал процесс ещё 2 минуты), а занятый порт завершает попытку ошибкой вместо вечного ожидания (`server.on("error")`). Импорты `shell`/`toErrorMessage`/`generatePkcePair`/`callback*Page` из провайдеров убраны. |

Проверено: копий `createServer`/`generatePkcePair` в провайдерах не осталось (0 совпадений); `tsc --noEmit`, `tsc -p tsconfig.node.json`, `vite build` — зелёные.

## Блок B — вынос XN-Connect

| Проблема | Что сделано |
|---|---|
| Каналы `xn-connect:*` жили внутри `mc-server-handlers.ts` (чужой домен в модуле про серверы) | Создан `xn-connect-handlers.ts` (`registerXnConnectHandlers`), регистрация вызывается из `main/index.ts`. Поведение не изменилось: 5 каналов (`authorize`, `start`, `stop`, `status`, `usage`) перенесены целиком, включая проверку «туннель поднимается только для запущенного сервера». Проверено: 5/5 — все каналы зарегистрированы, дублей нет, `mc-server-handlers` больше их не регистрирует (54 канала остались в своём модуле). |

**Блок B выполнен полностью.**

# Критично: сборка паковала УСТАРЕВШИЕ @xnlc-пакеты из registry

Обнаружено при выпуске билда 1.0.6 (вопрос «в exe точно самые новые библы xnlc?»).

**Симптом.** Локальные правки в `packages/xnlc-*` не попадали в собранный exe. `pnpm run sync:xnlc` (пересборка + junction в `node_modules`) проблему **не решал**: после него `dist-electron` и typecheck использовали свежие пакеты, а electron-builder — нет.

**Причина.** `package.json` объявлял зависимости как semver: `"@xnlc/core": "^1.0.6"`, `"@xnlc/mods": "^1.0.3"`, `"@xnlc/types": "^1.0.8"` и т.д. По `pnpm-lock.yaml` они разрешались в **tarball'ы приватного registry** (`git.xneon.org`), которые лежат в `node_modules/.pnpm/@xnlc+*`. electron-builder строит граф прод-зависимостей из lockfile и пакует именно эти копии, а junction'и `node_modules/@xnlc/*` → `packages/*`, которые создаёт `sync:xnlc`, для упаковки не используются.

Проверка в собранном `app.asar` (до фикса) показала:
- `@xnlc/mods/src/types.ts` — старая сигнатура `ModLoaderFilter` **без `forge`**;
- `@xnlc/core/lib/core/java-runner.js` — **нет** `writeJavaArgFileIfTooLong`;
- `@xnlc/core/lib/core/assets-manager.js` — **нет** `readyCache`;
- `@xnlc/core/lib/core/libraries-manager.js` — **нет** `resolveCache`;
- `@xnlc/core/lib/core/launch-builder.js` — всё ещё содержит удалённый `writeClasspathFile`.

То есть в exe уезжали все пять пакетов в состоянии на момент последнего `pnpm install` (для `@xnlc/mods` — версия от 12.09).

**Исправление.** Зависимости переведены на workspace-протокол (это и записано в `AGENTS.md`, фактически же стояли semver-диапазоны):
- `package.json`: `@xnlc/{core,mods,nbt,servers,types}` → `workspace:*`;
- `packages/xnlc-core/package.json` и `packages/xnlc-servers/package.json`: `@xnlc/types` → `workspace:*` (иначе внутри пакетов оставались вложенные registry-копии `@xnlc/types@1.0.4/1.0.7`);
- `pnpm install` → в lockfile `version: link:packages/xnlc-*`, `node_modules/.pnpm/@xnlc+*` больше не используются.

**Проверка после фикса.** В `app.asar` теперь по одной копии каждого пакета, и все правки на месте (13/13 проверок по содержимому: `forge` в `ModLoaderFilter`, `@argfile`, кэш ассетов, мемоизация библиотек, отсутствие `writeClasspathFile`, `DbBuildLight`/`gameActiveStartedAt`/`discoverFromPath` в типах, `MAX_LOG_BUFFER` в серверах). Дополнительно запущено собранное приложение (`release/win-unpacked`): main стартует без ошибок резолва модулей, а IPC-вызовы, идущие через `@xnlc/core` (`getForgeSupported` → 77, `getFabricSupported` → 529), отвечают — значит пакеты реально резолвятся из asar.

**Вывод для будущих релизов.** `sync:xnlc` нужен только для dev-линковки; чтобы правки пакетов попали в exe, достаточно `workspace:*` (или публикации новых версий в registry). Проверять содержимое пакета можно распаковкой asar — этот способ и использовался.

# Исправление «выгрузки» списка сборок и чёрного экрана

Сообщение пользователя: при загрузке сборок через некоторое время данные выгружаются и загружаются снова, причём загрузка — чёрный экран без индикатора.

Найдено четыре дефекта, каждый подтверждён в коде и проверен в живом окне.

| Дефект | Причина | Что сделано |
|---|---|---|
| Чёрный экран без индикатора | В `launcher.tsx` fallback `Suspense` был пустым `<div className="h-full w-full" />` — при загрузке lazy-страницы (сборки, скины) на экране не было ничего. Это была моя регрессия из прошлой правки code-splitting («нейтральный fallback без спиннера»). | Заменён скелетом: плашка, строка заголовка, поиск и сетка карточек с `animate-pulse` и `aria-busy`. Проверено с искусственной задержкой чанка: скелет отображался все 5 с загрузки вместо пустого экрана. |
| Данные «выгружаются» и грузятся заново | В `reloadBuilds` пустой ответ IPC вызывал `setBuilds([])`. Пустой список приходит не только когда сборок нет, но и при сбое IPC или недоступной БД — уже показанный список исчезал, а следующий запрос возвращал данные («снова загрузка»). Плюс у `reloadBuilds` не было `catch`: отклонение промиса уходило в unhandled rejection. | Непустой список при пустом ответе сохраняется (с предупреждением в лог), добавлен `catch` с сохранением прежних данных. Проверено: подменил `loadBuildsLight` на возврат `[]` — все 17 сборок остались на экране (раньше список очищался). |
| Повторная загрузка при каждом возврате во вкладку | TTL кэша списка был 3 секунды, а при протухшем кэше данные не показывались до ответа БД (сначала `reloadBuilds`, потом `setBuilds`). | TTL увеличен до 5 минут, введён stale-while-revalidate: кэш показывается сразу и независимо от TTL, а устаревшие данные обновляются в фоне — список не пропадает. |
| Любая ошибка рендера = чёрный экран приложения | `ErrorBoundary` существовал только внутри страницы облака; исключение в рендере любой другой страницы размонтировало всё дерево React. | Добавлен общий `components/ui/error-boundary.tsx` (с `resetKey` — сбой одной вкладки не «залипает» при переходе на другую, кнопки «Попробовать снова» и «Перезагрузить», строки в 5 локалях) и обёрнуты все страницы. Проверено искусственным сбоем в «Статистике»: показано сообщение, приложение осталось живым, при возврате страница восстановилась. |

Проверка: `tsc --noEmit`, `tsc -p tsconfig.node.json`, `vite build` — зелёные; временный код проверок удалён.

# Просмотр плаща и элитры в 3D-превью скинов (по запросу пользователя)

Задача: видеть, как выбранный плащ выглядит на модели — и как плащ, и как элитра (в Minecraft элитра использует ту же текстуру плаща).

**Что сделано:**
- `components/ui/skin-viewer-3d.tsx`: два новых пропа — `backEquipment: "cape" | "elytra"` (уходит в `loadCape`; поддерживается самим skinview3d, тип `BackEquipment`) и `faceBack` — разворот модели спиной через `playerWrapper.rotation.y` (у OrbitControls этой версии three нет `setAzimuthalAngle`, а поворот модели не ломает вращение мышью).
- `components/launcher/skins/skin-preview-panel.tsx`: одна кнопка **«Элитра»** в правом верхнем углу превью. Клик разворачивает персонажа спиной и показывает элитру, повторный клик возвращает вид анфас. Без выбранного плаща кнопка заблокирована с подсказкой «Сначала выберите плащ» — элитра рендерится из текстуры плаща, и переключать без него нечего.
- `components/ui/elytra-icon.tsx`: иконка элитры — **точная копия игровой текстуры** (16×16, 8 цветов, 122 пикселя). Пиксели и цвета взяты из открытого набора [minecraft-items-react](https://github.com/Andcool-Systems/Minecraft-Items-React) (MIT) через [jsDelivr](https://cdn.jsdelivr.net/npm/minecraft-items-react@0.1.2/dist/), где иконка собрана попиксельно по текстуре игры; соседние пиксели объединены в горизонтальные полосы (96 полос вместо 122 элементов), поэтому файл весит ~3 КБ и не тянет внешних ресурсов. Первый вариант (нарисованный вручную силуэт) заменён: он лишь отдалённо напоминал элитру.
- Локализация: `skins.elytra` и `skins.elytraNoCape` добавлены во все 5 языков (ru/en/de/es/uk).

**Проверено в живом приложении** (через dev-сервер): кнопка «Элитра» активна при выбранном плаще, клик разворачивает персонажа спиной и показывает крылья, повторный клик возвращает анфас. Состояния сверены скриншотами. `tsc --noEmit`, `tsc -p tsconfig.node.json`, `vite build` — зелёные.

## Пересмотр code-splitting (по замечанию пользователя)

Первая версия дробления повесила `React.lazy` на все страницы, из-за чего каждый первый заход на вкладку ждал водопад запросов. Замер после перезагрузки страницы: вход в «Настройки» — **331 мс при 11 запросах модулей**, хотя сами модули крошечные (5–7 мс каждый). Причина — каскад `lazy → модуль страницы → его импорты`, а не размер чанков.

Проверка состава чанков показала, что тяжёлых зависимостей всего две: `skinview` (three + skinview3d, 505 КБ) и `markdown` (react-markdown/rehype, 284 КБ, тянется страницей сборок). `prismjs` лежит в общем `vendor`, поэтому lazy для файлов сервера ничего не экономил; статистика (15 КБ), логи (15 КБ), облако (45 КБ), аккаунты (44 КБ), серверы (97 КБ) и настройки (60 КБ) — собственный код без тяжёлых библиотек.

Что сделано: `lazy` оставлен только для скинов и сборок, остальные страницы вернулись в статический импорт; тяжёлые чанки прогреваются в простое (`requestIdleCallback`); fallback стал нейтральным (пустой блок вместо спиннера на весь экран).

Результат замера после правки (перезагрузка → первый вход): «Настройки» 331 → **30 мс**, «Логи» 21, «Статистика» 12, «Облако» 5, «Серверы» 29, «Аккаунты» 16 — **0 сетевых запросов**. Скины открываются за 313 мс при нуле запросов (модуль уже прогрет, время уходит на инициализацию WebGL), сборки — мгновенно из прогретого чанка; вкладка сборок отображает все 17 сборок. Переключения вкладок — 7–50 мс.

Компромисс: стартовый чанк вырос с 167 КБ до 597 КБ (gzip ≈160 КБ). Для десктопного приложения это допустимо — файлы читаются локально из asar, а не по сети, — а взамен переходы по вкладкам перестали ждать.

# Найденный и исправленный баг: сервер без установленной Java не запускался

Пользовательский сценарий: на машине нет ни одной Java, создаётся сервер (ядро, версия, порт, ОЗУ, «Java автоматически», XN-Connect), но запуск не начинался — ядро не скачивалось.

Причина: `mc-server-handlers.ts` при отсутствии Java бросал `Java not found. Please set Java path in settings.` **до** загрузки ядра, хотя путь к Java нужен уже инсталляторам Forge/NeoForge (`ensureServerJar` получает `javaPath`). Клиент в той же ситуации Java скачивает — через `JavaManager.findOrDownloadJava` из `@xnlc/core`.

Исправление:
- добавлена функция `requiredJavaForMcVersion` (≤1.16.5 → 8, 1.17 → 16, 1.18–1.20.4 → 17, 1.20.5+ → 21; снапшоты — как современные);
- добавлена `ensureServerJava`: если Java не найдена ни в записи сервера, ни в настройках, ни в системе — рантайм скачивается тем же `JavaManager` в общий каталог `<gameDir>/runtime` (тот же, что у клиента, поэтому установка переиспользуется);
- прогресс скачивания Java уходит в renderer через существующий канал `mc-server:download-progress` (фаза `downloading` с сообщением «Скачивание Java N…»);
- ошибка теперь внятная: «Java не найдена, и не удалось скачать рантайм: …».

Проверено исполняемо (12/13, единственный «провал» — в тестовой среде нет окна для push-прогресса): таблица версий; при эмуляции машины без Java вызывается `JavaManager` с версией 17 для 1.20.1; скачанный путь доходит и до `ensureServerJar`, и до `serverManager.start`; старт не падает с «Java not found».

**Наблюдения, не исправлялись** (существовали до правок):
- `skinview3d` бросает `Bad skin size: 463x638` / `2202x1167` при открытии вкладки скинов — вьюер получает изображения, не являющиеся скинами; валидации размера при добавлении скина в библиотеку нет.
- Запись в `skin_library` ссылается на отсутствующий файл (`ENOENT` на `<data>/skins/5b3088dc-….png`) — «мёртвая» запись библиотеки, превью не построить.
- Ошибка отрисовки `<path> attribute d: Expected arc flag` в консоли renderer (прогресс-индикатор); к правкам отношения не имеет.
- В корне репозитория лежит `.tmp-export-test.zip` на 1.06 ГБ и старые `.tmp-restart*-err/out.log` от прошлых сессий.
