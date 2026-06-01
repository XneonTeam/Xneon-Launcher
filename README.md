# xneon-launcher

Minecraft launcher built with Electron + Vite + React.

## Tech stack
- Electron 35 (main process in `electron/`, forked worker for launching)
- Vite 6 + React 19 (renderer in `src/`)
- shadcn/ui + Tailwind 4 + Radix UI
- Local `@xnlc/core` package in `packages/xnlc-core/` (loaded lazily)
- Local `@xnlc/mods` package in `packages/xnlc-mods/`

## Quick start
```bash
npm install
npm run dev          # Vite + Electron
npm run build        # production build
npm run package      # electron-builder → release/
```

See `AGENTS.md` for architecture details.
