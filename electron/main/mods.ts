// ============================================================
// Mods IPC Handlers — Unified Modrinth + CurseForge via @xnlc/mods
// Author: MAINER4IK
// ============================================================

import { ipcMain } from "electron"
import type {
  ContentType,
  ModDetails,
  ModSearchResponse,
  ModSort,
  ModVersion,
} from "@xnlc/mods" with { "resolution-mode": "import" }
import type * as ModsApi from "@xnlc/mods" with { "resolution-mode": "import" }

export type { ModSearchResponse, ModDetails, ModVersion }

type ModsModule = typeof ModsApi

let modsModulePromise: Promise<ModsModule> | null = null

function loadModsModule(): Promise<ModsModule> {
  if (!modsModulePromise) {
    modsModulePromise = import("@xnlc/mods")
  }
  return modsModulePromise
}

export function registerModsHandlers(): void {
  // ── Modrinth ──────────────────────────────────────────────
  ipcMain.handle(
    "mods:modrinth-search",
    async (
      _event,
      query: string,
      contentType?: ContentType,
      gameVersion?: string,
      sortBy?: ModSort,
      page?: number,
    ): Promise<ModSearchResponse> => {
      try {
        const mods = await loadModsModule()
        return await mods.modrinthSearch(query, { contentType, gameVersion, sortBy, page }) as ModSearchResponse
      } catch (err) {
        console.error("Modrinth search error:", err)
        return { results: [], totalCount: 0 }
      }
    },
  )

  ipcMain.handle(
    "mods:modrinth-details",
    async (_event, slug: string): Promise<ModDetails | null> => {
      const mods = await loadModsModule()
      return await mods.modrinthGetDetails(slug) as ModDetails | null
    },
  )

  ipcMain.handle(
    "mods:modrinth-versions",
    async (_event, slug: string): Promise<ModVersion[]> => {
      const mods = await loadModsModule()
      return await mods.modrinthGetVersions(slug) as ModVersion[]
    },
  )

  // ── CurseForge ────────────────────────────────────────────
  ipcMain.handle(
    "mods:curseforge-search",
    async (
      _event,
      query: string,
      contentType?: ContentType,
      gameVersion?: string,
      modLoader?: string,
      sortBy?: ModSort,
      page?: number,
    ): Promise<ModSearchResponse> => {
      try {
        const mods = await loadModsModule()
        return await mods.curseforgeSearch(query, { contentType, gameVersion, modLoader, sortBy, page }) as ModSearchResponse
      } catch (err) {
        console.error("CF search error:", err)
        return { results: [], totalCount: 0 }
      }
    },
  )

  ipcMain.handle(
    "mods:curseforge-details",
    async (_event, modId: number): Promise<ModDetails | null> => {
      const mods = await loadModsModule()
      return await mods.curseforgeGetDetails(modId) as ModDetails | null
    },
  )

  ipcMain.handle(
    "mods:curseforge-download-url",
    async (_event, fileId: number, modId: number): Promise<string | null> => {
      const mods = await loadModsModule()
      return await mods.curseforgeGetFileDownloadUrl(fileId, modId)
    },
  )

  ipcMain.handle(
    "mods:curseforge-categories",
    async (): Promise<Array<{ id: number; slug: string; name: string }>> => {
      const mods = await loadModsModule()
      return await mods.curseforgeCategories()
    },
  )

  ipcMain.handle(
    "mods:curseforge-featured",
    async (
      _event,
      gameVersion?: string,
    ): Promise<{ popular: ModSearchResponse["results"]; trending: ModSearchResponse["results"] }> => {
      const mods = await loadModsModule()
      return await mods.curseforgeFeatured(gameVersion) as { popular: ModSearchResponse["results"]; trending: ModSearchResponse["results"] }
    },
  )
}
