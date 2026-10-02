// ============================================================
// Mods IPC Handlers — Unified Modrinth + CurseForge via @xnlc/mods
// Author: MAINER4IK
// ============================================================

import { ipcMain } from "electron"
import path from "path"
import { getBuildIntentPath } from "./builds/helpers"
import { checkLoaderRequirements, type LoaderRequirementReport } from "./mods-loader-requirements"
import { inspectJarDependencies, type JarDependencyInspection } from "./mods-jar-deps"
import type {
  ContentType,
  ModDetails,
  ModDependency,
  ModLoaderFilter,
  ModSearchResponse,
  ModSort,
  ModVersion,
  ModEnvironment,
} from "@xnlc/mods" with { "resolution-mode": "import" }
import type * as ModsApi from "@xnlc/mods" with { "resolution-mode": "import" }

export type { ModSearchResponse, ModDetails, ModVersion, ModDependency }

type ModsModule = typeof ModsApi

let modsModulePromise: Promise<ModsModule> | null = null

function loadModsModule(): Promise<ModsModule> {
  if (!modsModulePromise) {
    modsModulePromise = import("@xnlc/mods").then(async (mods) => {
      // Каталог FTB — это ~90 запросов манифестов, поэтому кэшируем его и на диске:
      // иначе после каждого перезапуска лаунчера вкладка FTB ждала бы загрузку заново.
      try {
        const { app } = await import("electron")
        mods.setFtbCatalogCacheFile(path.join(app.getPath("userData"), "ftb-catalog.json"))
      } catch {
        // кэш не критичен
      }
      return mods
    })
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
      environment?: ModEnvironment,
    ): Promise<ModSearchResponse> => {
      try {
        const mods = await loadModsModule()
        return await mods.modrinthSearch(query, { contentType: contentType ?? "mod", gameVersion, modLoader, categories, sortBy, page, environment }) as ModSearchResponse
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
      environment?: ModEnvironment,
    ): Promise<ModSearchResponse> => {
      try {
        const mods = await loadModsModule()
        return await mods.curseforgeSearch(query, { contentType: contentType ?? "mod", gameVersion, modLoader, categories, sortBy, page, environment }) as ModSearchResponse
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
    "mods:curseforge-changelog",
    async (_event, modId: number, fileId: number): Promise<string> => {
      const mods = await loadModsModule()
      return await mods.curseforgeGetChangelog(modId, fileId)
    },
  )



  // ── FTB (Feed The Beast) ──────────────────────────────────
  ipcMain.handle(
    "mods:ftb-search",
    async (
      event,
      query: string,
      page?: number,
      options?: { sortBy?: string; categories?: string[]; gameVersion?: string; loader?: string },
    ): Promise<ModSearchResponse> => {
      try {
        const mods = await loadModsModule()
        return await mods.ftbSearch(query, {
          page: page ?? 0,
          sortBy: options?.sortBy as never,
          categories: options?.categories,
          gameVersion: options?.gameVersion,
          loader: options?.loader,
        }) as ModSearchResponse
      } catch (err) {
        console.error("FTB search error:", err)
        return { results: [], totalCount: 0 }
      }
    },
  )

  ipcMain.handle(
    "mods:ftb-catalog-facets",
    async (): Promise<{ categories: string[]; gameVersions: string[]; loaders: string[] }> => {
      try {
        const mods = await loadModsModule()
        return await mods.ftbCatalogFacets() as { categories: string[]; gameVersions: string[]; loaders: string[] }
      } catch (err) {
        console.error("FTB facets error:", err)
        return { categories: [], gameVersions: [], loaders: [] }
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
  // CurseForge/Modrinth заполняют `dependencies` не у всех файлов: у jei под 26.2
  // оба API отдают пустой список. Тогда читаем метаданные самого jar.
  ipcMain.handle(
    "mods:inspect-jar-dependencies",
    async (_event, url: string, source: "modrinth" | "curseforge"): Promise<JarDependencyInspection> => {
      try {
        return await inspectJarDependencies(url, source)
      } catch (err) {
        console.error("[mods] Jar dependency inspection failed:", err)
        return { modId: null, dependencies: [], declared: [] }
      }
    },
  )

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

  // ── Требования модов сборки к версии загрузчика ───────────
  ipcMain.handle(
    "mods:check-loader-requirements",
    async (_event, buildName: string, modLoader?: string, loaderVersion?: string): Promise<LoaderRequirementReport> => {
      try {
        const modsDir = path.join(getBuildIntentPath(buildName), "mods")
        return await checkLoaderRequirements(modsDir, modLoader, loaderVersion)
      } catch (err) {
        console.error("Loader requirement check error:", err)
        return { loaderId: modLoader ?? "", loaderVersion, checked: 0, issues: [] }
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


}
