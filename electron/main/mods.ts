// ============================================================
// Mods IPC Handlers — Unified Modrinth + CurseForge via @xnlc/mods
// Author: MAINER4IK
// ============================================================

import { ipcMain } from "electron"
import type {
  ContentType,
  ModDetails,
  ModDependency,
  ModLoaderFilter,
  ModSearchResponse,
  ModSort,
  ModVersion,
} from "@xnlc/mods" with { "resolution-mode": "import" }
import type * as ModsApi from "@xnlc/mods" with { "resolution-mode": "import" }

export type { ModSearchResponse, ModDetails, ModVersion, ModDependency }

type ModsModule = typeof ModsApi

let modsModulePromise: Promise<ModsModule> | null = null

function loadModsModule(): Promise<ModsModule> {
  if (!modsModulePromise) {
    modsModulePromise = import("@xnlc/mods")
  }
  return modsModulePromise
}

async function fetchMrProjectInfo(projectId: string): Promise<{ name: string; iconUrl: string; slug: string } | null> {
  try {
    const mods = await loadModsModule()
    return await mods.modrinthGetProjectInfo(projectId)
  } catch {
    return null
  }
}

async function fetchCfProjectInfo(modId: string): Promise<{ name: string; iconUrl: string; slug: string } | null> {
  try {
    const mods = await loadModsModule()
    return await mods.curseforgeGetProjectInfo(modId)
  } catch {
    return null
  }
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
      modLoader?: ModLoaderFilter,
      sortBy?: ModSort,
      page?: number,
      category?: string,
    ): Promise<ModSearchResponse> => {
      try {
        const mods = await loadModsModule()
        return await mods.modrinthSearch(query, { contentType, gameVersion, modLoader, category, sortBy, page }) as ModSearchResponse
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

  ipcMain.handle(
    "mods:modrinth-categories",
    async (_event, contentType?: ContentType): Promise<Array<{ slug: string; name: string }>> => {
      const mods = await loadModsModule()
      return await mods.modrinthCategories({ contentType })
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
      category?: string,
    ): Promise<ModSearchResponse> => {
      try {
        const mods = await loadModsModule()
        return await mods.curseforgeSearch(query, { contentType, gameVersion, modLoader, category, sortBy, page }) as ModSearchResponse
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
    async (_event, contentType?: ContentType): Promise<Array<{ id: number; slug: string; name: string }>> => {
      const mods = await loadModsModule()
      return await mods.curseforgeCategories(contentType)
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

  // ── Dependency Resolution ──────────────────────────────────
  ipcMain.handle(
    "mods:resolve-dependencies",
    async (_event, version: ModVersion, source: "modrinth" | "curseforge"): Promise<ModDependency[]> => {
      try {
        const deps = version.dependencies ?? []
        const enriched = await Promise.all(deps.map(async (dep) => {
          if (dep.dependencyType === "incompatible") return null
          if (dep.dependencyType === "embedded") {
            return { ...dep, name: dep.fileName ?? "Embedded library" } as ModDependency
          }
          const info = source === "modrinth"
            ? await fetchMrProjectInfo(dep.projectId)
            : await fetchCfProjectInfo(dep.projectId)
          if (!info) return null
          return {
            ...dep,
            name: info.name,
            slug: info.slug,
            iconUrl: info.iconUrl,
          } as ModDependency
        }))
        return enriched.filter(Boolean) as ModDependency[]
      } catch (err) {
        console.error("Dependency resolution error:", err)
        return []
      }
    },
  )
}
