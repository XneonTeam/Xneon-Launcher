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
      categories?: string[],
    ): Promise<ModSearchResponse> => {
      try {
        const mods = await loadModsModule()
        return await mods.modrinthSearch(query, { contentType: contentType ?? "mod", gameVersion, modLoader, categories, sortBy, page }) as ModSearchResponse
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
      categories?: string[],
    ): Promise<ModSearchResponse> => {
      try {
        const mods = await loadModsModule()
        return await mods.curseforgeSearch(query, { contentType: contentType ?? "mod", gameVersion, modLoader, categories, sortBy, page }) as ModSearchResponse
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
    "mods:curseforge-featured",
    async (
      _event,
      gameVersion?: string,
    ): Promise<{ popular: ModSearchResponse["results"]; trending: ModSearchResponse["results"] }> => {
      const mods = await loadModsModule()
      return await mods.curseforgeFeatured(gameVersion) as { popular: ModSearchResponse["results"]; trending: ModSearchResponse["results"] }
    },
  )

  // ── FTB (Feed The Beast) ──────────────────────────────────
  ipcMain.handle(
    "mods:ftb-search",
    async (event, query: string, page?: number): Promise<ModSearchResponse> => {
      try {
        const mods = await loadModsModule()
        return await mods.ftbSearch(query, { page: page ?? 0 }) as ModSearchResponse
      } catch (err) {
        console.error("FTB search error:", err)
        return { results: [], totalCount: 0 }
      }
    },
  )

  ipcMain.handle(
    "mods:ftb-details",
    async (event, id: number): Promise<ModDetails | null> => {
      try {
        const mods = await loadModsModule()
        return await mods.ftbGetDetails(id) as ModDetails | null
      } catch (err) {
        console.error("FTB details error:", err)
        return null
      }
    },
  )

  ipcMain.handle(
    "mods:ftb-version",
    async (event, id: number, versionId: number): Promise<unknown | null> => {
      try {
        const mods = await loadModsModule()
        return await mods.ftbGetModpackVersion(id, versionId)
      } catch (err) {
        console.error("FTB version error:", err)
        return null
      }
    },
  )

  ipcMain.handle(
    "mods:ftb-changelog",
    async (event, id: number, versionId: number): Promise<string> => {
      try {
        const mods = await loadModsModule()
        return await mods.ftbGetModpackChangelog(id, versionId)
      } catch {
        return ""
      }
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

  // ── Categories & Tags ────────────────────────────────────
  ipcMain.handle("mods:modrinth-categories", async (): Promise<any[]> => {
    try {
      const mods = await loadModsModule()
      const cats = await mods.modrinthGetCategories()
      console.log(`[mods] Loaded ${cats.length} Modrinth categories`)
      return cats
    } catch (err) {
      console.error("[mods] Failed to load Modrinth categories:", err)
      return []
    }
  })

  ipcMain.handle("mods:curseforge-categories", async (): Promise<any[]> => {
    try {
      const mods = await loadModsModule()
      const cats = await mods.curseforgeGetCategories()
      console.log(`[mods] Loaded ${cats.length} CurseForge categories`)
      return cats
    } catch (err) {
      console.error("[mods] Failed to load CurseForge categories:", err)
      return []
    }
  })

  ipcMain.handle("mods:modrinth-loaders", async (): Promise<string[]> => {
    try {
      const mods = await loadModsModule()
      return await mods.modrinthGetLoaders()
    } catch {
      return []
    }
  })

  ipcMain.handle("mods:modrinth-game-versions", async (): Promise<string[]> => {
    try {
      const mods = await loadModsModule()
      return await mods.modrinthGetGameVersions()
    } catch {
      return []
    }
  })
}
