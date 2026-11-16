import { ArchiveContext } from "@xnlc/parser"
import type { ModpackImportResult } from "@xnlc/types"
import { isGameDirActive } from "../minecraft-core"
import { logRuntime } from "../runtime"
import { getBuildIntentPath, loadModsModule, sendImportProgress } from "./helpers"
import { collectMissingFiles, downloadMissingModFiles, readMissingModsConfig } from "./missing-mods"
import { stageModpackInstall } from "./modpack-install"
import { getMainTranslator, type RuntimeTranslator } from "../i18n"
import { opFailure } from "../errors"
import type { DbBuild } from "@xnlc/types"
import type { ScannedBuildContent } from "./helpers"

type PackMetadata = Pick<DbBuild, "version" | "modLoader" | "loaderVersion"> & Partial<Pick<DbBuild, "source" | "projectSlug" | "modId" | "fileId" | "modpackVersion" | "modpackVersionId">>

export function updateMetadata(buildId: string | undefined, fields: PackMetadata) {
  return buildId ? { buildId, fields: (content: ScannedBuildContent): Record<string, unknown> => ({
    ...fields, customVersionPath: undefined, ...content,
    modsCount: content.mods.length, resourcepacksCount: content.resourcepacks.length, shadersCount: content.shaders.length,
  }) } : undefined
}

export function modpackFailure(error: unknown, t: RuntimeTranslator): { success: false; error: string } {
  if (error && typeof error === "object" && "code" in error && error.code === "UNMANAGED_MOD_CONFLICT") {
    return { success: false, error: t("runtime.import.unmanaged", { file: "file" in error ? String(error.file) : "JAR" }) }
  }
  return opFailure(error)
}

export async function readPackIndexes(input: string | Uint8Array, signal: AbortSignal): Promise<{ modrinth?: string; curseforge?: string }> {
  const archive = await ArchiveContext.open(input, { signal })
  try {
    const read = async (name: string) => archive.get(name)
      ? Buffer.from(await archive.read(name, archive.limits.maxMetadataSize, signal)).toString("utf8") : undefined
    return { modrinth: await read("modrinth.index.json"), curseforge: await read("manifest.json") }
  } finally { archive.close() }
}

export function activeBuildImportFailure(buildName: string, t: RuntimeTranslator): ModpackImportResult | null {
  return isGameDirActive(getBuildIntentPath(buildName))
    ? { success: false, error: t("runtime.import.running") } : null
}

export async function prepareModpackInstall(intentPath: string, signal: AbortSignal) {
  const t = await getMainTranslator()
  const assertIdle = () => {
    if (isGameDirActive(intentPath)) throw new Error(t("runtime.import.running"))
  }
  assertIdle()
  return stageModpackInstall(intentPath, signal, assertIdle)
}

/** Missing Mods Checker дополняет provider plan до применения файловой транзакции. */
export async function fetchMissingPackMods(intentPath: string, signal?: AbortSignal): Promise<{ downloaded: number; failed: number; missing: number }> {
  const entries = readMissingModsConfig(intentPath)
  if (!entries.length) return { downloaded: 0, failed: 0, missing: 0 }
  const missing = collectMissingFiles(intentPath, entries)
  if (!missing.length) return { downloaded: 0, failed: 0, missing: 0 }
  sendImportProgress(95, 100, "import.phase.files")
  const result = await downloadMissingModFiles(intentPath, missing, {
    signal, onProgress: (done, total, current) => sendImportProgress(95, 100, "import.phase.files", current, { completedFiles: done, fileCount: total }),
    loadModsModule,
  })
  logRuntime(`[modpack] Обязательные файлы: докачано ${result.downloaded}, ошибок ${result.failed} из ${missing.length}`)
  if (result.failed) throw new Error("Required modpack files could not be downloaded")
  return { downloaded: result.downloaded, failed: result.failed, missing: missing.length }
}
