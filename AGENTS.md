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
