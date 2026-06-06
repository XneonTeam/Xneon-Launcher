# AGENTS.md

This file provides guidance to agents when working with code in this repository.

## Build & Run
- `npm run dev` — starts Vite + Electron concurrently (renderer on :5173, then Electron main)
- `npm run build` — builds both renderer (`vite build`) and electron main (`tsc -p tsconfig.node.json`)
- `npm run package` — builds + electron-builder (output to `release/`)
- No test framework; only `npm run test:xn-auth` (manual script)

## Architecture (Non-Obvious)
- **Two separate TS compilations**: renderer via Vite (`tsconfig.json`), electron main via tsc (`tsconfig.node.json` → `dist-electron/`)
- **`@/*` path alias maps to project root `.`**, NOT `src/` — so imports use `@/components/`, `@/src/`, `@/lib/`, `@/electron/`
- **Types are triple-defined** in `electron/preload.ts`, `src/electron.d.ts`, and `electron/db.ts` — changes to IPC types must update all three
- **Local packages** `@xnlc/core` and `@xnlc/mods` in `packages/` are listed as dependencies but loaded lazily via dynamic `import()` in electron main process
- **Minecraft launch runs in a forked worker** (`electron/main/minecraft-launch-worker.ts`), not the main process
- **i18n default/fallback language is Russian** (`ru`), not English — configured in `src/i18n/index.ts`
- **`strict: false`** in both tsconfigs — no strict null checks, no strict function types
- **`components.json` has `rsc: true`** but this is NOT a Next.js app — it's an Electron app (shadcn/ui config artifact)
- **`components.json` says `iconLibrary: "lucide"`** but project actually uses `@tabler/icons-react`
- **Frameless window** with custom title bar (`src/TitleBar.tsx`); `devTools: false` in production
- **Data directory** varies by OS: Win=`%APPDATA%/xneonlauncher`, macOS=`~/Library/Application Support/xneonlauncher`, Linux=`~/.xneonlauncher`

## Anchored Summary (Session: Landing Page KLauncher-style)
- **New project**: `D:\xn-important\launcher.xneon.org` — Next.js 16 + Tailwind v4 landing page `launcher.xneon.org`, matching KLauncher's HTML structure exactly.
- **Goal**: Make landing page visually identical to KLauncher (orange `#f90` theme, 3 feature sections left/right, header with download/login buttons, footer menu grid) with fully working demo tabs matching real Xneon-Launcher components.
- **All components rewritten**: Navbar, Hero, Features, Screenshot, Download, Footer — all matching KLauncher structure.
- **All 8 demo tabs (`src/launcher-demo/`) rewritten** to match real code from `Xneon-Launcher/src/components/launcher/`:
  - **Сборки**: grid cards with gradient icons, Modrinth/CurseForge badges, loader dot, version; Мои сборки / Modrinth / CurseForge toggle header. Modal with 4 tabs (Description, Gallery, Changelog, Versions). Fetches real data from Modrinth API and CurseForge API (via proxy route).
  - **Логи**: filterable list with OK/Cancel/level highlighting.
  - **Моды**: content type tabs (моды/модпаки/ресурспаки/шейдеры), Modrinth/CurseForge toggle, search, sort, version/loader filters, cards with icon/categories/downloads.
  - **Серверы**: ServerCard with MOTD rendering (JSON chat format + section codes), server icon, status (green/yellow/red by latency), favorite star, Connect/Delete buttons, search via HotMC API (`hotmc-parser.vercel.app`), status via `mcskinapi-three.vercel.app`, add server modal.
  - **Облако**: login modal, upload modal (build/account), filter (all/builds/accounts), file list with icons/sizes/dates, download/delete buttons, storage progress bar.
  - **Аккаунты**: avatar cards, Microsoft/Offline type badges, active status.
  - **Настройки**: 5 tabs (Game/Java/Themes/Language/About), Java tab with auto-version select + JVM args, themes with SVG previews, Language tab with flag SVGs + checkmark on selected, About tab with GitHub/Discord social cards + developer info.
- **`tabler-icons.d.ts`** created manually with all used icon declarations.
- **Build passes** (`npm run build`) — no TS or build errors.
- **All done** — no pending items.
