import { toErrorMessage, opFailure } from "../errors"
import { app, dialog, ipcMain } from "electron"
import path from "path"
import fs from "fs/promises"
import type {
  ModrinthVersionDetail,
  ModrinthManifestFile,
  CurseForgeManifestFile,
  FTBModpackVersionManifest,
  FTBFile,
} from "@xnlc/mods" with { "resolution-mode": "import" }
import type { BuildExportCategory, BuildContentUpdates, UpdateChannel, ModpackImportConflict, ModpackImportResult } from "@xnlc/types" with { "resolution-mode": "import" }
import { getMainWindow, logRuntime, sendToRenderer } from "../runtime"
import { getGameDir } from "../minecraft-core"
import { dbHelpers } from "../../db"
import { notifyStatsUpdated } from "../stats"
import { readContentMetadataFromPath, type ModMetadata } from "./metadata"
import { classifyContentDropPaths, type ContentDropClassification, type ContentDropKind } from "./content-drop"
import {
  ensureBuildIntentDir,
  getBuildIntentDirName,
  getBuildIntentPath,
  getBaseDataRoot,
  getInstancesRoot,
  loadInstancesRoot,
  downloadBuffer,
  sanitizeFileName,
  sanitizeRelativeContentPath,
  getContentDirectoryName,
  saveRemoteContentToIntent,
  saveLocalContentToIntent,
  deleteContentFromIntent,
  setContentEnabledInIntent,
  sendImportProgress,
  runConcurrent,
  copyOverrideEntries,
  cleanPackManagedContent,
  loadAdmZip,
  loadModsModule,
  isImportCancelledError,
  throwIfImportCancelled,
  startImportSession,
  finishImportSession,
  cancelImport,
  getLoaderSelectionFromModrinthDeps,
  getLoaderSelectionFromModrinthLoaders,
  getLoaderSelectionFromCurseManifest,
  type ScannedBuildContent,
  type ImportModEntry,
} from "./helpers"
import { scanIntentDir } from "./scanner"
import { readTrashSnapshot } from "./trash-meta"
import { collectMissingFiles, downloadMissingModFiles, readMissingModsConfig } from "./missing-mods"
import { checkContentUpdates, dismissContentUpdate, readUpdatesCache, readUpdatesCounts } from "./update-checker"
import { pruneStaleLoaderProfiles, type LoaderPruneResult } from "./loader-profiles"

export { ensureBuildIntentDir, getBuildIntentDirName, getBuildIntentPath, scanIntentDir }

/**
 * Файл, выбранный для локального импорта модпака, если импорт был остановлен
 * из-за конфликта имён. Позволяет продолжить установку без повторного выбора файла.
 */
let pendingLocalImport: { filePath: string } | null = null

/**
 * Догружает «core»-файлы, которые пак требует через мод Missing Mods Checker:
 * в `.mrpack` их нет (Modrinth не распространяет), но есть ссылки на CurseForge.
 * Без этого игра открывала окно мода и ждала пользователя — выглядело как
 * зависший запуск.
 */
export async function fetchMissingPackMods(intentPath: string, signal?: AbortSignal): Promise<{ downloaded: number; failed: number; missing: number }> {
  const entries = readMissingModsConfig(intentPath)
  if (entries.length === 0) return { downloaded: 0, failed: 0, missing: 0 }
  const missing = collectMissingFiles(intentPath, entries)
  if (missing.length === 0) return { downloaded: 0, failed: 0, missing: 0 }

  sendImportProgress(95, 100, `Докачивание обязательных модов (0/${missing.length})...`)
  const result = await downloadMissingModFiles(intentPath, missing, {
    signal,
    onProgress: (done, total, current) => {
      sendImportProgress(95, 100, `Докачивание обязательных модов (${done}/${total}): ${current}`)
    },
    loadModsModule: async () => (await loadModsModule()) as never,
  })
  logRuntime(`[modpack] Обязательные файлы: докачано ${result.downloaded}, ошибок ${result.failed} из ${missing.length}`)
  return { downloaded: result.downloaded, failed: result.failed, missing: missing.length }
}

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

function entryTopName(filename: string, buildDirName: string): string {
  const segments = filename.split("/").filter(Boolean)
  const isSelf = segments[0] === buildDirName || segments[0] === path.basename(buildDirName)
  const index = isSelf ? 1 : 0
  return segments[index] ?? ""
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

function matchExportCategory(filename: string, buildDirName: string, categories: BuildExportCategory[]): boolean {
  const topName = entryTopName(filename, buildDirName)
  if (!topName) return false
  return categories.includes(entryCategory(topName))
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
  name?: string
  description?: string
  icon?: string
  source?: "modrinth" | "curseforge" | "local"
  intentPath?: string
}

export function registerBuildHandlers() {
  ipcMain.handle("build:check-content-updates", async (_event, buildId: string, channel?: UpdateChannel): Promise<BuildContentUpdates> => {
    try {
      return await checkContentUpdates(buildId, channel ?? "release")
    } catch (error) {
      console.error("[Updates] Content update check failed:", error)
      return { buildId, channel: channel ?? "release", checkedAt: Date.now(), updates: [] }
    }
  })

  ipcMain.handle("build:get-content-updates-cache", async (): Promise<Record<string, BuildContentUpdates>> => {
    return readUpdatesCache()
  })

  // Бейджи в списке сборок и на вкладках нуждаются только в количестве
  // обновлений. Полный кэш — это мегабайты (иконки модов) и его передача в
  // renderer на каждое изменение списка сборок стоила дороже самой проверки.
  ipcMain.handle("build:get-content-updates-counts", async (): Promise<Record<string, { mods: number; resourcepacks: number; shaders: number }>> => {
    return readUpdatesCounts()
  })

  ipcMain.handle("build:dismiss-content-update", async (_event, buildId: string, itemId: string): Promise<void> => {
    return dismissContentUpdate(buildId, itemId)
  })

  ipcMain.handle("build:cancel-import", async (): Promise<{ success: boolean }> => {
    return { success: cancelImport() }
  })

  ipcMain.handle("build:get-intent-path", async (_event, dirNameOrPath: string): Promise<string> => {
    if (path.isAbsolute(dirNameOrPath)) {
      await fs.mkdir(dirNameOrPath, { recursive: true }).catch(() => {})
      return dirNameOrPath
    }
    return ensureBuildIntentDir(dirNameOrPath)
  })

  ipcMain.handle("build:get-instances-root", async (): Promise<string> => getInstancesRoot())

  ipcMain.handle("build:set-instances-root", async (_event, newRoot: string): Promise<{ success: boolean; root?: string; error?: string }> => {
    try {
      const trimmed = (newRoot ?? "").trim()
      if (!trimmed) {
        await dbHelpers.setSetting("instancesPath", "")
        await loadInstancesRoot()
        return { success: true, root: getInstancesRoot() }
      }
      const absRoot = path.resolve(trimmed)
      await fs.mkdir(absRoot, { recursive: true })
      // If the default location still holds the intents folder, move it over so builds are preserved.
      const defaultIntents = path.join(getBaseDataRoot(), "intents")
      const targetIntents = path.join(absRoot, "intents")
      try {
        await fs.access(defaultIntents)
        await fs.access(targetIntents).catch(async () => {
          await fs.rename(defaultIntents, targetIntents)
        })
      } catch {}
      await dbHelpers.setSetting("instancesPath", absRoot)
      await loadInstancesRoot()
      return { success: true, root: getInstancesRoot() }
    } catch (error) {
      return opFailure(error)
    }
  })

  ipcMain.handle("build:save-mod-to-intent", async (_event, dirName: string, url: string, fileName: string): Promise<string | null> => {
    return await saveRemoteContentToIntent(dirName, "mod", url, fileName)
  })

  ipcMain.handle("build:save-local-mod-to-intent", async (_event, dirName: string, localFilePath: string): Promise<string | null> => {
    return saveLocalContentToIntent(dirName, "mod", localFilePath)
  })

  // Метаданные локального файла (fabric.mod.json / mods.toml / pack.mcmeta /
  // shaders.properties): нужны, чтобы мод, брошенный в панель, появлялся в списке
  // со своим именем, версией и автором, а не с именем файла.
  ipcMain.handle("build:read-local-content-metadata", async (_event, localFilePath: string): Promise<ModMetadata | null> => {
    try {
      return await readContentMetadataFromPath(localFilePath)
    } catch (error) {
      logRuntime(`[Builds] Failed to read metadata from ${localFilePath}: ${toErrorMessage(error)}`)
      return null
    }
  })

  // Разбор того, что перетащили в панель: что можно принять, а что нет и почему.
  // Решение принимает main, потому что только он видит, папка это или файл.
  ipcMain.handle("build:classify-drop-paths", async (_event, paths: string[], kind: ContentDropKind): Promise<ContentDropClassification> => {
    return classifyContentDropPaths(paths ?? [], kind)
  })

  ipcMain.handle("build:save-content-to-intent", async (_event, dirName: string, contentType: "mod" | "resourcepack" | "shader", url: string, fileName: string): Promise<string | null> => {
    return await saveRemoteContentToIntent(dirName, contentType, url, fileName)
  })

  ipcMain.handle("build:save-local-content-to-intent", async (_event, dirName: string, contentType: "mod" | "resourcepack" | "shader", localFilePath: string): Promise<string | null> => {
    return saveLocalContentToIntent(dirName, contentType, localFilePath)
  })

  ipcMain.handle("build:delete-content-from-intent", async (_event, dirName: string, contentType: "mod" | "resourcepack" | "shader", fileName: string): Promise<{ success: boolean; error?: string }> => {
    return deleteContentFromIntent(dirName, contentType, fileName)
  })

  ipcMain.handle("build:set-content-enabled", async (_event, dirName: string, contentType: "mod" | "resourcepack" | "shader", fileName: string, enabled: boolean): Promise<{ success: boolean; fileName?: string; error?: string }> => {
    return setContentEnabledInIntent(dirName, contentType, fileName, enabled)
  })

  ipcMain.handle("build:set-intent-path", async (_event, dirName: string): Promise<void> => {
    await ensureBuildIntentDir(dirName)
  })

  // Смена загрузчика/его версии в сборке: убираем профили старых загрузчиков из
  // <intent>/versions, иначе на следующем запуске они конфликтуют с новым.
  ipcMain.handle("build:prune-loader-profiles", async (_event, dirName: string, modLoader?: string, loaderVersion?: string): Promise<LoaderPruneResult> => {
    try {
      return pruneStaleLoaderProfiles(getBuildIntentPath(dirName), modLoader, loaderVersion)
    } catch (error) {
      logRuntime(`[Builds] Failed to prune stale loader profiles for ${dirName}: ${toErrorMessage(error)}`)
      return { removed: [], kept: [] }
    }
  })

  ipcMain.handle("build:rename-intent", async (_event, oldName: string, newName: string): Promise<{ success: boolean; intentPath?: string; error?: string }> => {
    try {
      const baseDataRoot = getInstancesRoot()
      const oldSafeName = getBuildIntentDirName(oldName)
      const newSafeName = getBuildIntentDirName(newName)
      const oldIntentPath = path.join(baseDataRoot, "intents", oldSafeName)
      const newIntentPath = path.join(baseDataRoot, "intents", newSafeName)
      if (oldIntentPath === newIntentPath) return { success: true, intentPath: newIntentPath }
      // Nothing to rename if the source dir doesn't exist yet (not launched).
      const srcExists = await fs.access(oldIntentPath).then(() => true).catch(() => false)
      if (!srcExists) return { success: true, intentPath: newIntentPath }
      const dstExists = await fs.access(newIntentPath).then(() => true).catch(() => false)
      if (dstExists) return { success: false, error: "Папка сборки с таким именем уже существует" }
      await fs.rename(oldIntentPath, newIntentPath).catch(async () => {
        await fs.cp(oldIntentPath, newIntentPath, { recursive: true, verbatimSymlinks: true })
        await fs.rm(oldIntentPath, { recursive: true, force: true })
      })
      return { success: true, intentPath: newIntentPath }
    } catch (error) {
      return opFailure(error)
    }
  })

  ipcMain.handle("build:delete-intent", async (_event, dirName: string): Promise<{ success: boolean; error?: string }> => {
    try {
      const baseDataRoot = getInstancesRoot()
      const safeName = getBuildIntentDirName(dirName)
      const intentPath = path.join(baseDataRoot, "intents", safeName)
      try { await fs.access(intentPath); await fs.rm(intentPath, { recursive: true, force: true }) } catch {}

      // Clean up stats sessions and notify
      await clearBuildSessionsForDir(dirName)
      notifyStatsUpdated()

      return { success: true }
    } catch (error) {
      return opFailure(error)
    }
  })

  ipcMain.handle("build:move-intent-to-trash", async (_event, dirName: string, metadata?: Record<string, unknown>): Promise<{ success: boolean; trashName?: string; error?: string }> => {
    try {
      const baseDataRoot = getInstancesRoot()
      const safeName = getBuildIntentDirName(dirName)
      const intentPath = path.join(baseDataRoot, "intents", safeName)
      await fs.access(intentPath)
      const trashRoot = path.join(baseDataRoot, "intents", ".trash")
      await fs.mkdir(trashRoot, { recursive: true })
      const trashName = `${Date.now()}-${safeName}`
      const trashedPath = path.join(trashRoot, trashName)
      await fs.rename(intentPath, trashedPath).catch(async () => {
        await fs.cp(intentPath, trashedPath, { recursive: true, verbatimSymlinks: true })
        await fs.rm(intentPath, { recursive: true, force: true })
      })

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

  ipcMain.handle("build:restore-intent-from-trash", async (_event, dirName: string, trashName: string): Promise<{ success: boolean; build?: Record<string, unknown>; error?: string }> => {
    try {
      const baseDataRoot = getInstancesRoot()
      const safeName = getBuildIntentDirName(dirName)
      const trashRoot = path.join(baseDataRoot, "intents", ".trash")
      const trashPath = path.join(trashRoot, trashName)
      await fs.access(trashPath)
      const intentPath = path.join(baseDataRoot, "intents", safeName)
      await fs.mkdir(path.dirname(intentPath), { recursive: true })
      await fs.rename(trashPath, intentPath).catch(async () => {
        await fs.cp(trashPath, intentPath, { recursive: true, verbatimSymlinks: true })
        await fs.rm(trashPath, { recursive: true, force: true })
      })

      // Возвращаем сохранённые при отправке в корзину метаданные, чтобы вызывающая
      // сторона могла восстановить запись сборки в БД и в UI без перезапуска.
      let build: Record<string, unknown> | undefined
      const snapshotPath = path.join(trashRoot, `${trashName}.json`)
      try {
        const raw = await fs.readFile(snapshotPath, "utf-8")
        const parsed = JSON.parse(raw)
        if (parsed && typeof parsed === "object") build = parsed as Record<string, unknown>
        await fs.rm(snapshotPath, { force: true })
      } catch { /* снапшота может не быть у старых записей корзины */ }

      // Запись в БД удаляется при отправке в корзину, поэтому восстанавливаем её
      // здесь же из снапшота — иначе сборка вернулась бы только в UI и пропала
      // при следующем reloadBuilds (список читается из БД).
      if (build && typeof build.id === "string" && typeof build.name === "string") {
        // Путь в снапшоте мог быть записан до переименования папок — берём текущий.
        build.intentPath = intentPath
        try {
          const existing = await dbHelpers.loadBuildsLight()
          if (!existing.some((item) => item.id === build!.id)) {
            await dbHelpers.saveAllBuilds([build as never, ...(existing as never[])])
          }
        } catch { /* запись восстановит вызывающая сторона */ }
      }

      // Сборка вернулась в БД: статистика снова должна брать имя и иконку из неё,
      // а не из снапшота корзины (снапшот уже удалён выше).
      notifyStatsUpdated()

      return { success: true, build }
    } catch (error) {
      if (error instanceof Error && "code" in error && (error as NodeJS.ErrnoException).code === "ENOENT") {
        return { success: true }
      }
      return opFailure(error)
    }
  })

  ipcMain.handle("build:purge-trash", async (): Promise<{ success: boolean; error?: string }> => {
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

  ipcMain.handle("build:list-trash", async (): Promise<Array<{ trashName: string; originalName: string; trashedAt: number; icon?: string; modLoader?: string }>> => {
    try {
      const trashRoot = path.join(getInstancesRoot(), "intents", ".trash")
      const entries = await fs.readdir(trashRoot, { withFileTypes: true }).catch(() => [])
      const items: Array<{ trashName: string; originalName: string; trashedAt: number; icon?: string; modLoader?: string }> = []
      for (const entry of entries) {
        if (!entry.isDirectory()) continue
        const match = entry.name.match(/^(\d+)-(.+)$/)
        if (!match) continue
        // Имя, иконка и загрузчик сборки живут в снапшоте метаданных рядом с папкой
        // в корзине (`<trashName>.json`): имя папки санитизировано, поэтому в списке
        // корзины показывалось бы `Prominence_ II_ ...` вместо настоящего имени, а
        // без загрузчика не рисовалась бы плашка-заглушка как в списке сборок.
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
  })

  ipcMain.handle("build:delete-trash-item", async (_event, trashName: string): Promise<{ success: boolean; error?: string }> => {
    try {
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

  ipcMain.handle("build:copy", async (_event, dirName: string, newName: string): Promise<{ success: boolean; intentPath?: string; error?: string }> => {
    try {
      const srcIntentPath = await ensureBuildIntentDir(dirName)
      const newIntentPath = await ensureBuildIntentDir(newName)
      // Remove any pre-existing (empty) target dirs first, then deep-copy the source.
      await fs.rm(newIntentPath, { recursive: true, force: true }).catch(() => {})
      await fs.cp(srcIntentPath, newIntentPath, { recursive: true, verbatimSymlinks: true })
      return { success: true, intentPath: newIntentPath }
    } catch (error) {
      return opFailure(error)
    }
  })

  ipcMain.handle("build:export-zip", async (_event, dirName: string, buildNameLabel: string, categories?: BuildExportCategory[]): Promise<{ success: boolean; path?: string; error?: string }> => {
    try {
      const win = getMainWindow()
      if (!win) return { success: false, error: "Окно недоступно" }
      const intentPath = await ensureBuildIntentDir(dirName)
      const picked = await dialog.showSaveDialog(win, {
        title: "Экспорт сборки",
        defaultPath: `${sanitizeFileName(buildNameLabel || dirName)}.zip`,
        filters: [{ name: "Zip архив", extensions: ["zip"] }],
      })
      if (picked.canceled || !picked.filePath) return { success: false, error: "Экспорт отменён" }

      const AdmZip = await loadAdmZip()
      const zip = new AdmZip()

      // Prism Launcher excludes logs, crash-reports and caches when exporting (ExportInstanceDialog.cpp).
      const LOG_ENTRIES = new Set(["logs", "crash-reports", ".cache", ".fabric", ".quilt"])
      // Shared game files are reconstructed from the build's version metadata on
      // import — and they're junctions to a shared cache, so they must never be zipped.
      const SHARED_GAME_ENTRIES = new Set(["versions", "libraries", "assets"])
      const includeLogs = categories == null || categories.includes("logs")

      // `addLocalFolder` passes full zip paths like `<build>/<relative path>`; we need the
      // top-level entry name (the first segment after the build folder) to decide inclusion.
      const buildDirName = path.basename(intentPath)
      const filter = (filename: string) => {
        const topName = entryTopName(filename, buildDirName)
        if (categories == null) {
          return !LOG_ENTRIES.has(topName) && !SHARED_GAME_ENTRIES.has(topName)
        }
        return matchExportCategory(filename, buildDirName, categories) && !SHARED_GAME_ENTRIES.has(topName)
      }

      // Асинхронно: синхронные addLocalFolder/toBuffer морозили main-процесс на весь
      // объём сборки (event loop не тикал вообще), и лаунчер выглядел зависшим.
      // Вариант ...Async2 в adm-zip 0.6.0 сломан (дублирует путь), берём addLocalFolderAsync.
      await new Promise<void>((resolve, reject) => {
        zip.addLocalFolderAsync(
          intentPath,
          (_result, errorMessage) => errorMessage ? reject(new Error(errorMessage)) : resolve(),
          buildDirName,
          filter,
        )
      })

      // Манифест в корне делает архив самодостаточным: при импорте из него
      // берутся версия, загрузчик и иконка сборки. Достаточно лёгких полей.
      const buildRow = (await dbHelpers.loadBuildsLight()).find((b) => b.name === dirName)
      zip.addFile("xnlauncher.json", Buffer.from(JSON.stringify({
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
      }, null, 2), "utf-8"))

      const totalEntries = zip.getEntries().length
      let packed = 0
      const buffer = await new Promise<Buffer>((resolve, reject) => {
        zip.toBuffer(
          (data: Buffer) => resolve(data),
          (error: Error) => reject(error),
          () => {
            packed++
            if (packed === 1 || packed % 5 === 0 || packed === totalEntries) {
              sendToRenderer("build:export-progress", { current: packed, total: totalEntries })
            }
          },
        )
      })
      await fs.writeFile(picked.filePath, buffer)
      return { success: true, path: picked.filePath }
    } catch (error) {
      return opFailure(error)
    }
  })

  ipcMain.handle("build:export-modlist", async (_event, dirName: string, buildNameLabel: string, format: "html" | "markdown" | "json" | "csv" | "plaintext"): Promise<{ success: boolean; path?: string; error?: string }> => {
    try {
      const win = getMainWindow()
      if (!win) return { success: false, error: "Окно недоступно" }
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
        title: "Экспорт списка модов",
        defaultPath: `${sanitizeFileName(label)}-mods.${extMap[format] ?? "txt"}`,
        filters: [{ name: "Файл", extensions: [extMap[format] ?? "txt"] }],
      })
      if (picked.canceled || !picked.filePath) return { success: false, error: "Экспорт отменён" }

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

  ipcMain.handle("build:scan-intent-content", async (_event, dirNameOrPath: string): Promise<ScannedBuildContent> => {
    try {
      const intentPath = path.isAbsolute(dirNameOrPath)
        ? dirNameOrPath
        : await ensureBuildIntentDir(dirNameOrPath)
      return await scanIntentDir(intentPath)
    } catch {
      return { mods: [], resourcepacks: [], shaders: [], installedMods: {} }
    }
  })

  // Ручной запуск докачивания «core»-файлов пака (Missing Mods Checker).
  ipcMain.handle("build:fetch-missing-mods", async (_event, buildName: string) => {
    try {
      const intentPath = await ensureBuildIntentDir(buildName)
      return { success: true as const, ...(await fetchMissingPackMods(intentPath)) }
    } catch (error) {
      return { success: false as const, error: toErrorMessage(error) }
    }
  })

  ipcMain.handle(
    "content:install-remote",
    async (_event, contentType: "mod" | "resourcepack" | "shader", url: string, fileName: string): Promise<{ success: boolean; filePath?: string; error?: string }> => {
      try {
        const gameDir = await getGameDir()
        const targetDir = path.join(gameDir, getContentDirectoryName(contentType))
        await fs.mkdir(targetDir, { recursive: true }).catch(() => {})
        const safeFileName = sanitizeFileName(fileName)
        const filePath = path.join(targetDir, safeFileName)
        await fs.writeFile(filePath, await downloadBuffer(url))
        return { success: true, filePath }
      } catch (error) {
        return opFailure(error)
      }
    },
  )

  ipcMain.handle("build:import-modrinth", async (_event, buildName: string, projectSlug: string, versionId?: string, targetBuildId?: string): Promise<ImportResult> => {
    const signal = startImportSession()
    try {
      const conflict = await guardAgainstOverwrite(buildName, { source: "modrinth", projectSlug }, targetBuildId)
      if (conflict) return conflict
      const intentPath = await ensureBuildIntentDir(buildName)
      sendImportProgress(0, 100, "Получение версий...")
      const mods = await loadModsModule()
      const versions = await mods.modrinthGetRawVersions(projectSlug)
      throwIfImportCancelled(signal)

      let version: ModrinthVersionDetail | undefined = versionId ? versions.find((v) => v.id === versionId) : undefined
      if (!version) version = versions.find((v) => v.version_type === "release") ?? versions[0]
      if (!version) throw new Error("Версии не найдены")

      const mrpackFile = version.files?.find((f: { filename?: string }) => f.filename?.endsWith(".mrpack"))
      if (!mrpackFile) throw new Error(".mrpack файл не найден")

      if (!mrpackFile?.url) throw new Error("URL для .mrpack файла не найден")
      sendImportProgress(0, 100, "Скачивание пакета...")
      const AdmZip = await loadAdmZip()
      const zip = new AdmZip(await downloadBuffer(mrpackFile.url, signal, mrpackFile.filename || "modpack.mrpack"))
      const indexEntry = zip.getEntry("modrinth.index.json")
      if (!indexEntry) throw new Error("modrinth.index.json не найден")
      const index = JSON.parse(indexEntry.getData().toString("utf-8"))
      throwIfImportCancelled(signal)

      // Полностью убираем файлы предыдущей версии сборки, чтобы не было дублей
      sendImportProgress(0, 100, "Очистка файлов предыдущей версии...")
      await cleanPackManagedContent(intentPath)

      const files: ModrinthManifestFile[] = (index.files as ModrinthManifestFile[] ?? []).filter((f) => f.env?.client !== "unsupported")
      const gameVersion: string = version.game_versions?.[0] ?? index.dependencies?.minecraft ?? ""
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
        sendImportProgress(0, 100, "Установка Fabric...")
      } else if (deps["quilt-loader"]) {
        modLoader = "quilt"
        sendImportProgress(0, 100, "Установка Quilt...")
      }

      let downloaded = 0
      const totalFiles = files.length
      // Скачивание занимает первые 90% шкалы, распаковка и сканирование — остаток,
      // чтобы прогресс не «замирал» на 100% во время финальной обработки.
      const downloadPercent = () => Math.round((downloaded / Math.max(totalFiles, 1)) * 90)
      sendImportProgress(0, 100, `Скачивание ${totalFiles} файлов...`)
      const tasks = files.map((f: ModrinthManifestFile) => async () => {
        const currentFileName = path.basename(f.path ?? "")
        try {
          throwIfImportCancelled(signal)
          const fileDir = path.join(intentPath, path.dirname(f.path ?? ""))
          const filePath = path.join(fileDir, currentFileName)
          await fs.mkdir(fileDir, { recursive: true }).catch(() => {})
          try { await fs.access(filePath) } catch {
            const url = f.downloads?.[0]
            if (!url) throw new Error(`Не найдена ссылка для ${currentFileName}`)
            await fs.writeFile(filePath, await downloadBuffer(url, signal, currentFileName))
          }
        } catch (error) {
          if (isImportCancelledError(error)) {
            throw error
          }
          const message = toErrorMessage(error)
          throw new Error(`Не удалось скачать ${currentFileName}: ${message}`)
        } finally {
          downloaded++
          sendImportProgress(downloadPercent(), 100, `${downloaded}/${totalFiles} файлов`)
        }
      })
      await runConcurrent(tasks, 5, signal)
      throwIfImportCancelled(signal)
      sendImportProgress(92, 100, "Распаковка файлов сборки...")
      await copyOverrideEntries(zip, intentPath)
      await fetchMissingPackMods(intentPath, signal)
      const scanned = await scanIntentDir(intentPath, (done, total) => {
        const fraction = total > 0 ? done / total : 1
        sendImportProgress(Math.min(99, Math.round(92 + fraction * 7)), 100, `Сканирование сборки (${done}/${total})...`)
      })
      sendImportProgress(100, 100, "Готово!")
      return { success: true, version: gameVersion, modLoader, loaderVersion, modpackVersion: version.name ?? version.version_number ?? version.id, modpackVersionId: version.id, ...scanned }
    } catch (e) {
      if (isImportCancelledError(e)) {
        return { success: false, cancelled: true, error: "Импорт отменен" }
      }
      return opFailure(e)
    } finally {
      finishImportSession(signal)
    }
  })

  ipcMain.handle("build:import-curseforge", async (_event, buildName: string, modId: number, fileId: number, targetBuildId?: string): Promise<ImportResult> => {
    const signal = startImportSession()
    try {
      const conflict = await guardAgainstOverwrite(buildName, { source: "curseforge", modId }, targetBuildId)
      if (conflict) return conflict
      const intentPath = await ensureBuildIntentDir(buildName)
      sendImportProgress(0, 100, "Получение ссылки...")
      const mods = await loadModsModule()
      const zipUrl = await mods.curseforgeGetDownloadUrl(modId, fileId)
      throwIfImportCancelled(signal)
      if (!zipUrl) throw new Error("Ссылка на скачивание недоступна")

      sendImportProgress(0, 100, "Скачивание пакета...")
      const AdmZip = await loadAdmZip()
      const zip = new AdmZip(await downloadBuffer(zipUrl, signal, "curseforge-modpack.zip"))
      const manifestEntry = zip.getEntry("manifest.json")
      if (!manifestEntry) throw new Error("manifest.json не найден")
      const manifest = JSON.parse(manifestEntry.getData().toString("utf-8"))
      throwIfImportCancelled(signal)

      const mcVersion: string = manifest.minecraft?.version ?? ""
      const loaderRaw: string = manifest.minecraft?.modLoaders?.find((m: CurseForgeManifestFile) => m.primary)?.id ?? ""
      const loaderSelection = getLoaderSelectionFromCurseManifest(loaderRaw)
      let modLoader = loaderSelection.modLoader
      const loaderVersion = loaderSelection.loaderVersion
      if (loaderRaw.startsWith("fabric")) modLoader = "fabric"
      else if (loaderRaw.startsWith("quilt")) {
        modLoader = "quilt"
        sendImportProgress(0, 100, "Установка Quilt...")
      }

      // Полностью убираем файлы предыдущей версии сборки, чтобы не было дублей
      sendImportProgress(0, 100, "Очистка файлов предыдущей версии...")
      await cleanPackManagedContent(intentPath)

      const modsDir = path.join(intentPath, "mods")
      await fs.mkdir(modsDir, { recursive: true }).catch(() => {})
      const files: { projectID: number; fileID: number }[] = manifest.files ?? []
      const totalFiles = files.length
      let downloaded = 0
      const downloadPercent = () => Math.round((downloaded / Math.max(totalFiles, 1)) * 90)
      sendImportProgress(0, 100, `Подготовка ${totalFiles} модов...`)

      // Пакетное получение ссылок на скачивание всех файлов сборки (POST /v1/mods/files)
      const fileIds = files.map((f) => f.fileID).filter(Boolean)
      let filesBatch: Record<number, { downloadUrl: string; fileName: string }> = {}
      try {
        filesBatch = await mods.curseforgeGetFiles(fileIds)
      } catch (err) {
        console.warn("[curseforge-import] Batch files lookup failed, using fallback:", err)
      }

      sendImportProgress(0, 100, `Скачивание ${totalFiles} модов...`)
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
          if (!fileUrl) throw new Error(`Не получена ссылка для ${fileName}`)

          const filePath = path.join(modsDir, fileName)
          try { await fs.access(filePath) } catch {
            await fs.writeFile(filePath, await downloadBuffer(fileUrl, signal, fileName))
          }
        } catch (error) {
          if (isImportCancelledError(error)) {
            throw error
          }
          const message = toErrorMessage(error)
          throw new Error(`Не удалось скачать ${fileName}: ${message}`)
        }
        downloaded++
        sendImportProgress(downloadPercent(), 100, `${downloaded}/${totalFiles} модов`)
      })
      await runConcurrent(tasks, 5, signal)
      throwIfImportCancelled(signal)
      sendImportProgress(92, 100, "Распаковка файлов сборки...")
      await copyOverrideEntries(zip, intentPath)
      const scanned = await scanIntentDir(intentPath, (done, total) => {
        const fraction = total > 0 ? done / total : 1
        sendImportProgress(Math.min(99, Math.round(92 + fraction * 7)), 100, `Сканирование сборки (${done}/${total})...`)
      })
      sendImportProgress(100, 100, "Готово!")
      return { success: true, version: mcVersion, modLoader, loaderVersion, ...scanned }
    } catch (e) {
      if (isImportCancelledError(e)) {
        return { success: false, cancelled: true, error: "Импорт отменен" }
      }
      return opFailure(e)
    } finally {
      finishImportSession(signal)
    }
  })

  ipcMain.handle("build:import-ftb", async (_event, buildName: string, modpackId: number, versionId: number, targetBuildId?: string): Promise<ImportResult> => {
    const signal = startImportSession()
    try {
      const conflict = await guardAgainstOverwrite(buildName, { source: "ftb", modId: modpackId }, targetBuildId)
      if (conflict) return conflict
      const intentPath = await ensureBuildIntentDir(buildName)
      sendImportProgress(0, 100, "Получение манифеста версии...")
      const mods = await loadModsModule()
      const manifest = await mods.ftbGetModpackVersion(modpackId, versionId) as FTBModpackVersionManifest | null
      throwIfImportCancelled(signal)
      if (!manifest) throw new Error("Манифест версии не найден")

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

      // Полностью убираем файлы предыдущей версии сборки, чтобы не было дублей
      sendImportProgress(0, 100, "Очистка файлов предыдущей версии...")
      await cleanPackManagedContent(intentPath)

      const files = (manifest.files ?? []).filter((f: FTBFile) => !f.serveronly)
      const totalFiles = files.length
      let downloaded = 0
      const downloadPercent = () => Math.round((downloaded / Math.max(totalFiles, 1)) * 90)
      sendImportProgress(0, 100, `Скачивание ${totalFiles} файлов...`)
      const tasks = files.map((f: FTBFile) => async () => {
        const filePath = mods.getFTBPath(f)
        const fileName = filePath.split("/").pop() ?? "file"
        try {
          throwIfImportCancelled(signal)
          const targetPath = path.join(intentPath, filePath)
          try { await fs.access(targetPath) } catch {
            let url = f.url ?? ""
            if (!url && f.curseforge) {
              url = await mods.curseforgeGetDownloadUrl(f.curseforge.project, f.curseforge.file) ?? ""
            }
            if (!url) {
              console.warn(`[ftb] Нет ссылки для ${fileName}, пропускаю`)
              return
            }
            await fs.mkdir(path.dirname(targetPath), { recursive: true }).catch(() => {})
            await fs.writeFile(targetPath, await downloadBuffer(url, signal, fileName))
          }
        } catch (error) {
          if (isImportCancelledError(error)) {
            throw error
          }
          const message = toErrorMessage(error)
          throw new Error(`Не удалось скачать ${fileName}: ${message}`)
        } finally {
          downloaded++
          sendImportProgress(downloadPercent(), 100, `${downloaded}/${totalFiles} файлов`)
        }
      })
      await runConcurrent(tasks, 5, signal)
      throwIfImportCancelled(signal)
      sendImportProgress(92, 100, "Распаковка файлов сборки...")
      const scanned = await scanIntentDir(intentPath, (done, total) => {
        const fraction = total > 0 ? done / total : 1
        sendImportProgress(Math.min(99, Math.round(92 + fraction * 7)), 100, `Сканирование сборки (${done}/${total})...`)
      })
      sendImportProgress(100, 100, "Готово!")
      return { success: true, version, modLoader, loaderVersion, ...scanned }
    } catch (e) {
      if (isImportCancelledError(e)) {
        return { success: false, cancelled: true, error: "Импорт отменен" }
      }
      return opFailure(e)
    } finally {
      finishImportSession(signal)
    }
  })

  ipcMain.handle("build:open-and-import", async (_event, nameOverride?: string): Promise<OpenImportResult> => {
    const signal = startImportSession()
    try {
      const win = getMainWindow()
      if (!win) return { success: false, error: "Окно недоступно" }

      // Повторный вызов после подтверждения «создать копию» — файл уже выбран
      let selectedFile: string
      if (nameOverride && pendingLocalImport) {
        selectedFile = pendingLocalImport.filePath
      } else {
        const picked = await dialog.showOpenDialog(win, {
          title: "Импорт модпака",
          properties: ["openFile"],
          filters: [{ name: "Modpacks", extensions: ["mrpack", "zip"] }],
        })
        if (picked.canceled || picked.filePaths.length === 0) return { success: false, error: "Импорт отменён" }
        selectedFile = picked.filePaths[0]
        pendingLocalImport = null
      }
      throwIfImportCancelled(signal)
      // Файл выбран — только теперь показываем прогресс: до этого оверлей
      // затемнял лаунчер, пока пользователь ещё выбирал архив в системном окне.
      sendImportProgress(0, 100, "Чтение архива...")
      const AdmZip = await loadAdmZip()
      const fileData = await fs.readFile(selectedFile)
      const zip = new AdmZip(fileData)
      const mrpackIndex = zip.getEntry("modrinth.index.json")
      const manifestEntry = zip.getEntry("manifest.json")

      // Наш собственный экспорт сборки: в корне архива лежит xnlauncher.json.
      const xnManifestEntry = zip.getEntry("xnlauncher.json")
      if (xnManifestEntry) {
        const manifest = JSON.parse(xnManifestEntry.getData().toString("utf-8")) as Record<string, unknown>
        const str = (value: unknown, fallback = "") => (typeof value === "string" ? value : fallback)
        const buildName = nameOverride?.trim()
          || str(manifest.name).trim()
          || path.basename(selectedFile, path.extname(selectedFile))

        const conflict = await guardAgainstOverwrite(buildName, { source: "local" })
        if (conflict) {
          pendingLocalImport = { filePath: selectedFile }
          return { ...conflict, name: buildName, description: str(manifest.description), source: "local" }
        }
        pendingLocalImport = null

        const intentPath = await ensureBuildIntentDir(buildName)

        // Архив собран как <папка сборки>/… — срезаем общий корень, чтобы файлы
        // легли прямо в intent-директорию.
        const files = zip.getEntries().filter((entry) => !entry.isDirectory && entry.entryName !== "xnlauncher.json")
        const roots = new Set(files.map((entry) => entry.entryName.split("/").filter(Boolean)[0] ?? ""))
        const root = roots.size === 1 ? Array.from(roots)[0] : ""
        const strip = root ? root.length + 1 : 0

        sendImportProgress(0, files.length || 1, "Распаковка сборки...")

        let unpacked = 0
        for (const entry of files) {
          throwIfImportCancelled(signal)
          const rel = sanitizeRelativeContentPath(entry.entryName.slice(strip))
          if (!rel || rel.split(/[\\/]/).includes("..")) continue
          const dest = path.join(intentPath, rel)
          await fs.mkdir(path.dirname(dest), { recursive: true }).catch(() => {})
          await fs.writeFile(dest, entry.getData())
          unpacked++
          if (unpacked % 10 === 0 || unpacked === files.length) {
            sendImportProgress(unpacked, files.length, `Распаковка сборки (${unpacked}/${files.length})...`)
          }
        }

        const scanned = await scanIntentDir(intentPath, (done, total) => {
          const fraction = total > 0 ? done / total : 1
          sendImportProgress(Math.min(99, Math.round(fraction * 100)), 100, `Сканирование сборки (${done}/${total})...`)
        })

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
        const index = JSON.parse(mrpackIndex.getData().toString("utf-8"))
        const buildName = nameOverride ?? index.name ?? path.basename(selectedFile, path.extname(selectedFile))
        const conflict = await guardAgainstOverwrite(buildName, { source: "modrinth", projectSlug: index.slug })
        if (conflict) {
          pendingLocalImport = { filePath: selectedFile }
          return { ...conflict, name: buildName, description: index.summary, source: "modrinth" }
        }
        pendingLocalImport = null
        const intentPath = await ensureBuildIntentDir(buildName)
        await cleanPackManagedContent(intentPath)
        const files: ModrinthManifestFile[] = (index.files as ModrinthManifestFile[] ?? []).filter((f) => f.env?.client !== "unsupported")
        const deps: Record<string, string> = index.dependencies ?? {}
        const version = deps.minecraft ?? ""
        const loaderSelection = getLoaderSelectionFromModrinthDeps(deps)
        let modLoader = loaderSelection.modLoader
        const loaderVersion = loaderSelection.loaderVersion
        if (deps["fabric-loader"]) {
          modLoader = "fabric"
          sendImportProgress(0, 100, "Установка Fabric...")
        } else if (deps["quilt-loader"]) {
          modLoader = "quilt"
          sendImportProgress(0, 100, "Установка Quilt...")
        }

        let downloaded = 0
        const totalFiles = files.length
        const downloadPercent = () => Math.round((downloaded / Math.max(totalFiles, 1)) * 90)
        sendImportProgress(0, 100, `Скачивание ${totalFiles} файлов...`)
        const tasks = files.map((f: ModrinthManifestFile) => async () => {
          const currentFileName = path.basename(f.path ?? "")
          try {
            const fileDir = path.join(intentPath, path.dirname(f.path ?? ""))
            const filePath = path.join(intentPath, f.path ?? "")
            await fs.mkdir(fileDir, { recursive: true }).catch(() => {})
            try { await fs.access(filePath) } catch {
              const url = f.downloads?.[0]
              if (!url) throw new Error(`Не найдена ссылка для ${currentFileName}`)
              await fs.writeFile(filePath, await downloadBuffer(url, signal, currentFileName))
            }
          } catch (error) {
            if (isImportCancelledError(error)) {
              throw error
            }
            const message = toErrorMessage(error)
            throw new Error(`Не удалось скачать ${currentFileName}: ${message}`)
          } finally {
            downloaded++
            sendImportProgress(downloadPercent(), 100, `${downloaded}/${totalFiles} файлов`)
          }
        })
        await runConcurrent(tasks, 5, signal)
        throwIfImportCancelled(signal)
        sendImportProgress(92, 100, "Распаковка файлов сборки...")
        await copyOverrideEntries(zip, intentPath)
        await fetchMissingPackMods(intentPath, signal)
        const scanned = await scanIntentDir(intentPath, (done, total) => {
          const fraction = total > 0 ? done / total : 1
          sendImportProgress(Math.min(99, Math.round(92 + fraction * 7)), 100, `Сканирование сборки (${done}/${total})...`)
        })

        let mrIcon = ""
        try {
          const projectSlug = index.slug ?? buildName.toLowerCase().replace(/\s+/g, "-")
          const mods = await loadModsModule()
          const projectInfo = await mods.modrinthGetProjectInfo(projectSlug)
          mrIcon = projectInfo?.iconUrl ?? ""
        } catch {}

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
        const manifest = JSON.parse(manifestEntry.getData().toString("utf-8"))
        const buildName = nameOverride ?? manifest.name ?? path.basename(selectedFile, path.extname(selectedFile))
        const conflict = await guardAgainstOverwrite(buildName, { source: "curseforge", modId: manifest.projectID })
        if (conflict) {
          pendingLocalImport = { filePath: selectedFile }
          return { ...conflict, name: buildName, description: manifest.description, source: "curseforge" }
        }
        pendingLocalImport = null
        const intentPath = await ensureBuildIntentDir(buildName)
        await cleanPackManagedContent(intentPath)
        const version: string = manifest.minecraft?.version ?? ""
        const loaderRaw: string = manifest.minecraft?.modLoaders?.find((m: CurseForgeManifestFile) => m.primary)?.id ?? ""
        const loaderSelection = getLoaderSelectionFromCurseManifest(loaderRaw)
        let modLoader = loaderSelection.modLoader
        const loaderVersion = loaderSelection.loaderVersion
        if (loaderRaw.startsWith("fabric")) {
          modLoader = "fabric"
          sendImportProgress(0, 100, "Установка Fabric...")
        } else if (loaderRaw.startsWith("quilt")) {
          modLoader = "quilt"
          sendImportProgress(0, 100, "Установка Quilt...")
        }

        const modsDir = path.join(intentPath, "mods")
        await fs.mkdir(modsDir, { recursive: true }).catch(() => {})

        const files: { projectID: number; fileID: number }[] = manifest.files ?? []
        const totalFiles = files.length
        let downloaded = 0
        const downloadPercent = () => Math.round((downloaded / Math.max(totalFiles, 1)) * 90)
        sendImportProgress(0, 100, `Подготовка ${totalFiles} модов...`)

        // Пакетное получение ссылок на скачивание всех файлов сборки (POST /v1/mods/files)
        const fileIds = files.map((f) => f.fileID).filter(Boolean)
        let filesBatch: Record<number, { downloadUrl: string; fileName: string }> = {}
        try {
          const mods = await loadModsModule()
          filesBatch = await mods.curseforgeGetFiles(fileIds)
        } catch (err) {
          console.warn("[curseforge-import] Batch files lookup failed, using fallback:", err)
        }

        sendImportProgress(0, 100, `Скачивание ${totalFiles} модов...`)
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
            if (!fileUrl) throw new Error(`Не получена ссылка для ${fileName}`)

            const filePath = path.join(modsDir, fileName)
            try { await fs.access(filePath) } catch {
              await fs.writeFile(filePath, await downloadBuffer(fileUrl, signal, fileName))
            }
          } catch (error) {
            if (isImportCancelledError(error)) {
              throw error
            }
            const message = toErrorMessage(error)
            throw new Error(`Не удалось скачать ${fileName}: ${message}`)
          }
          downloaded++
          sendImportProgress(downloadPercent(), 100, `${downloaded}/${totalFiles} модов`)
        })
        await runConcurrent(tasks, 5, signal)
        throwIfImportCancelled(signal)
        sendImportProgress(92, 100, "Распаковка файлов сборки...")
        await copyOverrideEntries(zip, intentPath)
        const scanned = await scanIntentDir(intentPath, (done, total) => {
          const fraction = total > 0 ? done / total : 1
          sendImportProgress(Math.min(99, Math.round(92 + fraction * 7)), 100, `Сканирование сборки (${done}/${total})...`)
        })

        let cfIcon = ""
        try {
          const mods = await loadModsModule()
          const cfSearch = await mods.curseforgeSearch(buildName, { page: 0 })
          cfIcon = cfSearch.results?.[0]?.iconUrl ?? ""
        } catch {}

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

      return { success: false, error: "Неизвестный формат модпака" }
    } catch (e) {
      if (isImportCancelledError(e)) {
        return { success: false, cancelled: true, error: "Импорт отменен" }
      }
      return opFailure(e)
    } finally {
      finishImportSession(signal)
    }
  })
}
