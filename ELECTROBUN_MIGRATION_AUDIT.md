# Аудит миграции Xneon Launcher: Electron IPC → Electrobun

**Дата:** 2026-11-10
**Репозиторий:** C:\xnlauncher
**Версия приложения:** 1.0.8 (package.json)
**Предмет:** оценка объёма работ по переносу IPC- и нативного слоя лаунчера с Electron 45 на Electrobun 2.0.6 (Hutch 0.29, runtime Bun 1.4.4).
**Режим работы:** только анализ. Файлы проекта не изменялись; единственный созданный файл — этот отчёт.

Все количественные утверждения ниже получены прямым пересчётом исходников, а не взяты из внутренней документации проекта. Метод пересчёта приведён в §2, поэтому любую цифру можно воспроизвести. Всё, что нельзя подтвердить по документации Electrobun, помечено **UNKNOWN** с рецептом проверки.

Формат ссылок: **путь:строка**. Для краткости пути в таблицах даны относительно корня репозитория (electron/main/...), в примечаниях — полностью.

## 1. Итоговое резюме

IPC-слой лаунчера крупный и хорошо централизован: единственный источник правды — packages/xnlc-types/src/ipc-contracts.ts (965 строк), из которого выводятся типы preload и renderer. В коде реально регистрируется **300 каналов-обработчиков** (из них 292 объявлены в контракте как invoke, плюс 34 объявленных события, плюс 8 каналов, живущих в коде вне контракта). Сам контракт — это чистые TypeScript-типы без единой зависимости от Electron, поэтому он переносится без изменений и становится естественной схемой для типизированного RPC Electrobun.

Хорошая новость: подавляющая часть тел обработчиков — это логика над файловой системой, HTTP и SQLite, которая после смены механизма регистрации (ipcMain.handle → bun.requests) работает как есть. Плохая новость сосредоточена в узком, но критичном наборе системных API Electron, у которых в Electrobun либо нет прямого эквивалента, либо он есть, но только частично:

- **Код-подпись Windows и кросс-сборка.** Выпуск Windows-сборок через Hutch сейчас не подписывается, и Electrobun принципиально не умеет кросс-компиляцию (compatability.md:22, code-signing.md:11). Для распространяемого лаунчера это блокер распространения, а не порт логики.
- **Диалог сохранения файла.** В нативных SDK Electrobun диалога сохранения нет вовсе (utils.md:219). Лаунчер использует showSaveDialog минимум в четырёх местах (export темы, export сборки, export modlist, бэкап сервера).
- **Deep links xneon:// и single-instance.** Регистрация URL-схем в Electrobun реализована только на macOS (build-configuration.md:155), а API единственного экземпляра в документации не описано вовсе. Это ломает приглашения и шаринг через xneon://share/... на Windows — основной целевой платформе.
- **Хранилище секретов.** safeStorage (ключи AI, MCP и учётные данные share) в документации Electrobun не заменён.
- **Модель обновления.** electron-updater заменяется на принципиально другой механизм Electrobun Updater (HTTPS-хостинг манифестов и собственный формат патчей), с нуля.

Вывод: это не «миграция логики», а **замена системного рантайма с частичной переработкой подсистем** — оконной, диалоговой, протокольной, обновления и подписи. Отдельные крупные куски (XNLC-пакеты, контракт IPC, серверная и скиновая логика) уже к Electron не привязаны и переносятся дёшево, но перечисленные блокеры делают полную миграцию преждевременной. Рекомендация (§16): **частичная миграция по пилоту либо сохранение Electron с переоценкой**.

## 2. Проверенная инвентаризация IPC (метод и числа)

Источник правды — packages/xnlc-types/src/ipc-contracts.ts. Границы блоков (перепроверено построчно):

- строка 137 — export interface IpcInvokeMap
- строка 525 — export interface IpcEventMap
- строка 569 — export interface ElectronAPIExplicit
- строка 760 — export interface ElectronAPIExtra
- строка 965 — export type ElectronAPI = ElectronAPIExplicit & ElectronAPIExtra

Подсчёт каналов (PowerShell, regex по срезам строк):

    $lines = Get-Content packages\xnlc-types\src\ipc-contracts.ts
    $invoke  = $lines[137..523] | Where-Object { $_ -match '^\s*"([^"]+)"\s*:' }
    $events  = $lines[524..564] | Where-Object { $_ -match '^\s*"([^"]+)"\s*:' }
    $invoke.Count   # 292
    $events.Count   # 34

| Метрика | Значение |
|---|---|
| Объявлено invoke-каналов (IpcInvokeMap) | **292** |
| Объявлено event-каналов (IpcEventMap) | **34** |
| Всего объявлено каналов | **326** |
| Членов ElectronAPIExplicit | 180 |
| Членов ElectronAPIExtra | 193 |
| Всего членов ElectronAPI | 373 |

Фактическая регистрация в main-процессе (regex по всем electron/**/*.ts):

    ipcMain\.handle\s*\(\s*"([^"]+)"              # 201
    ipcMain\.on\s*\(\s*"([^"]+)"                  # 5
    ctxHandler\s*\(\s*"([^"]+)"                   # 21
    rawHandler\s*\(\s*"([^"]+)"                   # 19
    registerMcServerHandler\s*\(\s*"([^"]+)"      # 42

Уникальных литерально зарегистрированных каналов — **288** (пересечений между механизмами нет). Плюс **12** каналов mc-server, которые регистрируются через таблицу описаний, а не литералом.

Сверка контракта с кодом:

| Проверка | Значение |
|---|---|
| invoke-каналов в контракте | 292 |
| из них зарегистрированы литерально | 280 |
| из них зарегистрированы через таблицу (mc-server) | 12 |
| зарегистрировано, но **отсутствует** в контракте | 8 |
| всего фактически зарегистрированных каналов-обработчиков | **300** |

Разложение 288 литералов по механизмам:

| Механизм | Всего | В контракте | Вне контракта |
|---|---|---|---|
| ipcMain.handle | 201 | 197 | 4 (ai:mcp-*) |
| ctxHandler | 21 | 21 | 0 |
| rawHandler | 19 | 19 | 0 |
| registerMcServerHandler | 42 | 42 | 0 |
| ipcMain.on | 5 | 1 (startup:theme-cache) | 4 (window:*) |
| Итого | 288 | 280 | 8 |

Прочие замеры:

| Метрика | Значение | Метод |
|---|---|---|
| Файлов в electron/, импортирующих electron | 48 | grep "from 'electron'" / require("electron") |
| Обращений window.electronAPI.X в renderer | 528 | regex по src,components,lib (без electron.d.ts) |
| Уникальных членов electronAPI в renderer | 255 | то же |
| Файлов renderer, задействующих electronAPI | 269 | то же |
| ipcRenderer.invoke в preload.ts | 248 | regex |
| ipcRenderer.on в preload.ts | 3 | regex |
| ipcRenderer.send в preload.ts | 4 | regex |
| ipcRenderer.sendSync в preload.ts | 1 | regex (startup:theme-cache, строка 99) |

## 3. Полный список каналов и классификация

Классификация по namespace (invoke). Колонка «класс» — куда попадает namespace при миграции (см. §5: A — переносится как есть, B — нужна адаптация API, C — существенная переработка, D — неизвестно/нужен PoC).

| Namespace | invoke | события | Класс | Что определяет класс |
|---|---|---|---|---|
| mc-server | 55 | 6 | A/B | логика fs/sqlite/процессы; диалоги (:398), метрики через webContents |
| minecraft | 37 | 5 | A/B | версии/лог/запуск; fork воркера |
| build | 36 | 2 | A/B/C/D | fs/архивы; диалоги и relaunch |
| mods | 17 | 0 | A | чистый HTTP-клиент |
| cloud | 14 | 1 | A/B/C | воркеры + OAuth-окна + executeJavaScript |
| agent | 14 | 1 | A/B | workspace/fs; screen |
| worlds | 12 | 0 | A/B | fs/NBT; nativeImage для иконок |
| db | 10 | 0 | A | sqlite-хелперы |
| authlib | 9 | 1 | A | HTTP/fs |
| auth | 9 | 0 | A/C | OAuth-окна + safeStorage |
| theme | 8 | 1 | A/B | локальные темы; диалоги/протокол |
| skins | 8 | 0 | A | @xnlc/skins, порты |
| laby | 6 | 0 | A | каталог через main |
| launcher | 6 | 0 | A | импорт/данные |
| update | 5 | 2 | C | electron-updater → Electrobun Updater |
| avatar | 5 | 0 | B/C | протокол avatar:// |
| xn-connect | 5 | 4 | A/D | релей dgram/net/WebSocket |
| ai | 5 | 3 | C | safeStorage + стриминг |
| screenshots | 4 | 0 | A | fs |
| quickplay | 3 | 0 | A | fs |
| servers | 3 | 0 | A | NBT |
| shell | 3 | 0 | B | shell.openExternal/openPath |
| java | 2 | 0 | A | детект JDK |
| settings | 2 | 1 | A | БД |
| share | 2 | 3 | A | БД/fs |
| fetch | 2 | 0 | A | HTTP |
| startup | 2 | 0 | A/B | sync-канал темы |
| storage | 2 | 0 | A | fs |
| common | 2 | 0 | B | диалоги выбора файла/папки |
| read-local-file | 1 | 0 | A | fs |
| stats | 1 | 1 | A | БД |
| system | 1 | 0 | B | память/dialog |
| content | 1 | 1 | A | загрузка |
| agent/mcp (вне контракта) | 4 | 0 | C/D | safeStorage + stdio MCP |
| window (вне контракта) | 4 | 0 | C | BrowserWindow-контролы |

Полный список invoke-каналов (292), по namespace:

**share (2):** share:cancel-install, share:execute

**mc-server (55):** mc-server:remote, mc-server:history, mc-server:list, mc-server:get, mc-server:host-settings, mc-server:create, mc-server:analyze-jar, mc-server:update, mc-server:delete, mc-server:restore, mc-server:list-trash, mc-server:purge-trash, mc-server:permanent-delete, mc-server:export-zip, mc-server:duplicate, mc-server:start, mc-server:stop, mc-server:kill, mc-server:send-command, mc-server:status, mc-server:metrics-subscribe, mc-server:metrics-unsubscribe, mc-server:logs, mc-server:install-state, mc-server:open-folder, mc-server:read-properties, mc-server:write-properties, mc-server:get-whitelist, mc-server:add-whitelist, mc-server:remove-whitelist, mc-server:get-ops, mc-server:add-op, mc-server:remove-op, mc-server:get-banned, mc-server:ban-player, mc-server:unban-player, mc-server:get-banned-ips, mc-server:ban-ip, mc-server:unban-ip, mc-server:get-addresses, mc-server:check-eula, mc-server:accept-eula, mc-server:fs-list, mc-server:fs-read, mc-server:fs-write, mc-server:fs-delete, mc-server:fs-rename, mc-server:fs-mkdir, mc-server:datapacks-list, mc-server:datapacks-install, mc-server:datapacks-cancel, mc-server:datapacks-delete, mc-server:fs-download, mc-server:resolve-installed, mc-server:install-pack

**startup (2):** startup:ready, startup:theme-cache

**system (1):** system:get-total-memory

**auth (9):** auth:elyby-login, auth:elyby-device-start, auth:elyby-device-poll, auth:xnskins-login, auth:xnskins-device-start, auth:xnskins-device-poll, auth:microsoft-login, auth:microsoft-device-start, auth:microsoft-device-poll

**authlib (9):** authlib:list-servers, authlib:probe-server, authlib:add-server, authlib:remove-server, authlib:refresh-server, authlib:login, authlib:ensure-session, authlib:invalidate, authlib:get-profile-textures

**fetch (2):** fetch:minecraft-news, fetch:launcher-news

**db (10):** db:load-accounts, db:save-account, db:remove-account, db:load-builds-light, db:load-build-content, db:save-builds, db:insert-build, db:update-build-fields, db:is-fallback-storage, db:reorder-accounts

**build (36):** build:fetch-missing-mods, build:watch-content, build:unwatch-content, build:scan-intent-content, build:get-intent-path, build:get-instances-root, build:set-instances-root, build:save-mod-to-intent, build:save-local-mod-to-intent, build:read-local-content-metadata, build:classify-drop-paths, build:save-content-to-intent, build:save-local-content-to-intent, build:delete-content-from-intent, build:set-content-enabled, build:set-intent-path, build:prune-loader-profiles, build:delete-intent, build:import-modrinth, build:import-curseforge, build:import-ftb, build:open-and-import, build:cancel-import, build:copy, build:rename-intent, build:export-zip, build:export-modlist, build:move-intent-to-trash, build:restore-intent-from-trash, build:purge-trash, build:list-trash, build:delete-trash-item, build:check-content-updates, build:get-content-updates-cache, build:get-content-updates-counts, build:dismiss-content-update

**launcher (6):** launcher:data-move-status, launcher:restart-for-data-move, launcher:discover-importable-instances, launcher:discover-from-path, launcher:import-gdlauncher-instances, launcher:import-instances

**common (2):** common:pick-folder, common:pick-file

**theme (8):** theme:read-media, theme:pick-media, theme:local-list, theme:local-import, theme:local-save, theme:local-delete, theme:local-export, theme:open-directory

**content (1):** content:cancel-download

**stats (1):** stats:overview

**storage (2):** storage:scan, storage:clean

**agent (14):** agent:clipboard-files, agent:complete, agent:hardware, agent:cancel, agent:set-archived, agent:list-chats, agent:get-chat, agent:save-chat, agent:delete-chat, agent:build-file, agent:build-destination, agent:mcp-tools, agent:mcp-call, agent:mcp-install

**ai (5):** ai:get-config, ai:save-config, ai:list-models, ai:analyze-crash, ai:analyze-crash-stream

**mods (17):** mods:modrinth-search, mods:modrinth-details, mods:modrinth-versions, mods:modrinth-pack-contents, mods:curseforge-search, mods:curseforge-details, mods:curseforge-download-url, mods:curseforge-changelog, mods:resolve-dependencies, mods:inspect-jar-dependencies, mods:check-loader-requirements, mods:ftb-search, mods:ftb-catalog-facets, mods:ftb-details, mods:ftb-changelog, mods:modrinth-categories, mods:curseforge-categories

**minecraft (37):** minecraft:get-versions, minecraft:get-latest-release, minecraft:get-fabric-versions, minecraft:get-fabric-supported, minecraft:get-liteloader-versions, minecraft:get-liteloader-recommended, minecraft:get-liteloader-supported, minecraft:get-quilt-versions, minecraft:get-quilt-supported, minecraft:get-optifine-versions, minecraft:get-optifine-recommended, minecraft:get-optifine-supported, minecraft:get-neoforge-versions, minecraft:get-neoforge-recommended, minecraft:get-neoforge-supported, minecraft:get-forge-versions, minecraft:get-forge-recommended, minecraft:get-forge-supported, minecraft:get-custom-versions, minecraft:get-paper-versions, minecraft:get-paper-supported, minecraft:get-purpur-versions, minecraft:get-purpur-supported, minecraft:get-folia-versions, minecraft:get-folia-supported, minecraft:get-velocity-versions, minecraft:get-velocity-supported, minecraft:get-waterfall-versions, minecraft:get-waterfall-supported, minecraft:get-sponge-versions, minecraft:get-sponge-supported, minecraft:set-offline-auth, minecraft:get-game-dir, minecraft:get-auth, minecraft:launch, minecraft:stop, minecraft:is-running

**settings (2):** settings:get, settings:set

**worlds (12):** worlds:list, worlds:rename, worlds:delete, worlds:set-icon, worlds:list-datapacks, worlds:install-datapack-remote, worlds:install-datapack-local, worlds:delete-datapack, worlds:import-zip, worlds:import-remote, worlds:copy, worlds:reset-icon

**screenshots (4):** screenshots:list, screenshots:get, screenshots:delete, screenshots:rename

**shell (3):** shell:open-external, shell:open-launcher-folder, shell:open-path

**servers (3):** servers:list, servers:write-dat, servers:ping

**quickplay (3):** quickplay:list, quickplay:clear, quickplay:remove

**update (5):** update:check, update:download, update:install, update:get-channel, update:set-channel

**read-local-file (1):** read-local-file

**skins (8):** skins:get-profile, skins:delete-skin, skins:set-cape, skins:list-library, skins:save-to-library, skins:delete-from-library, skins:update-variant, skins:apply-library-skin

**laby (6):** laby:catalog, laby:tags, laby:similar, laby:player, laby:save-to-library, laby:apply

**avatar (5):** avatar:get-textures, avatar:get-head, avatar:get-skin, avatar:get-cape, avatar:invalidate-cache

**java (2):** java:detect, java:pick-file

**cloud (14):** cloud:list-providers, cloud:connect, cloud:is-connected, cloud:disconnect, cloud:list-files, cloud:download-file, cloud:delete-file, cloud:get-quota, cloud:upload-theme, cloud:import-theme, cloud:upload-build, cloud:upload-server, cloud:upload-account, cloud:download-and-import

**xn-connect (5):** xn-connect:authorize, xn-connect:start, xn-connect:stop, xn-connect:status, xn-connect:usage

Полный список событий (34):

share:progress, share:installed, share:invitation, theme:local-changed, minecraft:java-progress, minecraft:debug, minecraft:data, minecraft:download-progress, minecraft:close, import:progress, build:export-progress, build:content-changed, content:download-progress, cloud:upload-progress, mc-server:download-progress, mc-server:log, mc-server:state-change, mc-server:metrics, mc-server:remote-snapshot, mc-server:remote-connection, xn-connect:usage-updated, xn-connect:state, xn-connect:log, xn-connect:auth-state, ai:stream-chunk, agent:delta, ai:stream-done, ai:stream-error, update:status, update:progress, cli:launch-build, stats:updated, authlib:login-progress, settings:updated

Проверено: все 34 объявленных события действительно используются в коде (мёртвых нет). Обратное неверно — см. §4.

## 4. Несоответствия в IPC

Все проверено сопоставлением контракта с кодом.

1. **8 каналов зарегистрированы в коде, но отсутствуют в контракте.** Четыре MCP-канала: agent-mcp.ts:224 (ai:mcp-list), :225 (ai:mcp-save), :232 (ai:mcp-connect), :243 (ai:mcp-disconnect). Четыре оконных: window.ts:131 (window:minimize), :133 (window:restore), :141 (window:maximize), :151 (window:close). Ни один не входит ни в IpcInvokeMap, ни в ElectronAPI-типы — preload отдаёт их отдельными методами (preload.ts:102–105). При переносе на RPC-схему они обязаны стать явными request-членами, иначе выпадут из типизации.

2. **startup:theme-cache объявлен как invoke, но реализован синхронно.** В контракте это обычный invoke-канал (строка 144), а в коде — ipcMain.on с returnValue (window.ts:117), который renderer читает до первого кадра: ipcRenderer.sendSync (preload.ts:99). Это не прихоть: снапшот темы нужен синхронно, до первой отрисовки окна, иначе будет вспышка чужой темы. В Electrobun RPC по определению асинхронный; синхронного моста нет. Ближайший безопасный путь — инлайнить тему в HTML/страницу либо применять её до показа окна (startTransparent + готовность). Это отдельный пункт работ (§12).

3. **update:channel-changed эмитится, но не объявлен.** updater.ts:159 отправляет это событие в renderer; в IpcEventMap его нет, обработчика в preload тоже. Событие «висит» без подписчика. При переносе либо завести в схеме, либо убрать.

4. **12 каналов mc-server регистрируются динамически.** Таблица PLAYER_LISTS (mc-server-handlers.ts:836–868) описывает whitelist/ops/banned/banned-ips; регистрация идёт в цикле (:878–910): get/add/remove на каждую из четырёх таблиц. В RPC-схеме это не выражается автоматически — 12 записей придётся либо развернуть явно, либо генерировать схему кодом.

5. **ipcMain.on + ipcRenderer.send для оконных контролов.** Четыре window:*-канала — односторонние send (preload.ts:102–105), не invoke. В RPC им соответствуют message-члены (bun.messages) или requests без ожидания ответа.

6. **Каналы вне контракта не видны renderer-типам.** Поскольку src/electron.d.ts — ре-экспорт @xnlc/types, оконные контролы и MCP сейчас типизированы только локально в preload, а не в общей схеме.

## 5. Анализ зависимостей обработчиков (классификация A/B/C/D)

Ниже — разложение 300 зарегистрированных каналов-обработчиков по четырём классам. Класс определён по телу обработчика: какие Electron-API он трогает и есть ли у них эквивалент в Electrobun.

- **A. Переносится без изменений** — меняется только способ регистрации (ipcMain.handle/ctxHandler/rawHandler/registerMcServerHandler → bun.requests). Тело не трогаем.
- **B. Переносится с адаптацией API** — несколько вызовов меняются на электробуновские (dialog/shell/clipboard/screen/nativeImage/app.getPath).
- **C. Существенная переработка** — меняется модель (окна OAuth, протоколы, обновление, safeStorage, контролы окна).
- **D. Неизвестно, нужен PoC** — доступность зависит от Bun/Electrobun и не подтверждена документацией.

| Модуль | Всего | A | B | C | D | Ключевые места Electron-API |
|---|---|---|---|---|---|---|
| electron/main/mods.ts | 17 | 17 | 0 | 0 | 0 | — (axios + fs) |
| electron/main/minecraft.ts | 37 | 35 | 2 | 0 | 0 | fork() launch-orchestrator.ts:291; spawnSync minecraft-launch-worker.ts:4 |
| electron/main/builds/index.ts | 39 | 34 | 3 | 1 | 1 | showSaveDialog :628,:739; showOpenDialog :1111; app.relaunch :379 |
| electron/main/mc-server-handlers.ts | 52 | 48 | 2 | 2 | 0 | showSaveDialog :398; webContents.fromId :39,:67-72 |
| electron/main/system.ts | 27 | 24 | 3 | 0 | 0 | showOpenDialog :561,:572,:590; execFileSync :276 |
| electron/main/worlds.ts | 16 | 13 | 3 | 0 | 0 | nativeImage :9,:170,:405,:588,:636 |
| electron/main/skins/index.ts | 15 | 15 | 0 | 0 | 0 | — (@xnlc/skins через порты) |
| electron/main/cloud/handlers.ts | 12 | 4 | 2 | 6 | 0 | new Worker :6,:143; OAuth-окна; callback-page executeJavaScript :11 |
| electron/main/agent-workspace.ts | 11 | 9 | 2 | 0 | 0 | screen.getAllDisplays :123-124 |
| electron/main/authlib/handlers.ts | 9 | 9 | 0 | 0 | 0 | — |
| electron/main/auth.ts | 9 | 3 | 1 | 5 | 0 | BrowserWindow + webContents-события :103-107,:170-182; safeStorage :1,:21-48 |
| electron/main/agent-mcp.ts | 7 | 0 | 2 | 2 | 3 | safeStorage :27-34; @modelcontextprotocol/sdk stdio |
| electron/main/theme-files.ts | 7 | 3 | 3 | 1 | 0 | showOpenDialog :46,:88; showSaveDialog :56; protocol.handle :68-70 |
| electron/main/window.ts | 6 | 2 | 0 | 4 | 0 | BrowserWindow-контролы :131-151; sync-канал :117 |
| electron/main/avatar.ts | 5 | 2 | 1 | 2 | 0 | protocol.registerSchemesAsPrivileged :681; protocol.handle :706 |
| electron/main/updater.ts | 5 | 0 | 0 | 5 | 0 | electron-updater/autoUpdater :20-165 |
| electron/main/ai-agent.ts | 5 | 0 | 2 | 3 | 0 | safeStorage :1,:24-35 |
| electron/main/xn-connect-handlers.ts | 5 | 2 | 0 | 0 | 3 | релей: dgram/net/WebSocket |
| electron/main/servers.ts | 3 | 3 | 0 | 0 | 0 | — (NBT) |
| electron/main/quick-play.ts | 3 | 3 | 0 | 0 | 0 | — (fs) |
| electron/main/storage.ts | 2 | 2 | 0 | 0 | 0 | — |
| electron/main/share/index.ts | 2 | 2 | 0 | 0 | 0 | — |
| electron/main/cloud/theme-handlers.ts | 2 | 2 | 0 | 0 | 0 | — |
| electron/main/stats.ts | 1 | 1 | 0 | 0 | 0 | — |
| remote-servers (3 файла) | 3 | 3 | 0 | 0 | 0 | — |
| **Итого** | **300** | **236** | **26** | **31** | **7** | |

Итог по классам:

| Класс | Каналов | Доля |
|---|---|---|
| A — без изменений | 236 | 78.7% |
| B — адаптация API | 26 | 8.7% |
| C — существенная переработка | 31 | 10.3% |
| D — неизвестно/PoC | 7 | 2.3% |

Отдельно от каналов (нет IPC-обработчиков, но работает фоном и импортирует electron): electron/main/share/links.ts (deep links + single instance), electron/main/discord-rpc.ts (discord-rpc по ipc-транспорту), electron/main/paths.ts и runtime-paths.ts (app.setPath), electron/main/index.ts (жизненный цикл приложения).

## 6. Совместимость XNLC

Локальные пакеты (pnpm workspace, packages/*) — главный аргумент в пользу того, что миграция не «с нуля»: домен уже отделён от Electron.

| Пакет | Зависимости | Привязка к Electron | Вердикт |
|---|---|---|---|
| @xnlc/types | @xnlc/share | нет (чистые типы) | переносится как есть; контракт IPC становится RPC-схемой |
| @xnlc/core | adm-zip, iconv-lite | нет (fs/path/os/child_process/crypto/url/zlib) | переносится; проверить child_process на Bun |
| @xnlc/mods | — | нет | переносится как есть |
| @xnlc/nbt | — | нет (zlib) | переносится как есть |
| @xnlc/servers | adm-zip, iconv-lite, toml | нет (fs/net/http/dns/readline) | переносится; net/dns на Bun |
| @xnlc/skins | @xnlc/core, @xnlc/types | нет (порты SkinDiskCache/SkinLibraryStore/SkinAccountPort) | переносится как есть; реализации портов в electron/main/skins/ports.ts |
| @xnlc/agent | @xnlc/types | нет | переносится как есть |
| @xnlc/share | — | нет | переносится как есть |

Единственная точка внимания: @xnlc/core и @xnlc/servers используют child_process/net/http/dns. Node-совместимость Bun здесь высокая, но это подлежит PoC (§14). @xnlc/skins изначально спроектирован без Electron (порты), поэтому слой скинов и Laby мигрирует дешевле всего.

## 7. Таблица совместимости зависимостей

| Package | Текущее использование | Совместимость с Bun | Требуемые изменения | Альтернатива |
|---|---|---|---|---|
| electron | рантайм main+preload, 48 файлов | не применимо (заменяется) | заменить на Electrobun 2.0.6 | Electrobun |
| electron-builder | сборка/дистрибуция | не применимо | перейти на hutch electrobun build + electrobun.config.ts | Hutch |
| electron-updater | обновления, updater.ts | не применимо | переписать на Electrobun Updater (HTTPS-манифесты, свои патчи) | Electrobun Updater |
| better-sqlite3 | БД лаунчера и импорт Modrinth App | **UNKNOWN** (Node-API v13, prebuilds win32-x64) | PoC под Bun; при провале — переписать слой db | bun:sqlite / node:sqlite |
| @modelcontextprotocol/sdk | MCP, agent-mcp.ts (stdio + HTTP) | частично: HTTP ок; stdio-spawn под вопросом | PoC stdio-транспорта; при провале — только HTTP | HTTP-транспорт MCP |
| discord-rpc | presence, discord-rpc.ts (transport:"ipc") | сомнительно (IPC через именованные каналы Windows) | PoC; при провале — убрать или иной режим | собственный presence-клиент |
| adm-zip | архивы (build, servers) | высокая (чистый JS) | нет | — |
| axios | HTTP-клиент (mods, cloud, laby) | высокая | нет | — |
| webdav | облако (cloud/providers) | высокая (axios) | нет | — |
| iconv-lite | кодировки (core, servers) | высокая | нет | — |
| toml | серверные конфиги | высокая | нет | — |
| pngjs | иконки/скины (main) | высокая | нет | — |
| form-data | загрузки в облако | высокая | нет | — |
| i18next, react-i18next | локализация renderer | высокая (renderer) | нет | — |
| react 19 | renderer | не применимо (webview) | нет | — |
| three, skinview3d | превью скинов (renderer) | высокая (WebGL/WebGPU) | нет; учесть WebGPU-адаптеры Electrobun | — |
| prismjs, remark-gfm, react-simple-code-editor | подсветка/рендер (renderer) | высокая | нет | — |
| @fontsource/plus-jakarta-sans | шрифты | высокая | нет | — |

Итог: несовместимых/критичных — **5** (electron, electron-builder, electron-updater, better-sqlite3, discord-rpc) плюс **2** требующих PoC (MCP stdio, child_process-логика core/servers). Остальное — чистый JS или renderer.

## 8. Совместимость Electrobun RPC

Ключевые факты по документации Electrobun 2.0.6:

- Типизированный RPC: Electroview.defineRPC (webview) и BrowserView.defineRPC (main) с общей схемой RPCSchema, где **bun.requests** — это ровно те же «запросы renderer → main», что сейчас invoke-каналы; **bun.messages** — односторонние сообщения (аналог ipcMain.on); **webview.requests/messages** — обратное направление. То есть 292 invoke раскладываются в bun.requests напрямую, а 34 события — в push-сообщения webview.
- Транспорт: зашифрованный loopback с нативным мостом как fallback. Есть байтовые лимиты пакетов и статистика очереди getHostMessageQueueStats (queuedMessages/queuedBytes/oldestMessageAgeMs/enqueuedMessages/drainedMessages/peakQueuedMessages/peakQueuedBytes). Важно для тяжёлых стримов (логи сервера, download-progress, ai:stream-chunk).
- **Бинарные данные и стриминг — UNKNOWN.** Документация описывает JSON и Uint8Array (примеры: PNG-буфер в буфер обмена), но потоковой передачи через RPC нет. Текущий код уже гоняет данные строками/base64/data-URL, поэтому прямой бинарный путь не обязателен, но проверять надо.
- **Ограничение песочницы:** sandbox:true **отключает RPC**. Текущее окно создано с sandbox:true (window.ts:24-37), значит при переносе придётся отказаться от песочницы либо вынести мост иначе.
- executeJavascript **не возвращает значение** (browser-view.md:232). В коде есть место, полагающееся на возврат — cloud/callback-page.ts:11. Его придётся переводить на RPC.
- Все события webview/приложения документированы (will-navigate, did-navigate, dom-ready, download-*, open-url, before-quit и т.д.), но payload типизирован как unknown.

Сопоставление «мостов»:

| Electron | Electrobun | Примечание |
|---|---|---|
| ipcRenderer.invoke / ipcMain.handle | bun.requests (RPC) | 1:1 по смыслу |
| ipcRenderer.send / ipcMain.on | bun.messages | односторонние |
| webContents.send / ipcRenderer.on | webview messages / push | 34 события |
| ipcRenderer.sendSync | нет | startup:theme-cache придётся переделать |
| contextBridge / preload | preload + defineRPC в webview | нет глобального window.electronAPI; вместо этого типизированный rpc |
| sandbox:true | sandbox:true отключает RPC | конфликт, требует решения |

## 9. Матрица замены Electron API

| Electron API | Где в проекте | Замена в Electrobun | Оценка |
|---|---|---|---|
| app (getPath/isPackaged/getVersion/setPath/relaunch/quit/appendSwitch) | paths.ts:14,29-30; runtime.ts:13-17; runtime-paths.ts:45-46; builds/index.ts:379; window.ts:121,128 | Utils.paths / PATHS / Utils.quit; эквивалента relaunch/appendSwitch нет | B/C, UNKNOWN для relaunch |
| BrowserWindow (frameless, min size, webPreferences) | window.ts:24-37 | BrowserWindow options (frame, titleBarStyle, autoResize, rpc) | B |
| Оконные контролы (minimize/maximize/close/restore) | window.ts:131-151; preload.ts:102-105 | нет встроенного; typed RPC + нативные вызовы | C |
| webContents (события, fromId, send, executeJavaScript) | auth.ts:103-107,170-182; window.ts:49-103; mc-server-handlers.ts:39-72; cloud/callback-page.ts:11 | webview-события (on/remove), RPC вместо fromId/executeJavaScript | C |
| dialog.showOpenDialog | builds/index.ts:1111; theme-files.ts:46,88; system.ts:561,572,590 | Utils.openFileDialog (возвращает string[]) | B |
| dialog.showSaveDialog | builds/index.ts:628,739; mc-server-handlers.ts:398; theme-files.ts:56 | **нет** (utils.md:219) | CRITICAL |
| shell (openExternal/openPath/showItemInFolder) | shell:open-* (3 канала) | Utils.openExternal/openPath/showItemInFolder/moveToTrash | B |
| clipboard | clipboard-files.ts:1 | Utils.clipboard (text; image — PNG Uint8Array в TS) | B |
| screen.getAllDisplays | agent-workspace.ts:123-124 | матрица «displays ✓»; нужен API-референс | B/UNKNOWN |
| safeStorage | agent-mcp.ts:27-34; ai-agent.ts:24-35; share/auth.ts:21-48 | **нет** | CRITICAL |
| protocol (registerSchemesAsPrivileged/handle) | avatar.ts:681,706; theme-files.ts:68,70 | views:// и appdata:// (allowedProtocols) | B/C |
| session | реально не используется (совпадения по строке «session server») | Sessions & cookies ✓ | нет работы |
| autoUpdater / electron-updater | updater.ts:20-165 | Electrobun Updater (другая модель) | C |
| nativeImage | worlds.ts:9,170,405,588,636 | работа с PNG через Uint8Array/Utils | B |
| Menu.setApplicationMenu(null) | window.ts:156 | application-menu API (TS) | B |
| Tray / Notification / globalShortcut / powerMonitor / nativeTheme / desktopCapturer | **не используются** (0 обращений) | — | нет работы |
| ipcMain / ipcRenderer / contextBridge | 48 файлов, preload.ts | typed RPC (bun.requests/messages) | A/B |
| MessageChannelMain / utilityProcess | не используются | — | нет работы |
| worker_threads / child_process | builds/scan-worker*, cloud/*, launch-orchestrator.ts:291, minecraft-launch-worker.ts:4 | Bun Worker / node:child_process | D (PoC) |
| webUtils (drop файлов) | preload.ts (file-drop) | UNKNOWN | D |

## 10. Совместимость нативных модулей

| Модуль/механизм | Использование | Риск на Bun | Решение |
|---|---|---|---|
| better-sqlite3 (N-API) | electron/db/*, import/helpers.ts | средний; N-API-пребилд win32-x64 может не грузиться в Bun | PoC; иначе bun:sqlite / node:sqlite, миграции централизованы в electron/db/migrations.ts |
| worker_threads (Worker) | builds/scan-worker-client.ts:11,63; cloud/handlers.ts:6,143 | низкий (Bun поддерживает Worker) | PoC; проверить parentPort/workerData |
| child_process.fork/spawnSync/exec | launch-orchestrator.ts:291; minecraft-launch-worker.ts:4; import/helpers.ts:37; system.ts:276 | низкий (node:child_process в Bun) | PoC запуска Java-клиента |
| net / dgram / WebSocket | xn-connect/relay.ts:2,204,502,565; remote-servers/index.ts | низкий | PoC релея |
| discord-rpc (IPC-транспорт) | discord-rpc.ts:67,226 | высокий | PoC; при провале — вырезать |
| @modelcontextprotocol/sdk stdio | agent-mcp.ts:2-5 | средний | PoC |

Вывод: реально нативный только better-sqlite3; остальное — Node-совместимые API Bun, для которых нужны короткие PoC, а не переписывание.

## 11. Матрица миграции функций приложения

| Функция | Текущая механика | Что нужно в Electrobun | Класс |
|---|---|---|---|
| Список сборок, контент, импорт | fs + БД (builds/*) | как есть (Bun fs) | A |
| Запуск Minecraft (Java) | fork-воркер + spawnSync (minecraft-launch-worker) | Bun Worker / spawn | A/D |
| Серверы MC (создание, fs, игроки) | fs + БД + процессы (mc-server-handlers) | как есть, кроме save-dialog и метрик | A/B |
| Скины и Laby | @xnlc/skins через порты | как есть | A |
| Миры (иконки/датапаки) | fs + nativeImage | обработка PNG вместо nativeImage | A/B |
| Темы, редактор, каталог | fs + БД (theme-*) | как есть; экспорт темы — save-dialog | A/B |
| Авторизация Ely.by/XnSkins/Microsoft | BrowserWindow OAuth + webContents | webview + RPC | C |
| Облако (Drive/Dropbox/OneDrive/Yandex) | воркеры + OAuth-окна | Worker + webview + RPC | A/C |
| Обновление лаунчера | electron-updater | Electrobun Updater + HTTPS-хостинг | C |
| Шаринг (share) и приглашения | БД + safeStorage + xneon:// | хранилище секретов + deep links | C |
| AI-агент и MCP | safeStorage + MCP SDK | хранилище секретов + PoC MCP | C/D |
| Удалённые серверы, xn-connect | net/dgram/WebSocket | PoC релея | A/D |
| Скачивание контента, прогресс | события renderer | messages/push | A |
| Хранение данных (data move, paths) | app.getPath/getVersion | Utils.paths | B |

## 12. Предлагаемая целевая архитектура

Идея: сохранить контракт как единственный источник схемы RPC и свести всё различие к адаптеру рантайма. Тогда переезд main-процесса не тянет за собой renderer.

Слои:

1. **Контракт (без изменений).** packages/xnlc-types/src/ipc-contracts.ts остаётся. Дополнить его 8 «висящими» каналами (window:*, ai:mcp-*) и завести в нём RPC-схему на базе уже существующих типов: bun.requests формируется из IpcInvokeMap, webview-сообщения — из IpcEventMap.
2. **Домен (без изменений).** @xnlc/core, mods, nbt, servers, skins, share, agent, types — как есть. @xnlc/skins уже без Electron.
3. **Адаптер IPC (новый тонкий слой).** Вместо ipc-router.ts (registerIpcHandlers/ctxHandler/rawHandler) — регистратор, который берёт карту «канал → обработчик» и раздаёт её в bun.requests. Тела обработчиков не трогаются; меняются только сигнатуры (было (event, ...args), стало (args)).
4. **Порты платформы (новые).** Единый интерфейс, закрывающий отличающиеся API: Dialogs (open/save), Secrets (safeStorage → OS keychain / пока файловый fallback), Protocols (avatar://, xnl-theme:// → views:// и appdata://), Shell, Clipboard, Screen, WindowControls, Updater, DeepLinks. Сейчас эти вызовы размазаны по файлам; их стоит свести в порты — это выгодно и для Electron-версии.
5. **Транспорт воркеров (новый адаптер).** Обёртка над «запусти фоновую задачу», скрывающая worker_threads/child_process от домена (scan, upload, launch).
6. **Renderer (без изменений по сути).** Вместо window.electronAPI — типизированный rpc из defineRPC; 255 членов electronAPI остаются теми же по семантике.

Структура папок (предложение):

    packages/
      xnlc-types/src/ipc-contracts.ts        # + rpc-schema.ts (схема из типов)
    electron/                                 # (при миграции → src/bun/)
      main/*                                  # остаётся доменными обработчиками
      platform/                               # НОВОЕ: порты платформы
        dialogs.ts secrets.ts protocols.ts shell.ts clipboard.ts
        screen.ts window-controls.ts updater.ts deep-links.ts
      ipc-router.ts                           # → rpc-registry.ts
    src/                                      # renderer (без изменений логики)
    electrobun.config.ts                      # НОВОЕ: сборка/идентификатор/urlSchemes(только mac)
    views/                                    # НОВОЕ: сборка webview (dist → views)

Ключевой принцип: вся разница платформ изолируется в platform/ и в одном регистраторе; домен и renderer остаются нетронутыми.

## 13. Оценка сложности миграции

| # | Область | Сложность | Почему |
|---|---|---|---|
| 1 | IPC-контракт и типизация | LOW | типы framework-agnostic; 292 invoke → bun.requests 1:1 |
| 2 | Preload-мост / contextBridge | LOW | 248 invoke + 3 on → defineRPC |
| 3 | Доменные обработчики (fs/http/sqlite) | LOW | 236 из 300 каналов класса A |
| 4 | XNLC-пакеты | LOW | уже без Electron; skins — через порты |
| 5 | Оконный слой и кастомный titlebar | MEDIUM | frameless есть, драг -webkit-app-region есть, контролы только через RPC |
| 6 | Медиа и иконки (nativeImage, screen) | MEDIUM | замена на PNG-поток/display-API |
| 7 | Custom protocols (avatar://, xnl-theme://) | MEDIUM | views:// и appdata:// дают близкий, но не идентичный путь |
| 8 | Сборка, дистрибуция | HIGH | нет cross-compile; Hutch host-only; иной формат артефактов |
| 9 | Воркеры сканирования/загрузки | MEDIUM | Bun Worker PoC |
| 10 | Хранилище секретов (safeStorage) | HIGH | нет эквивалента; нужен OS keychain |
| 11 | Deep links и single-instance | HIGH | urlSchemes только macOS; single-instance не документирован |
| 12 | Диалог сохранения файла | HIGH | отсутствует в нативных SDK |
| 13 | Обновление приложения | HIGH | другая модель (Electrobun Updater) |
| 14 | Нативная БД (better-sqlite3) | HIGH | Node-API под Bun не подтверждён |
| 15 | Код-подпись и выпуск | CRITICAL | подпись Windows не входит в Hutch; нет cross-compile |
| 16 | MCP stdio, discord-rpc, xn-connect релей | CRITICAL/UNKNOWN | нативные механизмы без подтверждённых аналогов |

## 14. Критические риски и неизвестные

1. **Подпись и распространение Windows** (CRITICAL). Hutch подписывает только macOS (code-signing.md:11), Windows-подпись вне пайплайна, кросс-компиляции нет (compatability.md:22). Windows — основная платформа лаунчера. UNKNOWN: как подписывать и собирать релиз. Проверка: собрать Windows-артефакт через hutch и посмотреть, подписан ли setup.
2. **Диалог сохранения файла** (CRITICAL). В нативных SDK отсутствует (utils.md:219). Ломает экспорт темы (theme-files.ts:56), экспорт сборки (builds/index.ts:628,739), бэкап сервера (mc-server-handlers.ts:398). UNKNOWN: есть ли в TS SDK отдельный save-dialog. Проверка: поиск API диалога сохранения в utils.md/sitemap; прогон на macOS/Windows.
3. **Deep links xneon:// и single-instance** (HIGH). urlSchemes/fileAssociations только macOS (build-configuration.md:155); про single/second instance в документации нет ничего. Ломает приглашения share на Windows. UNKNOWN: как регистрировать схему в Windows. Проверка: запуск двух экземпляров; открытие xneon://share/... в Windows-сборке.
4. **safeStorage** (HIGH). Документация не даёт аналога; в проекте — ключи AI (ai-agent.ts), MCP (agent-mcp.ts), учётные данные share (share/auth.ts). UNKNOWN: чем шифровать. Проверка: доступен ли OS keychain и Bun (bun:ffi / нативный модуль).
5. **Модель обновления** (HIGH). electron-updater (каналы stable/beta, checkForUpdates/downloadUpdate/quitAndInstall, updater.ts) заменяется на Electrobun Updater с HTTPS-хостингом манифестов и своим форматом патчей. Логика каналов и прогресса (update:status/update:progress) — с нуля.
6. **better-sqlite3 под Bun** (HIGH/UNKNOWN). От SQLite зависят аккаунты, сборки, настройки, импорт Modrinth App. UNKNOWN: грузится ли N-API-пребилд в Bun. Проверка: PoC — открыть существующую data.db, прогнать миграции.
7. **sandbox vs RPC** (MEDIUM). Текущее окно sandbox:true (window.ts:24-37), а в Electrobun sandbox:true отключает RPC. Придётся пересмотреть модель безопасности окна.
8. **Синхронный снапшот темы** (MEDIUM). startup:theme-cache работает через sendSync (preload.ts:99), синхронного RPC нет. Нужно применять тему до первого кадра через HTML/показ окна.
9. **Бинарные/крупные payload'ы** (MEDIUM/UNKNOWN). Стримы логов, download-progress, ai:stream-chunk через RPC — лимиты батчей и поведение под нагрузкой не документированы. Проверка: нагрузочный тест getHostMessageQueueStats.
10. **MCP stdio, discord-rpc, xn-connect dgram/net** (UNKNOWN). Три независимых нативных механизма; у каждого нужен отдельный PoC.

## 15. Рекомендуемая последовательность миграции

Порядок построен так, чтобы каждый шаг был обратим и не блокировал выпуск.

1. **Ревизия контракта.** Завести в ipc-contracts.ts 8 недостающих каналов (window:*, ai:mcp-*), описать update:channel-changed, зафиксировать статус startup:theme-cache. Полезно и без миграции.
2. **Слой портов платформы (в текущем Electron).** Вынести dialog/shell/clipboard/screen/nativeImage/safeStorage/protocol/updater/deep-links в порты. Это снижает связность сейчас и делает замену рантайма механической потом.
3. **PoC-пакет (1 неделя, без изменения основного приложения).** На Electrobun: (a) typed RPC на 2–3 реальных каналах; (b) better-sqlite3 под Bun; (c) Worker/child_process (скан + запуск Java); (d) safeStorage-эквивалент; (e) save-dialog; (f) single-instance + xneon:// на Windows; (g) подпись/сборка Windows. Это и есть решение «идём/не идём».
4. **Пилотный домен.** Наиболее изолированный — скины/Laby (@xnlc/skins, 15 каналов) плюс, например, mods (17 каналов). Портируется дёшево и проверяет RPC на реальной нагрузке.
5. **Перенос main-процесса по модулям** A → B → C, начиная с самых автономных (mods, servers, stats, storage, quick-play, authlib, skins, лаунчер/импорт). После этого — UI-слой (window, диалоги, протоколы).
6. **Последними** — updater, deep links, secrets, MCP/discord/relay: только после успешных PoC и после того, как Electrobun закроет пробелы (см. §16).
7. **Дистрибуция и подпись** — отдельный поток работ, не привязанный к порту логики.

Ориентир: шаги 1–2 дают эффект сразу; шаг 3 определяет решение; 4–5 — реальный порт; 6–7 — то, что сегодня блокирует релиз на Electrobun.

## 16. Финальная рекомендация

**Частичная миграция / сохранить Electron с переоценкой.** Полную миграцию на Electrobun сейчас начинать не стоит.

За миграцию: IPC-слой, домен и XNLC-пакеты переносятся дёшево (78.7% обработчиков — класс A), контракт уже сейчас фактически RPC-схема, а Electrobun даёт типизированный RPC, меньший рантайм и Bun-совместимость.

Против сейчас: четыре из пяти опор распространения на Windows отсутствуют или недоступны — подпись Windows (не входит в Hutch), save-dialog, deep links xneon:// на Windows, единый экземпляр, плюс нет эквивалента safeStorage и другая модель обновления. Это не детали реализации, а пробелы платформы Electrobun, и закрывать их внутри лаунчера — дороже, чем получить от самого фреймворка.

Практический план:

- Немедленно и независимо от миграции: п.1 и п.2 из §15 (ревизия контракта + порты платформы). Это уменьшает связность и снижает цену любого будущего переезда.
- Затем: ограниченный PoC (п.3). Если PoC закрывает подпись Windows, save-dialog и deep links/single-instance — переходить к пилотному домену (п.4) и дальше. Если нет — не форкать платформенные подсистемы, а оставить Electron и вернуться к вопросу, когда Electrobun реализует Windows-схемы URL и подпись Windows.
- Не начинать с updater, secrets, MCP/discord/relay: у них нет подтверждённых аналогов, и ранний вход в эти подсистемы заблокирует прогресс.

## Сводка чисел (для быстрой сверки)

- Всего каналов-обработчиков зарегистрировано в коде: **300** (292 объявленных invoke + 8 вне контракта).
- Объявлено в контракте: **292** invoke, **34** события, всего **326**.
- Классы миграции: A = 236, B = 26, C = 31, D = 7 (сумма 300).
- Файлов main, импортирующих electron: **48**.
- Обращений renderer к electronAPI: **528**, уникальных членов: **255**, файлов: **269**.
- Неиспользуемые Electron-подсистемы (Tray, Notification, globalShortcut, powerMonitor, nativeTheme, desktopCapturer, utilityProcess, MessageChannelMain): **8** — работы не требуют.
- Несовместимые/критичные зависимости: **5**; требующие PoC: **2**.

