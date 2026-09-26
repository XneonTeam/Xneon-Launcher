# AGENTS.md — Xneon Launcher

## Language

Always respond to the user in Russian.
All explanations, plans, analysis, descriptions of changes, and comments — write in Russian.
Code, function names, API, terminal commands, and error messages — keep in the original language.

## Project

Xneon Launcher — Electron + React 19 Minecraft launcher.
- **Renderer** (React): `components/`, `src/`, `lib/`
- **Electron main**: `electron/main/`, `electron/preload.ts`
- **Local packages** (`packages/`): `@xnlc/core`, `@xnlc/mods`, `@xnlc/types`, `@xnlc/nbt`, `@xnlc/servers`, `@xnlc/skins` — linked via pnpm workspace (`workspace:*` in `package.json`). Registry fallback at `https://git.xneon.org/api/packages/MAINER4IK/npm/`
- **IPC contracts**: `packages/xnlc-types/src/ipc-contracts.ts` — single source of truth for channel signatures
- **Launch params**: `packages/xnlc-types/src/launch-types.ts` — `MinecraftLaunchParams`

## Commands

```bash
pnpm run dev          # Vite + Electron dev (hot-reload)
pnpm run build        # production build (vite + tsc)
pnpm run package      # build + electron-builder → release/
pnpm run typecheck    # tsc --noEmit (renderer tsconfig)
pnpm run sync:xnlc    # build & symlink local @xnlc/* packages into node_modules
pnpm run test:skins   # тесты домена скинов (нужен собранный @xnlc/skins)
```

No lint scripts exist. `pnpm run build` is the primary verification.

## Build pipeline

`predev`, `prebuild`, `prepackage` all run `scripts/gen-credentials.mjs` which reads `.env` and generates `electron/main/cloud/credentials.generated.ts`. This file is gitignored — without `.env`, cloud features won't compile, but the build still succeeds (empty creds).

`build:renderer` = `vite build` → `dist/`
`build:electron` = `tsc -p tsconfig.node.json` → `dist-electron/`

## Key architecture notes

- **Vite `base: './'`** — all asset paths in HTML must be relative (`./path`), not absolute (`/path`). Absolute paths break in the packaged Electron app (asar).
- **`@/*` alias** resolves to project root: `@/src` → `src/`, `@/components` → `components/`.
- **IPC**: preload exposes `window.electronAPI` methods. Types in `src/electron.d.ts`. Adding a new IPC channel requires updating: handler in `electron/main/`, preload bridge in `electron/preload.ts`, type in `src/electron.d.ts`, and contract in `packages/xnlc-types/src/ipc-contracts.ts`.
- **Server data**: `servers.dat` uses raw NBT via `@xnlc/nbt` — **no** `{ compressed: "gzip" }` on read/write. `level.dat` **requires** `{ compressed: "gzip" }`.
- **Minecraft launch**: `electron/main/minecraft-launch-worker.ts` runs in a forked worker. `--quickPlayMultiplayer ip:port` is used for server connect (not `--server`/`--port`).
- **Build intent dirs**: `getBuildIntentPath(buildName)` → `%APPDATA%/xneonlauncher/intents/<sanitized-name>/` — isolates each build's `.minecraft`.
- **Accounts**: `src/AccountsContext.tsx` provides `activeAccount`, `accounts`.
- **Скины**: одна вкладка `skins` в сайдбаре с двумя разделами — «Избранное» (`components/launcher/skins/`, локальные сохранённые скины) и «Библиотека» (`components/launcher/laby/`, каталог Laby). **Вся доменная логика — в `@xnlc/skins`** (`packages/xnlc-skins`): каталог Laby, «Избранное», локальные скины, надевание/сброс, кэш. Пакет не знает ни про Electron, ни про SQLite, ни про файлы: выход наружу описан портами (`SkinDiskCache`, `SkinLibraryStore`, `SkinAccountPort`), а их реализации — в `electron/main/skins/ports.ts` (база, `<data>/skins`, `<data>/cache/laby`, токены Microsoft). IPC-слой — тонкий: `electron/main/skins/index.ts` только приводит аргументы и зовёт домен. Каталог ходит в открытый API Laby (`https://laby.net/api/v3`, без ключа) через main, т.к. CORS-заголовков API не отдаёт; текстуры и рендеры, наоборот, берутся напрямую с CDN (`texture.laby.net/{hash}.png`, `laby.net/api/v3/render/skin/{hash}.png`) — они разрешают кросс-доменные запросы. Типы, пересекающие границу main ↔ renderer, лежат в `packages/xnlc-types/src/laby.ts` (только типы, без логики). Связь «Избранного» с каталогом — `skin_library.sourceId` (`laby:<hash>`; старые записи Craftdex — голый UUID), помощники — `labySourceId`/`labyHashFromSourceId`. Тесты: `pnpm run test:skins`.
- **Laby: что защищено и чем заменено.** `/api/v3/user/{uuid}/profile` и `/api/search/names/{query}` отдают **428 Challenge token required** — обходить нельзя. Поэтому: ник ищется точно через `/user/{ник}/uniqueId`, история скинов берётся из `/user/{uuid}/textures` (не защищён, данные те же), аватарка — `laby.net/texture/profile/head/{uuid}.png?size=64`. Поиска по частичному нику нет и подсказок при вводе быть не может.
- **Laby: фильтр по тегу и конец выдачи.** Каталог (`/search/textures/skin`) серверную фильтрацию не поддерживает: `search`/`tag`/`tags`/`tag_ids`/`q` игнорируются. Единственная настоящая серверная фильтрация — `/api/v3/tag/{id}?size&offset`: она отдаёт скины одного тега и листается до конца (у крупных тегов это десятки страниц). Поэтому `LabyCatalog.page()` работает в трёх режимах: без фильтров — лента, ровно один тег без текста — серверная пагинация по тегу, несколько тегов и/или текст — локальный фильтр по пулу (до 5 страниц × 100, пулы ограничены 16 штуками по LRU). Ответ `/tag/{id}` беднее поиска: в нём нет строки `tags`, поэтому тег проставляет `mapLabyTagSkin`, а текстовый поиск внутри тег-выдачи невозможен — при тексте пул снова берётся из общей ленты. За концом выдачи Laby отвечает **403** (не пустым массивом): это штатный конец списка, а не блокировка — `LabyCatalog` превращает его в `endOfFeed`, чтобы UI не показывал ошибку доступа.
- **Скины: кэш.** Один `SkinCache` на каталог вместо прежних трёх: память (TTL, не больше 256 записей) плюс диск через порт (последнее удачное значение для офлайна, текстуры — по неизменному `image_hash`). Пустые результаты поиска в кэш не пишутся.
- **Language**: all user-facing strings go through `react-i18next` (`src/i18n/`), not hardcoded.

## Common pitfalls

- Running `pnpm run package` fails with `EPERM` on `dxil.dll` if a previous Electron process is still running — kill it first.
- After adding/editing IPC channels, run `pnpm run build` (not just `dev`) to catch type errors across both tsconfigs.
- `multimc.svg` and `polymc.svg` icons don't exist in `public/launcher-icons/` — only `.png` variants are available.
- `better-sqlite3` (Node-API, v13) — единственная SQLite-реализация в проекте: и `data.db` лаунчера (`electron/db/`), и чтение Modrinth App `app.db` (`electron/main/import/helpers.ts`). Таблица в Modrinth App — `instances` joined with `instance_content_sets`, **не** `profiles`. Соединение живёт только в main-процессе (в renderer не отдаётся), схема и миграции — `electron/db/migrations.ts`, WAL/prepared statements/транзакции — `electron/db/core.ts`. Пакет ставится без `node-gyp`: в нём уже лежат Node-API prebuilds (`prebuilds/win32-x64.node`), поэтому `electron-rebuild` не нужен.
- **Колоночные миграции применяются только при `currentVersion < SCHEMA_VERSION`** (`electron/db/migrations.ts`). Добавили `addColumnIfMissing` — поднимите `SCHEMA_VERSION`, иначе на существующей БД колонка не появится вовсе, а запросы с ней упадут с `no such column`.
- `prismarine-nbt` was replaced by `@xnlc/nbt` — do not re-add prismarine-nbt.

## Package manager

This project uses **pnpm** (v11+). Configuration lives in:
- `pnpm-workspace.yaml` — workspace packages, overrides, allowBuilds, security settings
- `.npmrc` — auth/registry settings only (pnpm 11 ignores non-auth settings here)
- `package.json` — dependencies use `workspace:*` for local `@xnlc/*` packages
