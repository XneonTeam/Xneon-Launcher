# AGENTS.md — Xneon Launcher

## Language

Always respond to the user in Russian.
All explanations, plans, analysis, descriptions of changes, and comments — write in Russian.
Code, function names, API, terminal commands, and error messages — keep in the original language.

## Project

Xneon Launcher — Electron + React 19 Minecraft launcher.
- **Renderer** (React): `components/`, `src/`, `lib/`
- **Electron main**: `electron/main/`, `electron/preload.ts`
- **Local packages** (`packages/`): `@xnlc/core`, `@xnlc/mods`, `@xnlc/types`, `@xnlc/p2p` — hosted at `https://git.xneon.org/api/packages/MAINER4IK/npm/` (see `.npmrc`)
- **IPC contracts**: `packages/xnlc-types/src/ipc-contracts.ts` — single source of truth for channel signatures
- **Launch params**: `packages/xnlc-types/src/launch-types.ts` — `MinecraftLaunchParams`

## Commands

```bash
npm run dev          # Vite + Electron dev (hot-reload)
npm run build        # production build (vite + tsc)
npm run package      # build + electron-builder → release/
npm run typecheck    # tsc --noEmit (renderer tsconfig)
```

No lint/test scripts exist. `npm run build` is the primary verification.

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
- **Language**: all user-facing strings go through `react-i18next` (`src/i18n/`), not hardcoded.

## Common pitfalls

- Running `npm run package` fails with `EPERM` on `dxil.dll` if a previous Electron process is still running — kill it first.
- After adding/editing IPC channels, run `npm run build` (not just `dev`) to catch type errors across both tsconfigs.
- `multimc.svg` and `polymc.svg` icons don't exist in `public/launcher-icons/` — only `.png` variants are available.
- `sql.js` is used (not better-sqlite3) for reading Modrinth App's `app.db` — table is `instances` joined with `instance_content_sets`, not `profiles`.
- `prismarine-nbt` was replaced by `@xnlc/nbt` — do not re-add prismarine-nbt.
