import { watchBuildContent } from "./content-watcher"
import { getMainTranslator } from "../i18n"
import { getLauncherDataRoot, getDefaultLauncherDataRoot, launcherLocationConfig } from "../paths"
import { isPortable } from "../profile-path"
import { readDataLocation, scheduleInstancesMove } from "../data-location"
import { isLaunchActive } from "../minecraft-core"
import { serverManager } from "@xnlc/servers"
import { cancelContentDownload, runContentDownload, hasActiveContentDownloads } from "../content-downloads"
import { describeModrinthImportFiles, describeCurseforgeImportFiles, describeFtbImportFiles, withImportFileProgress } from "./import-file-progress"
import { toErrorMessage, opFailure } from "../errors"
import { app, dialog, rpcRegistry } from "../../platform/desktop"
import path from "path"
import fs from "fs/promises"
import { collectDirectorySources } from "@xnlc/archives"
import type { ArchiveServicePackSource } from "../archives/service"
import { archiveService } from "../archives/service"
import type {
  ModrinthVersionDetail,
  ModrinthManifestFile,
  CurseForgeManifestFile,
  FTBModpackVersionManifest,
  FTBFile,
} from "@xnlc/mods" with { "resolution-mode": "import" }
import type { BuildExportCategory, BuildContentUpdates, UpdateChannel, ModpackImportConflict, ModpackImportResult } from "@xnlc/types" with { "resolution-mode": "import" }
import { getMainWindow, logRuntime, sendToRenderer } from "../runtime"
import { getGameDir, isGameDirActive } from "../minecraft-core"
import { dbHelpers } from "../../db"
import { notifyStatsUpdated } from "../stats"
import { readContentMetadataFromPath, type ModMetadata } from "./metadata"
import { classifyContentDropPaths, type ContentDropClassification, type ContentDropKind } from "./content-drop"
import {
  ensureBuildIntentDir,
  getBuildIntentDirName,
  getBuildIntentPath,
  getContentIntentDir,
  getBaseDataRoot,
  getInstancesRoot,
  loadInstancesRoot,
  downloadBuffer,
  sanitizeFileName,
  resolveSafeIntentFilePath,
  getContentDirectoryName,
  saveRemoteContentToIntent,
  saveLocalContentToIntent,
  deleteContentFromIntent,
  setContentEnabledInIntent,
  sendImportProgress,
  runConcurrent,
  copyOverrideEntries,
  copyModrinthClientOverrides,
  loadModsModule,
  isImportCancelledError,
  throwIfImportCancelled,
  startImportSession,
  finishImportSession,
  cancelImport,
  isImportInProgress,
  getLoaderSelectionFromModrinthDeps,
  getLoaderSelectionFromModrinthLoaders,
  getLoaderSelectionFromCurseManifest,
  type ScannedBuildContent,
  type ImportModEntry,
} from "./helpers"
import { scanIntentDir } from "./scanner"
import { copyInstanceDirectory } from "./copy-instance"
import { readTrashSnapshot } from "./trash-meta"
import { activeBuildImportFailure, fetchMissingPackMods, modpackFailure, prepareModpackInstall, readPackIndexes, updateMetadata } from "./modpack-service"
export { fetchMissingPackMods } from "./modpack-service"
import { checkContentUpdates, dismissContentUpdate, readUpdatesCache, readUpdatesCounts } from "./update-checker"
import { pruneStaleLoaderProfiles, type LoaderPruneResult } from "./loader-profiles"
import { isModpackApplying, stageModpackInstall, writeModpackDownload, validateModpackPaths } from "./modpack-install"

export { ensureBuildIntentDir, getBuildIntentDirName, getBuildIntentPath, scanIntentDir }

/**
 * Файл, выбранный для локального импорта модпака, если импорт был остановлен
 * из-за конфликта имён. Позволяет продолжить установку без повторного выбора файла.
 */
let pendingLocalImport: { filePath: string; format: "modpack" | "curseforge" | "xneon" } | null = null

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;")
}

type PackIdentity = {
  source: "modrinth" | "curseforge" | "ftb" | "local"
  projectSlug?: string
  modId?: number
}

/** Подбирает свободное имя вида «Название 2», «Название 3» и т.д. */
function makeUniqueBuildName(base: string, builds: Array<{ name: string }>): string {
  const taken = new Set(builds.map((b) => b.name.trim().toLowerCase()))
  const trimmed = base.trim() || "Сборка"
  if (!taken.has(trimmed.toLowerCase())) return trimmed
  for (let i = 2; i <= 999; i++) {
    const candidate = `${trimmed} ${i}`
    if (!taken.has(candidate.toLowerCase())) return candidate
  }
  return `${trimmed} ${Date.now()}`
}

/**
 * Проверяет, не занято ли имя сборки и не установлен ли уже такой модпак.
 * Возвращает конфликт, если импорт может перезаписать существующий инстанс.
 */
export async function findPackConflict(name: string, identity: PackIdentity): Promise<{
  kind: "duplicate" | "name"
  existingName: string
  existingBuildId: string
  suggestedName: string
} | null> {
  // Лёгкий список: для поиска конфликта нужны только имя, источник и id пакета.
  const builds = await dbHelpers.loadBuildsLight()
  const norm = (value: string) => value.trim().toLowerCase()

  let byPack: (typeof builds)[number] | undefined
  if (identity.source === "modrinth" && identity.projectSlug) {
    const slug = norm(identity.projectSlug)
    byPack = builds.find((b) => b.source === "modrinth" && !!b.projectSlug && norm(b.projectSlug) === slug)
  } else if (identity.modId != null) {
    const modId = Number(identity.modId)
    byPack = builds.find((b) => b.source === identity.source && b.modId != null && Number(b.modId) === modId)
  }

  const byName = builds.find((b) => norm(b.name) === norm(name))

  // Совпадение по самому модпаку считаем конфликтом, только если имя не меняли.
  // Иначе сценарий «Создать копию» зацикливался: импорт запускался под новым
  // именем, снова находил ту же сборку по modId и опять открывал этот диалог.
  const duplicate = byPack && norm(byPack.name) === norm(name) ? byPack : undefined
  const existing = duplicate ?? byName
  if (!existing) return null

  return {
    kind: duplicate ? "duplicate" : "name",
    existingName: existing.name,
    existingBuildId: existing.id,
    suggestedName: makeUniqueBuildName(name, builds),
  }
}

/**
 * Убирает статистику удалённой сборки по метаданным из корзины.
 *
 * `id` из снапшота удаляем строго по нему, а по именам (реальное имя сборки и
 * имя папки) чистим только осиротевшие записи — см. `deleteGameSessionsForDeletedBuild`.
 */
async function clearTrashedBuildSessions(
  dirNameOrTrashName: string,
  snapshot: { id?: string; name?: string } | null,
): Promise<void> {
  try {
    const names = [dirNameOrTrashName, snapshot?.name].filter((v): v is string => !!v)
    await dbHelpers.deleteGameSessionsForDeletedBuild({
      ids: snapshot?.id ? [snapshot.id] : [],
      names,
    })
    // Запись сборки в БД тоже убираем: иначе удалённая сборка возвращается в
    // список при следующем reloadBuilds (папка интента создаётся заново пустой).
    if (snapshot?.id) await dbHelpers.deleteBuild(snapshot.id)
  } catch {
    // статистика не критична для удаления сборки
  }
}

/**
 * Убирает статистику сборки, которую удаляют мимо корзины.
 *
 * Здесь сборка обычно ещё есть в БД (запись чистится после ответа хендлера),
 * поэтому id резолвим по имени. Совпадение по санитизированному имени добавляет
 * только имя: под ту же папку может попасть другая, одноимённая сборка.
 */
async function clearBuildSessionsForDir(dirName: string): Promise<void> {
  try {
    const builds = await dbHelpers.loadBuildsLight()
    const names: string[] = [dirName]
    const ids: string[] = []
    const exact = builds.find((b) => b.name === dirName)
    if (exact) {
      ids.push(exact.id)
      names.push(exact.name)
    } else {
      for (const build of builds) {
        if (getBuildIntentDirName(build.name) === dirName) names.push(build.name)
      }
    }
    await dbHelpers.deleteGameSessionsForDeletedBuild({ ids, names })
    // Полное удаление сборки убирает и её запись из БД — иначе сборка
    // возвращается в список при следующем reloadBuilds.
    for (const id of ids) await dbHelpers.deleteBuild(id)
  } catch {
    // статистика не критична для удаления сборки
  }
}

/** Проверка перед импортом: не даём затереть уже существующий инстанс. */
async function guardAgainstOverwrite(
  name: string,
  identity: PackIdentity,
  targetBuildId?: string,
): Promise<ModpackImportResult | null> {
  const conflict = await findPackConflict(name, identity)
  if (!conflict) return null
  // Обновление/переустановка конкретного инстанса — это не перезапись
  if (targetBuildId && conflict.existingBuildId === targetBuildId) return null
  return { success: false, conflict }
}

function entryTopName(relativePath: string): string {
  return relativePath.split("/").filter(Boolean)[0] ?? ""
}

function entryCategory(topName: string): BuildExportCategory {
  switch (topName) {
    case "mods": return "mods"
    case "resourcepacks": return "resourcepacks"
    case "shaderpacks": return "shaderpacks"
    case "saves": return "saves"
  }
  if (topName === "logs" || topName === "crash-reports" || topName === ".cache" || topName === ".fabric" || topName === ".quilt") {
    return "logs"
  }
  return "data"
}

type ImportResult = {
  success: boolean
  error?: string
  cancelled?: boolean
  version?: string
  modLoader?: string
  loaderVersion?: string
  modpackVersion?: string
  modpackVersionId?: string
  mods?: ImportModEntry[]
  resourcepacks?: ImportModEntry[]
  shaders?: ImportModEntry[]
  installedMods?: Record<string, string>
  conflict?: ModpackImportConflict
}

type OpenImportResult = ImportResult & {
  customVersionPath?: string
  name?: string
  description?: string
  icon?: string
  source?: "modrinth" | "curseforge" | "local"
  intentPath?: string
}

export function registerBuildHandlers() {
  registerBuildImportHandlers()
  const contentWatchers = new Map<number, { token: string; close?: () => void }>()
  const watchedOwners = new WeakSet<import("../../platform/ipc").ViewSession>()
  rpcRegistry.handle("build:watch-content", async (event, buildId: string, token: string) => {
    const owner = event.sender
    contentWatchers.get(owner.id)?.close?.()
    const subscription: { token: string; close?: () => void } = { token }
    contentWatchers.set(owner.id, subscription)
    if (!watchedOwners.has(owner)) {
      watchedOwners.add(owner)
      owner.once("destroyed", () => {
        contentWatchers.get(owner.id)?.close?.()
        contentWatchers.delete(owner.id)
      })
    }
    try {
      const build = await dbHelpers.findBuildById(buildId)
      if (!build || owner.isDestroyed() || contentWatchers.get(owner.id) !== subscription) return false
      const directory = build.intentPath || getBuildIntentPath(build.name)
      subscription.close = watchBuildContent(directory, () => {
        if (!owner.isDestroyed()) owner.send({ channel: "build:content-changed", payload: { buildId, token } })
      })
      return true
    } catch { return false }
  })
  rpcRegistry.handle("build:unwatch-content", (event, token: string) => {
    const subscription = contentWatchers.get(event.sender.id)
    if (subscription?.token !== token) return
    subscription.close?.()
    contentWatchers.delete(event.sender.id)
  })

  rpcRegistry.handle("build:check-content-updates", async (_event, buildId: string, channel?: UpdateChannel): Promise<BuildContentUpdates> => {
    try {
      return await checkContentUpdates(buildId, channel ?? "release")
    } catch (error) {
      console.error("[Updates] Content update check failed:", error)
      return { buildId, channel: channel ?? "release", checkedAt: Date.now(), updates: [] }
    }
  })

  rpcRegistry.handle("build:get-content-updates-cache", async (): Promise<Record<string, BuildContentUpdates>> => {
    return readUpdatesCache()
  })

  // Бейджи в списке сборок и на вкладках нуждаются только в количестве
  // обновлений. Полный кэш — это мегабайты (иконки модов) и его передача в
  // renderer на каждое изменение списка сборок стоила дороже самой проверки.
  rpcRegistry.handle("build:get-content-updates-counts", async (): Promise<Record<string, { mods: number; resourcepacks: number; shaders: number }>> => {
    return readUpdatesCounts()
  })

  rpcRegistry.handle("build:dismiss-content-update", async (_event, buildId: string, itemId: string): Promise<void> => {
    return dismissContentUpdate(buildId, itemId)
  })

  rpcRegistry.handle("build:cancel-import", async (): Promise<{ success: boolean }> => {
    return { success: cancelImport() }
  })

  rpcRegistry.handle("build:get-intent-path", async (_event, dirNameOrPath: string): Promise<string> => {
    if (path.isAbsolute(dirNameOrPath)) {
      await fs.mkdir(dirNameOrPath, { recursive: true }).catch(() => {})
      return dirNameOrPath
    }
    return ensureBuildIntentDir(dirNameOrPath)
  })

  rpcRegistry.handle("build:get-instances-root", async (): Promise<string> => getInstancesRoot())

  let dataMoveRestartPending = false
  const storageBusy = async () => {
    if (isLaunchActive() || isImportInProgress() || hasActiveContentDownloads()) return true
    const { hasPendingMcServerOperation } = await import("../mc-server-handlers.js")
    return (await dbHelpers.listMcServers()).some(server => serverManager.isRunning(server.id) || hasPendingMcServerOperation(server.id))
  }
  rpcRegistry.handle("launcher:data-move-status", () => {
    const state = isPortable ? { pendingInstances: undefined, error: undefined } : readDataLocation(launcherLocationConfig, getLauncherDataRoot())
    return { pendingRoot: state.pendingInstances?.target, error: state.error }
  })
  rpcRegistry.handle("launcher:restart-for-data-move", async () => {
    try {
      if (dataMoveRestartPending) return { success: true }
      if (isPortable) throw new Error("Portable storage cannot be moved.")
      if (await storageBusy()) throw new Error("DATA_PATH_BUSY")
      const state = readDataLocation(launcherLocationConfig, getLauncherDataRoot())
      if (!state.pendingInstances) return { success: true }
      dataMoveRestartPending = true
      // Даём IPC-ответу дойти до renderer перед закрытием окна.
      setTimeout(() => { app.relaunch(); app.quit() }, 150)
      return { success: true }
    } catch (error) { return opFailure(error) }
  })
  rpcRegistry.handle("build:set-instances-root", async (_event, newRoot: string): Promise<{ success: boolean; root?: string; requiresRestart?: boolean; error?: string }> => {
    try {
      if (isPortable) throw new Error("Portable storage cannot be moved.")
      if (dataMoveRestartPending || await storageBusy()) throw new Error("DATA_PATH_BUSY")
      const target = newRoot.trim() || getDefaultLauncherDataRoot()
      const state = readDataLocation(launcherLocationConfig, getLauncherDataRoot())
      const next = scheduleInstancesMove(launcherLocationConfig, state, getInstancesRoot(), target)
      return { success: true, root: next.pendingInstances?.target ?? getInstancesRoot(), requiresRestart: !!next.pendingInstances }
    } catch (error) { return opFailure(error) }
  })

  rpcRegistry.handle("content:cancel-download", (event, id: string) => cancelContentDownload(event.sender.id, id))

  rpcRegistry.handle("build:save-mod-to-intent", async (event, dirName: string, url: string, fileName: string): Promise<string | null> => {
    return runContentDownload(event.sender.id, (signal, id) => saveRemoteContentToIntent(dirName, "mod", url, fileName, signal, id))
  })

  rpcRegistry.handle("build:save-local-mod-to-intent", async (_event, dirName: string, localFilePath: string): Promise<string | null> => {
    return saveLocalContentToIntent(dirName, "mod", localFilePath)
  })

  // Метаданные локального файла (fabric.mod.json / mods.toml / pack.mcmeta /
  // shaders.properties): нужны, чтобы мод, брошенный в панель, появлялся в списке
  // со своим именем, версией и автором, а не с именем файла.
  rpcRegistry.handle("build:read-local-content-metadata", async (_event, localFilePath: string): Promise<ModMetadata | null> => {
    try {
      return await readContentMetadataFromPath(localFilePath)
    } catch (error) {
      logRuntime(`[Builds] Failed to read metadata from ${localFilePath}: ${toErrorMessage(error)}`)
      return null
    }
  })

  // Разбор того, что перетащили в панель: что можно принять, а что нет и почему.
  // Решение принимает main, потому что только он видит, папка это или файл.
  rpcRegistry.handle("build:classify-drop-paths", async (_event, paths: string[], kind: ContentDropKind): Promise<ContentDropClassification> => {
    return classifyContentDropPaths(paths ?? [], kind)
  })

  rpcRegistry.handle("build:save-content-to-intent", async (event, dirName: string, contentType: "mod" | "resourcepack" | "shader", url: string, fileName: string): Promise<string | null> => {
    return runContentDownload(event.sender.id, (signal, id) => saveRemoteContentToIntent(dirName, contentType, url, fileName, signal, id))
  })

  rpcRegistry.handle("build:save-local-content-to-intent", async (_event, dirName: string, contentType: "mod" | "resourcepack" | "shader", localFilePath: string): Promise<string | null> => {
    return saveLocalContentToIntent(dirName, contentType, localFilePath)
  })

  rpcRegistry.handle("build:delete-content-from-intent", async (_event, dirName: string, contentType: "mod" | "resourcepack" | "shader", fileName: string): Promise<{ success: boolean; error?: string }> => {
    return deleteContentFromIntent(dirName, contentType, fileName)
  })

  rpcRegistry.handle("build:set-content-enabled", async (_event, dirName: string, contentType: "mod" | "resourcepack" | "shader", fileName: string, enabled: boolean): Promise<{ success: boolean; fileName?: string; error?: string }> => {
    return setContentEnabledInIntent(dirName, contentType, fileName, enabled)
  })

  // Legacy ensure-directory: путь сохраняется insertBuild/updateBuildFields,
  // а этот канал только готовит каталог и проверяет ожидаемое расположение.
  rpcRegistry.handle("build:set-intent-path", async (_event, dirName: string, expectedPath: string): Promise<void> => {
    const directory = getBuildIntentPath(dirName)
    if (typeof expectedPath !== "string" || path.resolve(expectedPath) !== path.resolve(directory)) throw new Error("Unexpected build directory")
    await ensureBuildIntentDir(dirName)
  })

  // Смена загрузчика/его версии в сборке: убираем профили старых загрузчиков из
  // <intent>/versions, иначе на следующем запуске они конфликтуют с новым.
  rpcRegistry.handle("build:prune-loader-profiles", async (_event, dirName: string, modLoader?: string, loaderVersion?: string): Promise<LoaderPruneResult> => {
    try {
      return pruneStaleLoaderProfiles(getBuildIntentPath(dirName), modLoader, loaderVersion)
    } catch (error) {
      logRuntime(`[Builds] Failed to prune stale loader profiles for ${dirName}: ${toErrorMessage(error)}`)
      return { removed: [], kept: [] }
    }
  })

  rpcRegistry.handle("build:rename-intent", async (_event, oldName: string, newName: string): Promise<{ success: boolean; intentPath?: string; error?: string }> => {
    const t = await getMainTranslator()
    try {
      const baseDataRoot = getInstancesRoot()
      const oldSafeName = getBuildIntentDirName(oldName)
      const newSafeName = getBuildIntentDirName(newName)
      const oldIntentPath = path.join(baseDataRoot, "intents", oldSafeName)
      const newIntentPath = path.join(baseDataRoot, "intents", newSafeName)
      if (oldIntentPath === newIntentPath) return { success: true, intentPath: newIntentPath }
      if (isImportInProgress()) {
        return { success: false, error: t("runtime.build.busy") }
      }
      if (isGameDirActive(oldIntentPath)) {
        return { success: false, error: t("runtime.build.busy") }
      }
      // Nothing to rename if the source dir doesn't exist yet (not launched).
      const srcExists = await fs.access(oldIntentPath).then(() => true).catch(() => false)
      if (!srcExists) return { success: true, intentPath: newIntentPath }
      const dstExists = await fs.access(newIntentPath).then(() => true).catch(() => false)
      if (dstExists) return { success: false, error: t("builds.errors.duplicateName") }
      await fs.rename(oldIntentPath, newIntentPath)
      return { success: true, intentPath: newIntentPath }
    } catch (error) {
      return opFailure(error)
    }
  })

  rpcRegistry.handle("build:delete-intent", async (_event, dirName: string): Promise<{ success: boolean; error?: string }> => {
    const t = await getMainTranslator()
    try {
      const baseDataRoot = getInstancesRoot()
      const safeName = getBuildIntentDirName(dirName)
      const intentPath = path.join(baseDataRoot, "intents", safeName)
      if (isImportInProgress()) {
        return { success: false, error: t("runtime.build.busy") }
      }
      if (isGameDirActive(intentPath)) {
        return { success: false, error: t("runtime.build.busy") }
      }
      await fs.rm(intentPath, { recursive: true, force: true, maxRetries: 3 })

      // Clean up stats sessions and notify
      await clearBuildSessionsForDir(dirName)
      notifyStatsUpdated()

      return { success: true }
    } catch (error) {
      return opFailure(error)
    }
  })

  rpcRegistry.handle("build:move-intent-to-trash", async (_event, dirName: string, metadata?: Record<string, unknown>): Promise<{ success: boolean; trashName?: string; error?: string }> => {
    const t = await getMainTranslator()
    try {
      const baseDataRoot = getInstancesRoot()
      const safeName = getBuildIntentDirName(dirName)
      const intentPath = path.join(baseDataRoot, "intents", safeName)
      if (isImportInProgress()) {
        return { success: false, error: t("runtime.build.busy") }
      }
      if (isGameDirActive(intentPath)) {
        return { success: false, error: t("runtime.build.busy") }
      }
      await fs.access(intentPath)
      const trashRoot = path.join(baseDataRoot, "intents", ".trash")
      await fs.mkdir(trashRoot, { recursive: true })
      const trashName = `${Date.now()}-${safeName}`
      const trashedPath = path.join(trashRoot, trashName)
      await fs.rename(intentPath, trashedPath)

      // Метаданные сборки (иконка, версия, загрузчик, привязка к модпаку и т.д.)
      // живут только в БД и теряются при удалении записи. Сохраняем снапшот рядом
      // с папкой в корзине, иначе восстановление вернёт файлы без метаданных —
      // и сборка появится в списке лишь после перезапуска (или не появится вовсе).
      if (metadata && typeof metadata === "object") {
        try {
          await fs.writeFile(
            path.join(trashRoot, `${trashName}.json`),
            JSON.stringify(metadata),
            "utf-8",
          )
        } catch { /* снапшот не критичен для самого перемещения */ }
      }

      // Запись сборки в БД убираем сразу: снапшот рядом с папкой хранит все
      // метаданные, поэтому восстановление из корзины вернёт сборку целиком, а
      // оставшаяся запись иначе возвращала бы удалённую сборку в список.
      const metadataId = metadata && typeof metadata.id === "string" ? metadata.id : undefined
      if (metadataId) await dbHelpers.deleteBuild(metadataId).catch(() => {})

      // Сессии в статистике остаются (их убирает только очистка корзины), но
      // имя и иконка сборки теперь берутся из снапшота — просим страницу
      // статистики перечитать данные, иначе она покажет старую карточку.
      notifyStatsUpdated()

      return { success: true, trashName }
    } catch (error) {
      return { success: false, error: toErrorMessage(error) }
    }
  })

  rpcRegistry.handle("build:restore-intent-from-trash", async (_event, dirName: string, trashName: string): Promise<{ success: boolean; build?: Record<string, unknown>; error?: string }> => {
    return restoreBuildFromTrash(dirName, trashName)
  })

  rpcRegistry.handle("build:purge-trash", async (): Promise<{ success: boolean; error?: string }> => {
    try {
      const trashRoot = path.join(getInstancesRoot(), "intents", ".trash")
      const entries = await fs.readdir(trashRoot, { withFileTypes: true }).catch(() => [])
      // Снапшоты читаем до удаления корзины: по ним находим статистику сборок,
      // чьи имена папок санитизированы (`Create+` → `Create_`).
      const targets: Array<{ name: string; snapshot: { id?: string; name?: string } | null }> = []
      for (const entry of entries) {
        if (!entry.isDirectory()) continue
        const match = entry.name.match(/^(\d+)-(.+)$/)
        if (!match) continue
        targets.push({ name: match[2], snapshot: await readTrashSnapshot(entry.name) })
      }
      await fs.rm(trashRoot, { recursive: true, force: true }).catch(() => {})

      if (targets.length > 0) {
        for (const target of targets) {
          await clearTrashedBuildSessions(target.name, target.snapshot)
        }
        notifyStatsUpdated()
      }

      return { success: true }
    } catch (error) {
      return opFailure(error)
    }
  })

  rpcRegistry.handle("build:list-trash", async (): Promise<Array<{ trashName: string; originalName: string; trashedAt: number; icon?: string; modLoader?: string }>> => {
    return listBuildTrash()
  })

  rpcRegistry.handle("build:delete-trash-item", async (_event, trashName: string): Promise<{ success: boolean; error?: string }> => {
    const t = await getMainTranslator()
    try {
      if (!isSafeTrashEntryName(trashName)) return { success: false, error: t("runtime.build.invalidTrash") }
      const trashPath = path.join(getInstancesRoot(), "intents", ".trash", trashName)
      const match = trashName.match(/^(\d+)-(.+)$/)
      const originalName = match ? match[2] : null
      // Снапшот читаем до удаления: в нём настоящие id и имя сборки.
      const snapshot = await readTrashSnapshot(trashName)

      await fs.rm(trashPath, { recursive: true, force: true })
      // Снапшот метаданных лежит рядом с папкой отдельным файлом — удаляем вместе с ней.
      await fs.rm(path.join(getInstancesRoot(), "intents", ".trash", `${trashName}.json`), { force: true }).catch(() => {})

      if (originalName || snapshot) {
        await clearTrashedBuildSessions(snapshot?.name ?? originalName ?? "", snapshot)
        notifyStatsUpdated()
      }

      return { success: true }
    } catch (error) {
      return opFailure(error)
    }
  })

  rpcRegistry.handle("build:copy", async (_event, dirName: string, newName: string): Promise<{ success: boolean; intentPath?: string; error?: string }> => {
    try {
      const source = await dbHelpers.findBuildByName(dirName)
      const sourceBuild = source ? await dbHelpers.findBuildById(source.id) : null
      const srcIntentPath = sourceBuild?.intentPath || getBuildIntentPath(dirName)
      const newIntentPath = getBuildIntentPath(newName)
      await copyInstanceDirectory(srcIntentPath, newIntentPath)
      return { success: true, intentPath: newIntentPath }
    } catch (error) {
      return opFailure(error)
    }
  })

  rpcRegistry.handle("build:export-zip", async (_event, dirName: string, buildNameLabel: string, categories?: BuildExportCategory[]): Promise<{ success: boolean; path?: string; error?: string }> => {
    const t = await getMainTranslator()
    try {
      const win = getMainWindow()
      if (!win) return { success: false, error: t("runtime.server.windowUnavailable") }
      const intentPath = await ensureBuildIntentDir(dirName)
      const picked = await dialog.showSaveDialog(win, {
        title: t("instanceList.exportZip"),
        defaultPath: `${sanitizeFileName(buildNameLabel || dirName)}.zip`,
        filters: [{ name: "ZIP", extensions: ["zip"] }],
      })
      if (picked.canceled || !picked.filePath) return { success: false, error: t("runtime.server.exportCancelled") }

      // Prism Launcher excludes logs, crash-reports and caches when exporting (ExportInstanceDialog.cpp).
      const LOG_ENTRIES = new Set(["logs", "crash-reports", ".cache", ".fabric", ".quilt"])
      // Shared game files are reconstructed from the build's version metadata on
      // import — and they're junctions to a shared cache, so they must never be zipped.
      const SHARED_GAME_ENTRIES = new Set(["versions", "libraries", "assets"])

      const buildDirName = path.basename(intentPath)
      const include = (relativePath: string) => {
        const topName = entryTopName(relativePath)
        if (topName.toLowerCase() === ".xnlc-modpack") return false
        if (categories == null) {
          return !LOG_ENTRIES.has(topName) && !SHARED_GAME_ENTRIES.has(topName)
        }
        return categories.includes(entryCategory(topName)) && !SHARED_GAME_ENTRIES.has(topName)
      }

      const sources: ArchiveServicePackSource[] = await collectDirectorySources(intentPath, { prefix: buildDirName, include })

      // Манифест в корне делает архив самодостаточным: при импорте из него
      // берутся версия, загрузчик и иконка сборки. Достаточно лёгких полей.
      const buildRow = (await dbHelpers.loadBuildsLight()).find((b) => b.name === dirName)
      sources.push({
        kind: "data",
        entryName: "xnlauncher.json",
        data: Buffer.from(JSON.stringify({
          format: "xnlauncher-build",
          formatVersion: 1,
          name: buildNameLabel || dirName,
          description: buildRow?.description ?? "",
          minecraftVersion: buildRow?.version ?? "",
          modLoader: buildRow?.modLoader ?? "vanilla",
          loaderVersion: buildRow?.loaderVersion ?? "",
          icon: buildRow?.icon ?? "",
          exportedAt: new Date().toISOString(),
          categories: categories ?? null,
        }, null, 2), "utf-8"),
      })

      await archiveService.pack(sources, picked.filePath, {
        onProgress: ({ done, total }) => {
          sendToRenderer("build:export-progress", { current: done, total })
        },
      })
      return { success: true, path: picked.filePath }
    } catch (error) {
      return opFailure(error)
    }
  })

  rpcRegistry.handle("build:export-modlist", async (_event, dirName: string, buildNameLabel: string, format: "html" | "markdown" | "json" | "csv" | "plaintext"): Promise<{ success: boolean; path?: string; error?: string }> => {
    const t = await getMainTranslator()
    try {
      const win = getMainWindow()
      if (!win) return { success: false, error: t("runtime.server.windowUnavailable") }
      const label = buildNameLabel || dirName

      // Быстрый путь: список модов уже лежит в БД сборки — берём его оттуда,
      // не сканируя intent-директорию и не дёргая Modrinth/CurseForge API
      // (именно сетевые запросы в scanIntentDir → resolveContentEntries и были
      // причиной долгого экспорта). Скан на диске — только как fallback,
      // если сборка почему-то не найдена в БД.
      type ModlistRow = { name?: string; slug?: string; version?: string; author?: string }
      const toRow = (m: unknown): ModlistRow => {
        const r = (m ?? {}) as Record<string, unknown>
        return {
          name: typeof r.name === "string" ? r.name : undefined,
          slug: typeof r.slug === "string" ? r.slug : undefined,
          version: typeof r.version === "string" ? r.version : undefined,
          author: typeof r.author === "string" ? r.author : undefined,
        }
      }

      let mods: ModlistRow[] = []
      const builds = await dbHelpers.loadBuilds()
      const build = builds.find((b) => b.name === dirName)
      if (build) {
        mods = (build.mods ?? []).map(toRow)
      } else {
        const intentPath = await ensureBuildIntentDir(dirName)
        const scanned = await scanIntentDir(intentPath)
        mods = (scanned.mods ?? []).map(toRow)
      }

      const extMap: Record<string, string> = { html: "html", markdown: "md", json: "json", csv: "csv", plaintext: "txt" }
      const picked = await dialog.showSaveDialog(win, {
        title: t("instanceList.exportModlist"),
        defaultPath: `${sanitizeFileName(label)}-mods.${extMap[format] ?? "txt"}`,
        filters: [{ name: "Файл", extensions: [extMap[format] ?? "txt"] }],
      })
      if (picked.canceled || !picked.filePath) return { success: false, error: t("runtime.server.exportCancelled") }

      const rows = mods.map((m, i) => ({
        index: i + 1,
        name: m.name ?? "",
        slug: m.slug ?? "",
        version: m.version ?? "",
        author: m.author ?? "",
      }))

      let content = ""
      if (format === "json") {
        content = JSON.stringify({ build: label, exportedAt: new Date().toISOString(), mods: rows }, null, 2)
      } else if (format === "csv") {
        content = ["#;Name;Slug;Version;Author", ...rows.map(r => `${r.index};${r.name};${r.slug};${r.version};${r.author}`)].join("\n")
      } else if (format === "html") {
        content = `<!DOCTYPE html><html lang="ru"><head><meta charset="utf-8"><title>${label} — моды</title><style>body{font-family:sans-serif;margin:2rem}table{border-collapse:collapse;width:100%}th,td{border:1px solid #ccc;padding:.4rem;text-align:left}th{background:#f4f4f4}</style></head><body><h1>${label}</h1><table><thead><tr><th>#</th><th>Название</th><th>Slug</th><th>Версия</th><th>Автор</th></tr></thead><tbody>${rows.map(r => `<tr><td>${r.index}</td><td>${escapeHtml(r.name)}</td><td>${escapeHtml(r.slug)}</td><td>${escapeHtml(r.version)}</td><td>${escapeHtml(r.author)}</td></tr>`).join("")}</tbody></table></body></html>`
      } else {
        content = [
          `Моды сборки «${label}»`,
          `Экспортировано: ${new Date().toLocaleString("ru-RU")}`,
          "",
          ...rows.map(r => `${r.index}. ${r.name}${r.version && r.version !== "local" ? ` — ${r.version}` : ""}${r.author ? ` (${r.author})` : ""}`),
        ].join("\n")
      }

      await fs.writeFile(picked.filePath, content, "utf-8")
      return { success: true, path: picked.filePath }
    } catch (error) {
      return opFailure(error)
    }
  })

  rpcRegistry.handle("build:scan-intent-content", async (_event, dirNameOrPath: string): Promise<ScannedBuildContent> => {
    const intentPath = path.isAbsolute(dirNameOrPath)
      ? dirNameOrPath
      : await getContentIntentDir(dirNameOrPath)
    if (isModpackApplying(intentPath)) throw new Error("Modpack installation is being applied")
    return scanIntentDir(intentPath)
  })

  // Ручной запуск докачивания «core»-файлов пака (Missing Mods Checker).
}

/** Регистрация импортных сценариев отделена от файловых/экспортных каналов. */
function registerBuildImportHandlers() {
  rpcRegistry.handle("build:fetch-missing-mods", async (_event, buildName: string) => {
    try {
      const intentPath = await ensureBuildIntentDir(buildName)
      return { success: true as const, ...(await fetchMissingPackMods(intentPath)) }
    } catch (error) {
      return { success: false as const, error: toErrorMessage(error) }
    }
  })


  rpcRegistry.handle("build:import-modrinth", async (_event, buildName: string, projectSlug: string, versionId?: string, targetBuildId?: string): Promise<ImportResult> => {
    const t = await getMainTranslator()
    const signal = startImportSession()
    let installation: Awaited<ReturnType<typeof stageModpackInstall>> | undefined
    try {
      const activeFailure = activeBuildImportFailure(buildName, t)
      if (activeFailure) return activeFailure
      const conflict = await guardAgainstOverwrite(buildName, { source: "modrinth", projectSlug }, targetBuildId)
      if (conflict) return conflict
      const installedPath = await getContentIntentDir(buildName)
      installation = await prepareModpackInstall(installedPath, signal)
      const intentPath = installation.directory
      sendImportProgress(0, 100, "import.phase.preparing", undefined, { operation: targetBuildId ? "update" : "modpack", source: "modrinth", title: buildName })
      const mods = await loadModsModule()
      const versions = await mods.modrinthGetRawVersions(projectSlug)
      throwIfImportCancelled(signal)

      const version: ModrinthVersionDetail | undefined = versionId ? versions.find((v) => v.id === versionId) : versions[0]
      if (!version) throw new Error(t("runtime.import.noVersions"))

      const mrpackFile = version.files?.find((f: { filename?: string }) => f.filename?.endsWith(".mrpack"))
      if (!mrpackFile) throw new Error(t("runtime.import.missingFile", { file: ".mrpack" }))

      if (!mrpackFile?.url) throw new Error(t("runtime.import.noUrl", { file: ".mrpack" }))
      sendImportProgress(0, 100, "import.phase.package")
      const data = await downloadBuffer(mrpackFile.url, signal, mrpackFile.filename || "modpack.mrpack")
      const indexes = await readPackIndexes(data, signal)
      if (!indexes.modrinth) throw new Error(t("runtime.import.missingFile", { file: "modrinth.index.json" }))
      const index = JSON.parse(indexes.modrinth)
      throwIfImportCancelled(signal)

      const files: ModrinthManifestFile[] = (index.files as ModrinthManifestFile[] ?? []).filter((f) => f.env?.client !== "unsupported")
      validateModpackPaths(files.map(file => file.path ?? ""))
      const gameVersion: string = index.dependencies?.minecraft ?? version.game_versions?.[0] ?? ""
      const deps: Record<string, string> = index.dependencies ?? {}
      let loaderSelection = getLoaderSelectionFromModrinthDeps(deps)
      // Манифест не назвал загрузчик (у Forge-паков так бывает) — берём его из
      // самого проекта Modrinth, иначе сборка создавалась как vanilla.
      if (loaderSelection.modLoader === "vanilla") {
        loaderSelection = getLoaderSelectionFromModrinthLoaders(version.loaders)
      }
      let modLoader = loaderSelection.modLoader
      const loaderVersion = loaderSelection.loaderVersion
      if (deps["fabric-loader"]) {
        modLoader = "fabric"
        sendImportProgress(0, 100, "import.phase.preparing")
      } else if (deps["quilt-loader"]) {
        modLoader = "quilt"
        sendImportProgress(0, 100, "import.phase.preparing")
      }

      let downloaded = 0
      const totalFiles = files.length
      // Скачивание занимает первые 90% шкалы, распаковка и сканирование — остаток,
      // чтобы прогресс не «замирал» на 100% во время финальной обработки.
      const downloadPercent = () => Math.round((downloaded / Math.max(totalFiles, 1)) * 90)
      sendImportProgress(0, 100, "import.phase.files")
      const tasks = files.map((f: ModrinthManifestFile) => async () => {
        const currentFileName = path.basename(f.path ?? "")
        try {
          throwIfImportCancelled(signal)
          const filePath = await resolveSafeIntentFilePath(intentPath, f.path ?? "")
          const fileDir = path.dirname(filePath)
          await fs.mkdir(fileDir, { recursive: true }).catch(() => {})
          try { await fs.access(filePath) } catch {
            const url = f.downloads?.[0]
            if (!url) throw new Error(t("runtime.import.noUrl", { file: currentFileName }))
            await writeModpackDownload(filePath, await downloadBuffer(url, signal, currentFileName), f.hashes)
          }
        } catch (error) {
          if (isImportCancelledError(error)) {
            throw error
          }
          const message = toErrorMessage(error)
          throw new Error(t("runtime.import.downloadFailed", { file: currentFileName, message }))
        } finally {
          downloaded++
          sendImportProgress(downloadPercent(), 100, "import.phase.files")
        }
      })
      const progressFiles = await describeModrinthImportFiles(files, signal)
      await runConcurrent(withImportFileProgress(tasks, progressFiles, signal), 5, signal)
      throwIfImportCancelled(signal)
      sendImportProgress(92, 100, "import.phase.extracting")
      await copyModrinthClientOverrides(data, intentPath)
      await fetchMissingPackMods(intentPath, signal)
      const scanned = await installation.apply(() => scanIntentDir(installedPath, (done, total) => {
        const fraction = total > 0 ? done / total : 1
        sendImportProgress(Math.min(99, Math.round(92 + fraction * 7)), 100, "import.phase.scanning")
      }, signal), updateMetadata(targetBuildId, { version: gameVersion, modLoader, loaderVersion, source: "modrinth", projectSlug, modId: undefined, fileId: undefined,
        modpackVersion: version.name ?? version.version_number ?? version.id, modpackVersionId: version.id }))
      sendImportProgress(100, 100, "import.phase.complete")
      return { success: true, version: gameVersion, modLoader, loaderVersion, modpackVersion: version.name ?? version.version_number ?? version.id, modpackVersionId: version.id, ...scanned }
    } catch (e) {
      if (signal.aborted || isImportCancelledError(e)) {
        return { success: false, cancelled: true, error: t("import.cancelledTitle") }
      }
      return modpackFailure(e, t)
    } finally {
      try { await installation?.close() } finally { finishImportSession(signal) }
    }
  })

  rpcRegistry.handle("build:import-curseforge", async (_event, buildName: string, modId: number, fileId: number, targetBuildId?: string): Promise<ImportResult> => {
    const t = await getMainTranslator()
    const signal = startImportSession()
    let installation: Awaited<ReturnType<typeof stageModpackInstall>> | undefined
    try {
      const activeFailure = activeBuildImportFailure(buildName, t)
      if (activeFailure) return activeFailure
      const conflict = await guardAgainstOverwrite(buildName, { source: "curseforge", modId }, targetBuildId)
      if (conflict) return conflict
      const installedPath = await getContentIntentDir(buildName)
      installation = await prepareModpackInstall(installedPath, signal)
      const intentPath = installation.directory
      sendImportProgress(0, 100, "import.phase.preparing", undefined, { operation: targetBuildId ? "update" : "modpack", source: "curseforge", title: buildName })
      const mods = await loadModsModule()
      const zipUrl = await mods.curseforgeGetDownloadUrl(modId, fileId)
      throwIfImportCancelled(signal)
      if (!zipUrl) throw new Error(t("runtime.import.noUrl", { file: "CurseForge" }))

      sendImportProgress(0, 100, "import.phase.package")
      const data = await downloadBuffer(zipUrl, signal, "curseforge-modpack.zip")
      const indexes = await readPackIndexes(data, signal)
      if (!indexes.curseforge) throw new Error(t("runtime.import.missingFile", { file: "manifest.json" }))
      const manifest = JSON.parse(indexes.curseforge)
      throwIfImportCancelled(signal)

      const mcVersion: string = manifest.minecraft?.version ?? ""
      const loaderRaw: string = manifest.minecraft?.modLoaders?.find((m: CurseForgeManifestFile) => m.primary)?.id ?? ""
      const loaderSelection = getLoaderSelectionFromCurseManifest(loaderRaw)
      let modLoader = loaderSelection.modLoader
      const loaderVersion = loaderSelection.loaderVersion
      if (loaderRaw.startsWith("fabric")) modLoader = "fabric"
      else if (loaderRaw.startsWith("quilt")) {
        modLoader = "quilt"
        sendImportProgress(0, 100, "import.phase.preparing")
      }

      const modsDir = path.join(intentPath, "mods")
      await fs.mkdir(modsDir, { recursive: true }).catch(() => {})
      const files: { projectID: number; fileID: number }[] = manifest.files ?? []
      const totalFiles = files.length
      let downloaded = 0
      const downloadPercent = () => Math.round((downloaded / Math.max(totalFiles, 1)) * 90)
      sendImportProgress(0, 100, "import.phase.files")

      // Пакетное получение ссылок на скачивание всех файлов сборки (POST /v1/mods/files)
      const fileIds = files.map((f) => f.fileID).filter(Boolean)
      const claimFile = installation.claimFile
      let filesBatch: Record<number, { downloadUrl: string; fileName: string; fileLength?: number; sha1?: string }> = {}
      try {
        filesBatch = await mods.curseforgeGetFiles(fileIds)
      } catch (err) {
        console.warn("[curseforge-import] Batch files lookup failed, using fallback:", err)
      }

      sendImportProgress(0, 100, "import.phase.files")
      const tasks = files.map((f: CurseForgeManifestFile) => async () => {
        const batchInfo = filesBatch[f.fileID!]
        let fileUrl: string | null = batchInfo?.downloadUrl ?? null
        let fileName = batchInfo?.fileName || `mod-${f.fileID}.jar`

        try {
          throwIfImportCancelled(signal)
          if (!fileUrl) {
            fileUrl = await mods.curseforgeGetDownloadUrl(f.projectID!, f.fileID!)
            if (fileUrl) {
              fileName = fileUrl.split("/").pop()?.split("?")[0] ?? fileName
            }
          }
          if (!fileUrl) throw new Error(t("runtime.import.noUrl", { file: fileName }))

          const filePath = await resolveSafeIntentFilePath(intentPath, `mods/${sanitizeFileName(fileName)}`)
          claimFile(`mods/${sanitizeFileName(fileName)}`)
          try { await fs.access(filePath) } catch {
            await writeModpackDownload(filePath, await downloadBuffer(fileUrl, signal, fileName), { sha1: batchInfo?.sha1, size: batchInfo?.fileLength })
          }
        } catch (error) {
          if (isImportCancelledError(error)) {
            throw error
          }
          const message = toErrorMessage(error)
          throw new Error(t("runtime.import.downloadFailed", { file: fileName, message }))
        }
        downloaded++
        sendImportProgress(downloadPercent(), 100, "import.phase.files")
      })
      const progressFiles = await describeCurseforgeImportFiles(files, filesBatch, signal)
      await runConcurrent(withImportFileProgress(tasks, progressFiles, signal), 5, signal)
      throwIfImportCancelled(signal)
      sendImportProgress(92, 100, "import.phase.extracting")
      await copyOverrideEntries(data, intentPath)
      const scanned = await installation.apply(() => scanIntentDir(installedPath, (done, total) => {
        const fraction = total > 0 ? done / total : 1
        sendImportProgress(Math.min(99, Math.round(92 + fraction * 7)), 100, "import.phase.scanning")
      }, signal), updateMetadata(targetBuildId, { version: mcVersion, modLoader, loaderVersion, source: "curseforge", modId, fileId, projectSlug: undefined,
        modpackVersion: typeof manifest.version === "string" && manifest.version ? manifest.version : String(fileId), modpackVersionId: undefined }))
      sendImportProgress(100, 100, "import.phase.complete")
      return { success: true, version: mcVersion, modLoader, loaderVersion, ...scanned }
    } catch (e) {
      if (signal.aborted || isImportCancelledError(e)) {
        return { success: false, cancelled: true, error: t("import.cancelledTitle") }
      }
      return modpackFailure(e, t)
    } finally {
      try { await installation?.close() } finally { finishImportSession(signal) }
    }
  })

  rpcRegistry.handle("build:import-ftb", async (_event, buildName: string, modpackId: number, versionId: number, targetBuildId?: string): Promise<ImportResult> => {
    const t = await getMainTranslator()
    const signal = startImportSession()
    let installation: Awaited<ReturnType<typeof stageModpackInstall>> | undefined
    try {
      const activeFailure = activeBuildImportFailure(buildName, t)
      if (activeFailure) return activeFailure
      const conflict = await guardAgainstOverwrite(buildName, { source: "ftb", modId: modpackId }, targetBuildId)
      if (conflict) return conflict
      const installedPath = await getContentIntentDir(buildName)
      installation = await prepareModpackInstall(installedPath, signal)
      const intentPath = installation.directory
      sendImportProgress(0, 100, "import.phase.preparing", undefined, { operation: targetBuildId ? "update" : "modpack", source: "ftb", title: buildName })
      const mods = await loadModsModule()
      const manifest = await mods.ftbGetModpackVersion(modpackId, versionId) as FTBModpackVersionManifest | null
      throwIfImportCancelled(signal)
      if (!manifest) throw new Error(t("runtime.import.missingFile", { file: "FTB manifest" }))

      const target = (name: string) => manifest.targets?.find((t: { name: string }) => t.name === name)?.version ?? ""
      const version = target("minecraft")
      let modLoader = ""
      let loaderVersion = ""
      const loaderMap: Array<[string, string]> = [
        ["forge", "forge"],
        ["neoforge", "neoforge"],
        ["fabric", "fabric"],
        ["quilt", "quilt"],
      ]
      for (const [targetName, loader] of loaderMap) {
        const v = target(targetName)
        if (v) {
          modLoader = loader
          loaderVersion = v
          break
        }
      }

      const files = (manifest.files ?? []).filter((f: FTBFile) => !f.serveronly)
      validateModpackPaths(files.map(file => mods.getFTBPath(file)))
      const totalFiles = files.length
      let downloaded = 0
      const downloadPercent = () => Math.round((downloaded / Math.max(totalFiles, 1)) * 90)
      sendImportProgress(0, 100, "import.phase.files")
      const tasks = files.map((f: FTBFile) => async () => {
        const filePath = mods.getFTBPath(f)
        const fileName = filePath.split("/").pop() ?? "file"
        try {
          throwIfImportCancelled(signal)
          const targetPath = await resolveSafeIntentFilePath(intentPath, filePath)
          try { await fs.access(targetPath) } catch {
            let url = f.url ?? ""
            if (!url && f.curseforge) {
              url = await mods.curseforgeGetDownloadUrl(f.curseforge.project, f.curseforge.file) ?? ""
            }
            if (!url) {
              throw new Error(t("runtime.import.noUrl", { file: filePath }))
            }
            await fs.mkdir(path.dirname(targetPath), { recursive: true }).catch(() => {})
            await writeModpackDownload(targetPath, await downloadBuffer(url, signal, fileName), { sha1: f.sha1 })
          }
        } catch (error) {
          if (isImportCancelledError(error)) {
            throw error
          }
          const message = toErrorMessage(error)
          throw new Error(t("runtime.import.downloadFailed", { file: fileName, message }))
        } finally {
          downloaded++
          sendImportProgress(downloadPercent(), 100, "import.phase.files")
        }
      })
      const progressFiles = await describeFtbImportFiles(files, signal)
      await runConcurrent(withImportFileProgress(tasks, progressFiles, signal), 5, signal)
      throwIfImportCancelled(signal)
      sendImportProgress(92, 100, "import.phase.extracting")
      const scanned = await installation.apply(() => scanIntentDir(installedPath, (done, total) => {
        const fraction = total > 0 ? done / total : 1
        sendImportProgress(Math.min(99, Math.round(92 + fraction * 7)), 100, "import.phase.scanning")
      }, signal), updateMetadata(targetBuildId, { version, modLoader, loaderVersion, source: "ftb", modId: modpackId, fileId: versionId, projectSlug: undefined,
        modpackVersion: String(versionId), modpackVersionId: undefined }))
      sendImportProgress(100, 100, "import.phase.complete")
      return { success: true, version, modLoader, loaderVersion, ...scanned }
    } catch (e) {
      if (signal.aborted || isImportCancelledError(e)) {
        return { success: false, cancelled: true, error: t("import.cancelledTitle") }
      }
      return modpackFailure(e, t)
    } finally {
      try { await installation?.close() } finally { finishImportSession(signal) }
    }
  })

  rpcRegistry.handle("build:open-and-import", async (_event, format: "modpack" | "curseforge" | "xneon" = "modpack", nameOverride?: string): Promise<OpenImportResult> => {
    const t = await getMainTranslator()
    if (!["modpack", "curseforge", "xneon"].includes(format)) {
      return { success: false, error: t("runtime.import.unknownFormat") }
    }
    const signal = startImportSession()
    let installation: Awaited<ReturnType<typeof stageModpackInstall>> | undefined
    try {
      const win = getMainWindow()
      if (!win) return { success: false, error: t("runtime.server.windowUnavailable") }

      // Повторный вызов после подтверждения «создать копию» — файл уже выбран
      let selectedFile: string
      if (nameOverride && pendingLocalImport) {
        selectedFile = pendingLocalImport.filePath
        format = pendingLocalImport.format
      } else {
        const picked = await dialog.showOpenDialog(win, {
          title: t("runtime.import.title"),
          properties: ["openFile"],
          filters: [{ name: format === "modpack" ? t("import.modpack") : "ZIP", extensions: format === "modpack" ? ["mrpack", "zip"] : ["zip"] }],
        })
        if (picked.canceled || picked.filePaths.length === 0) return { success: false, error: t("import.cancelledTitle") }
        selectedFile = picked.filePaths[0]
        pendingLocalImport = null
      }
      throwIfImportCancelled(signal)
      // Файл выбран — только теперь показываем прогресс: до этого оверлей
      // затемнял лаунчер, пока пользователь ещё выбирал архив в системном окне.
      sendImportProgress(0, 100, "import.phase.preparing", undefined, { operation: "archive", source: "local", title: path.basename(selectedFile) })
      const indexes = await readPackIndexes(selectedFile, signal)
      const mrpackIndex = indexes.modrinth
      const manifestEntry = indexes.curseforge
      if (format === "curseforge" && !manifestEntry) {
        return { success: false, error: t("runtime.import.missingFile", { file: "manifest.json" }) }
      }

      // Наш собственный экспорт сборки: в корне архива лежит xnlauncher.json.
      const xnManifestEntry = await archiveService.readEntryBuffer(selectedFile, "xnlauncher.json", { signal })
      if (format === "xneon" && !xnManifestEntry) {
        return { success: false, error: t("runtime.import.missingFile", { file: "xnlauncher.json" }) }
      }
      if (xnManifestEntry) {
        const manifest = JSON.parse(xnManifestEntry.toString("utf-8")) as Record<string, unknown>
        const str = (value: unknown, fallback = "") => (typeof value === "string" ? value : fallback)
        const buildName = nameOverride?.trim()
          || str(manifest.name).trim()
          || path.basename(selectedFile, path.extname(selectedFile))

        const activeFailure = activeBuildImportFailure(buildName, t)
        if (activeFailure) return { ...activeFailure, name: buildName, source: "local" }

        const conflict = await guardAgainstOverwrite(buildName, { source: "local" })
        if (conflict) {
          pendingLocalImport = { filePath: selectedFile, format }
          return { ...conflict, name: buildName, description: str(manifest.description), source: "local" }
        }
        pendingLocalImport = null

        const intentPath = await ensureBuildIntentDir(buildName)

        // Архив собран как <папка сборки>/… — срезаем общий корень, чтобы файлы
        // легли прямо в intent-директорию.
        const entries = await archiveService.list(selectedFile, { signal })
        const files = entries.filter((entry) => !entry.directory && entry.name !== "xnlauncher.json")
        const roots = new Set(files.map((entry) => entry.name.split("/").filter(Boolean)[0] ?? ""))
        const root = roots.size === 1 ? Array.from(roots)[0] : ""

        sendImportProgress(0, 100, "import.phase.extracting", undefined, { title: buildName, iconUrl: str(manifest.icon), phase: "extracting" })

        const unpacked = await archiveService.extract(selectedFile, intentPath, {
          signal,
          stripPrefix: root || undefined,
          sanitizeNames: true,
          skipUnsafe: true,
          progressIntervalMs: 100,
          include: (entry) => entry.name !== "xnlauncher.json" && !entry.name.split("/").some(part => part.toLowerCase() === ".xnlc-modpack"),
          onProgress: ({ done, total, name }) => {
            sendImportProgress(Math.round(done / Math.max(total, 1) * 90), 100, "import.phase.extracting", name)
          },
        })
        throwIfImportCancelled(signal)
        if (unpacked.skipped > 0) {
          console.warn(`[Import] Пропущено записей архива: ${unpacked.skipped}`)
        }

        const scanned = await scanIntentDir(intentPath, (done, total) => {
          const fraction = total > 0 ? done / total : 1
          sendImportProgress(Math.min(99, Math.round(92 + fraction * 7)), 100, "import.phase.scanning")
        }, signal)

        sendImportProgress(100, 100, "import.phase.complete")
        return {
          success: true,
          name: buildName,
          description: str(manifest.description),
          icon: str(manifest.icon),
          version: str(manifest.minecraftVersion),
          modLoader: str(manifest.modLoader, "vanilla"),
          loaderVersion: str(manifest.loaderVersion) || undefined,
          source: "local",
          intentPath,
          ...scanned,
        }
      }

      if (mrpackIndex) {
        const index = JSON.parse(mrpackIndex)
        const buildName = nameOverride ?? index.name ?? path.basename(selectedFile, path.extname(selectedFile))
        const mods = await loadModsModule()
        let projectId = typeof index.slug === "string" ? index.slug : ""
        if (!projectId && typeof index.versionId === "string") {
          projectId = await mods.modrinthGetProjectIdByVersion(index.versionId) ?? ""
        }
        const activeFailure = activeBuildImportFailure(buildName, t)
        if (activeFailure) return { ...activeFailure, name: buildName }
        const conflict = await guardAgainstOverwrite(buildName, { source: "modrinth", projectSlug: projectId || undefined })
        if (conflict) {
          pendingLocalImport = { filePath: selectedFile, format }
          return { ...conflict, name: buildName, description: index.summary, source: "modrinth" }
        }
        pendingLocalImport = null
        sendImportProgress(0, 100, "import.phase.preparing", undefined, { operation: "modpack", source: "modrinth", title: buildName })
        const intentPath = await ensureBuildIntentDir(buildName)
        installation = await prepareModpackInstall(intentPath, signal)
        const stagingPath = installation.directory
        const files: ModrinthManifestFile[] = (index.files as ModrinthManifestFile[] ?? []).filter((f) => f.env?.client !== "unsupported")
        validateModpackPaths(files.map(file => file.path ?? ""))
        const deps: Record<string, string> = index.dependencies ?? {}
        const version = deps.minecraft ?? ""
        const loaderSelection = getLoaderSelectionFromModrinthDeps(deps)
        let modLoader = loaderSelection.modLoader
        const loaderVersion = loaderSelection.loaderVersion
        if (deps["fabric-loader"]) {
          modLoader = "fabric"
          sendImportProgress(0, 100, "import.phase.preparing")
        } else if (deps["quilt-loader"]) {
          modLoader = "quilt"
          sendImportProgress(0, 100, "import.phase.preparing")
        }

        let downloaded = 0
        const totalFiles = files.length
        const downloadPercent = () => Math.round((downloaded / Math.max(totalFiles, 1)) * 90)
        sendImportProgress(0, 100, "import.phase.files")
        const tasks = files.map((f: ModrinthManifestFile) => async () => {
          const currentFileName = path.basename(f.path ?? "")
          try {
            const filePath = await resolveSafeIntentFilePath(stagingPath, f.path ?? "")
            const fileDir = path.dirname(filePath)
            await fs.mkdir(fileDir, { recursive: true }).catch(() => {})
            try { await fs.access(filePath) } catch {
              const url = f.downloads?.[0]
              if (!url) throw new Error(t("runtime.import.noUrl", { file: currentFileName }))
              await writeModpackDownload(filePath, await downloadBuffer(url, signal, currentFileName), f.hashes)
            }
          } catch (error) {
            if (isImportCancelledError(error)) {
              throw error
            }
            const message = toErrorMessage(error)
            throw new Error(t("runtime.import.downloadFailed", { file: currentFileName, message }))
          } finally {
            downloaded++
            sendImportProgress(downloadPercent(), 100, "import.phase.files")
          }
        })
        const progressFiles = await describeModrinthImportFiles(files, signal)
        await runConcurrent(withImportFileProgress(tasks, progressFiles, signal), 5, signal)
        throwIfImportCancelled(signal)
        sendImportProgress(92, 100, "import.phase.extracting")
        await copyModrinthClientOverrides(selectedFile, stagingPath)
        await fetchMissingPackMods(stagingPath, signal)
        const scanned = await installation.apply(() => scanIntentDir(intentPath, (done, total) => {
          const fraction = total > 0 ? done / total : 1
          sendImportProgress(Math.min(99, Math.round(92 + fraction * 7)), 100, "import.phase.scanning")
        }, signal))

        let mrIcon = ""
        try {
          const projectInfo = projectId ? await mods.modrinthGetProjectInfo(projectId) : null
          mrIcon = projectInfo?.iconUrl ?? ""
        } catch {}

        sendImportProgress(100, 100, "import.phase.complete")
        return {
          success: true,
          name: buildName,
          description: index.summary ?? "",
          icon: mrIcon,
          version,
          modLoader,
          loaderVersion,
          source: "modrinth",
          intentPath,
          ...scanned,
        }
      }

      if (manifestEntry) {
        const manifest = JSON.parse(manifestEntry)
        const buildName = nameOverride ?? manifest.name ?? path.basename(selectedFile, path.extname(selectedFile))
        const activeFailure = activeBuildImportFailure(buildName, t)
        if (activeFailure) return { ...activeFailure, name: buildName }
        const conflict = await guardAgainstOverwrite(buildName, { source: "curseforge", modId: manifest.projectID })
        if (conflict) {
          pendingLocalImport = { filePath: selectedFile, format }
          return { ...conflict, name: buildName, description: manifest.description, source: "curseforge" }
        }
        pendingLocalImport = null
        sendImportProgress(0, 100, "import.phase.preparing", undefined, { operation: "modpack", source: "curseforge", title: buildName })
        const intentPath = await ensureBuildIntentDir(buildName)
        installation = await prepareModpackInstall(intentPath, signal)
        const stagingPath = installation.directory
        const version: string = manifest.minecraft?.version ?? ""
        const loaderRaw: string = manifest.minecraft?.modLoaders?.find((m: CurseForgeManifestFile) => m.primary)?.id ?? ""
        const loaderSelection = getLoaderSelectionFromCurseManifest(loaderRaw)
        let modLoader = loaderSelection.modLoader
        const loaderVersion = loaderSelection.loaderVersion
        if (loaderRaw.startsWith("fabric")) {
          modLoader = "fabric"
          sendImportProgress(0, 100, "import.phase.preparing")
        } else if (loaderRaw.startsWith("quilt")) {
          modLoader = "quilt"
          sendImportProgress(0, 100, "import.phase.preparing")
        }

        const modsDir = path.join(stagingPath, "mods")
        await fs.mkdir(modsDir, { recursive: true }).catch(() => {})

        const files: { projectID: number; fileID: number }[] = manifest.files ?? []
        const totalFiles = files.length
        let downloaded = 0
        const downloadPercent = () => Math.round((downloaded / Math.max(totalFiles, 1)) * 90)
        sendImportProgress(0, 100, "import.phase.files")

        // Пакетное получение ссылок на скачивание всех файлов сборки (POST /v1/mods/files)
        const fileIds = files.map((f) => f.fileID).filter(Boolean)
        const claimFile = installation.claimFile
        let filesBatch: Record<number, { downloadUrl: string; fileName: string; fileLength?: number; sha1?: string }> = {}
        try {
          const mods = await loadModsModule()
          filesBatch = await mods.curseforgeGetFiles(fileIds)
        } catch (err) {
          console.warn("[curseforge-import] Batch files lookup failed, using fallback:", err)
        }

        sendImportProgress(0, 100, "import.phase.files")
        const tasks = files.map((f: CurseForgeManifestFile) => async () => {
          const batchInfo = filesBatch[f.fileID!]
          let fileUrl: string | null = batchInfo?.downloadUrl ?? null
          let fileName = batchInfo?.fileName || `mod-${f.fileID}.jar`

          try {
            const mods = await loadModsModule()
            if (!fileUrl) {
              fileUrl = await mods.curseforgeGetDownloadUrl(f.projectID!, f.fileID!)
              if (fileUrl) {
                fileName = fileUrl.split("/").pop()?.split("?")[0] ?? fileName
              }
            }
            if (!fileUrl) throw new Error(t("runtime.import.noUrl", { file: fileName }))

            const filePath = await resolveSafeIntentFilePath(stagingPath, `mods/${sanitizeFileName(fileName)}`)
            claimFile(`mods/${sanitizeFileName(fileName)}`)
            try { await fs.access(filePath) } catch {
              await writeModpackDownload(filePath, await downloadBuffer(fileUrl, signal, fileName), { sha1: batchInfo?.sha1, size: batchInfo?.fileLength })
            }
          } catch (error) {
            if (isImportCancelledError(error)) {
              throw error
            }
            const message = toErrorMessage(error)
            throw new Error(t("runtime.import.downloadFailed", { file: fileName, message }))
          }
          downloaded++
          sendImportProgress(downloadPercent(), 100, "import.phase.files")
        })
        const progressFiles = await describeCurseforgeImportFiles(files, filesBatch, signal)
        await runConcurrent(withImportFileProgress(tasks, progressFiles, signal), 5, signal)
        throwIfImportCancelled(signal)
        sendImportProgress(92, 100, "import.phase.extracting")
        await copyOverrideEntries(selectedFile, stagingPath)
        const scanned = await installation.apply(() => scanIntentDir(intentPath, (done, total) => {
          const fraction = total > 0 ? done / total : 1
          sendImportProgress(Math.min(99, Math.round(92 + fraction * 7)), 100, "import.phase.scanning")
        }, signal))

        let cfIcon = ""
        try {
          const mods = await loadModsModule()
          const cfSearch = await mods.curseforgeSearch(buildName, { page: 0 })
          cfIcon = cfSearch.results?.[0]?.iconUrl ?? ""
        } catch {}

        sendImportProgress(100, 100, "import.phase.complete")
        return {
          success: true,
          name: buildName,
          description: manifest.summary ?? manifest.author ?? "",
          icon: cfIcon,
          version,
          modLoader,
          loaderVersion,
          source: "curseforge",
          intentPath,
          ...scanned,
        }
      }

      return { success: false, error: t("runtime.import.unknownFormat") }
    } catch (e) {
      if (signal.aborted || isImportCancelledError(e)) {
        return { success: false, cancelled: true, error: t("import.cancelledTitle") }
      }
      return modpackFailure(e, t)
    } finally {
      try { await installation?.close() } finally { finishImportSession(signal) }
    }
  })
}

/**
 * Имя записи корзины — только простое имя каталога (basename): без
 * разделителей пути, «.»/«..», нулевых байтов и вложенности. Нужно, чтобы
 * `${trashName}.json` и `path.resolve(trashRoot, trashName)` не выходили
 * за пределы `.trash`.
 */
function isSafeTrashEntryName(trashName: unknown): trashName is string {
  if (typeof trashName !== "string") return false
  if (!trashName || trashName === "." || trashName === "..") return false
  if (/[<>:"/\\|?*\u0000-\u001F]/.test(trashName) || /[. ]$/.test(trashName)) return false
  return path.basename(trashName) === trashName
}

export async function restoreBuildFromTrash(dirName: string, trashName: string): Promise<{ success: boolean; build?: Record<string, unknown>; error?: string }> {
  const t = await getMainTranslator()
  try {
    const baseDataRoot = getInstancesRoot()
    const safeName = getBuildIntentDirName(dirName)
    const trashRoot = path.join(baseDataRoot, "intents", ".trash")
    // trashName приходит из renderer/агента, то есть в конечном счёте от модели:
    // «..\..\..» увёл бы восстановление за пределы корзины и позволил бы
    // переместить (а при коллизии — скопировать и удалить) произвольный каталог.
    if (!isSafeTrashEntryName(trashName)) {
      return { success: false, error: t("runtime.build.invalidTrash") }
    }
    // Вторая линия защиты: итоговый путь обязан остаться внутри trashRoot.
    const trashPath = path.resolve(trashRoot, trashName)
    const normalizedTrashRoot = `${path.resolve(trashRoot)}${path.sep}`
    if (!trashPath.startsWith(normalizedTrashRoot)) {
      return { success: false, error: t("runtime.build.invalidTrash") }
    }
    await fs.access(trashPath)
    const intentPath = path.join(baseDataRoot, "intents", safeName)
    if (await fs.access(intentPath).then(() => true).catch(() => false)) {
      return { success: false, error: t("builds.errors.duplicateName") }
    }
    await fs.mkdir(path.dirname(intentPath), { recursive: true })
    // Корзина и назначение находятся в одной файловой системе. Не копируем
    // поверх существующей сборки: rename сохраняет атомарность, а коллизия
    // оставляет исходник в корзине.
    await fs.rename(trashPath, intentPath)

    let build: Record<string, unknown> | undefined
    const snapshotPath = path.join(trashRoot, `${trashName}.json`)
    try {
      const raw = await fs.readFile(snapshotPath, "utf-8")
      const parsed = JSON.parse(raw)
      if (parsed && typeof parsed === "object") build = parsed as Record<string, unknown>
    } catch { /* снапшота может не быть у старых записей корзины */ }

    if (build && typeof build.id === "string" && typeof build.name === "string") {
      build.intentPath = intentPath
      try {
        const existing = await dbHelpers.findBuildById(build.id)
        if (!existing) {
          await dbHelpers.insertBuild(build as Parameters<typeof dbHelpers.insertBuild>[0])
        }
      } catch (error) {
        try { await fs.rename(intentPath, trashPath) }
        catch (rollbackError) { throw new AggregateError([error, rollbackError], "Build restore rollback failed; files and snapshot retained") }
        throw error
      }
    }

    await fs.rm(snapshotPath, { force: true }).catch(() => {})

    notifyStatsUpdated()
    return { success: true, build }
  } catch (error) {
    if (error instanceof Error && "code" in error && (error as NodeJS.ErrnoException).code === "ENOENT") {
      return { success: true }
    }
    return opFailure(error)
  }
}

export async function listBuildTrash(): Promise<Array<{ trashName: string; originalName: string; trashedAt: number; icon?: string; modLoader?: string }>> {
  try {
    const trashRoot = path.join(getInstancesRoot(), "intents", ".trash")
    const entries = await fs.readdir(trashRoot, { withFileTypes: true }).catch(() => [])
    const items: Array<{ trashName: string; originalName: string; trashedAt: number; icon?: string; modLoader?: string }> = []
    for (const entry of entries) {
      if (!entry.isDirectory()) continue
      const match = entry.name.match(/^(\d+)-(.+)$/)
      if (!match) continue
      const snapshot = await readTrashSnapshot(entry.name)
      items.push({
        trashName: entry.name,
        originalName: snapshot?.name ?? match[2],
        trashedAt: Number(match[1]),
        icon: snapshot?.icon,
        modLoader: snapshot?.modLoader,
      })
    }
    return items
  } catch {
    return []
  }
}
