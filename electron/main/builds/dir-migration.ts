import fs from "fs/promises"
import path from "path"
import { dbHelpers } from "../../db"
import { getBuildIntentDirName, getInstancesRoot } from "./helpers"

/**
 * Правило, по которому считались имена папок до фикса (whitelist).
 * Нужно только для миграции: по нему находим папки, созданные старой версией.
 */
function legacyBuildIntentDirName(rawName: string): string {
  return rawName.replace(/[^a-zA-Z0-9а-яА-ЯёЁ ._-]/g, "_") || "unnamed-build"
}

async function exists(target: string): Promise<boolean> {
  try {
    await fs.access(target)
    return true
  } catch {
    return false
  }
}

async function readTrashSnapshotName(trashRoot: string, trashName: string): Promise<string | undefined> {
  try {
    const raw = await fs.readFile(path.join(trashRoot, `${trashName}.json`), "utf-8")
    const parsed = JSON.parse(raw) as { name?: unknown }
    return typeof parsed.name === "string" ? parsed.name : undefined
  } catch {
    return undefined
  }
}

/**
 * Разовая миграция имён папок сборок после смены правила санитайзера.
 *
 * Старое правило вырезало легальные символы (`+`, `&`, `[`, `]`, `™`), поэтому
 * `Create+` лежала в `intents/Create_`. Переименовываем такие папки (и записи
 * корзины вместе со снапшотами) на новые имена и правим `intentPath` в БД —
 * иначе сборка «потеряла» бы содержимое: приложение смотрит в новую папку.
 *
 * Папка-приёмник никогда не перезаписывается: если она уже существует, запись
 * пропускается с предупреждением (содержимое важнее переименования).
 *
 * @returns сколько папок переименовано
 */
export async function migrateIntentDirNames(): Promise<number> {
  const intentsRoot = path.join(getInstancesRoot(), "intents")
  if (!(await exists(intentsRoot))) return 0

  const builds = await dbHelpers.loadBuildsLight().catch(() => [])
  let renamed = 0

  for (const build of builds) {
    const legacyName = legacyBuildIntentDirName(build.name)
    const currentName = getBuildIntentDirName(build.name)
    const from = path.join(intentsRoot, legacyName)
    const to = path.join(intentsRoot, currentName)

    if (legacyName !== currentName && (await exists(from))) {
      if (await exists(to)) {
        console.warn(`[Migration] Папка '${currentName}' уже существует — '${legacyName}' не переименована`)
      } else {
        try {
          await fs.rename(from, to)
          renamed++
          console.log(`[Migration] Папка сборки '${build.name}': '${legacyName}' -> '${currentName}'`)
        } catch (error) {
          console.error(`[Migration] Не удалось переименовать '${legacyName}':`, error)
          continue
        }
      }
    }

    // intentPath в БД мог остаться старым даже без переименования папки.
    const expected = path.join(intentsRoot, currentName)
    if (build.intentPath !== expected && (await exists(expected))) {
      await dbHelpers.updateBuildFields(build.id, { intentPath: expected }).catch(() => {})
    }
  }

  // Корзина: папки называются `<timestamp>-<имя папки сборки>`, рядом лежит
  // снапшот метаданных `<trashName>.json` (в нём настоящее имя сборки).
  const trashRoot = path.join(intentsRoot, ".trash")
  const entries = await fs.readdir(trashRoot, { withFileTypes: true }).catch(() => [])
  for (const entry of entries) {
    if (!entry.isDirectory()) continue
    const match = entry.name.match(/^(\d+)-(.+)$/)
    if (!match) continue
    const buildName =
      (await readTrashSnapshotName(trashRoot, entry.name)) ??
      builds.find((build) => legacyBuildIntentDirName(build.name) === match[2])?.name
    if (!buildName) continue
    const newTrashName = `${match[1]}-${getBuildIntentDirName(buildName)}`
    if (newTrashName === entry.name) continue
    if (await exists(path.join(trashRoot, newTrashName))) continue
    try {
      await fs.rename(path.join(trashRoot, entry.name), path.join(trashRoot, newTrashName))
      const snapshot = path.join(trashRoot, `${entry.name}.json`)
      if (await exists(snapshot)) {
        await fs.rename(snapshot, path.join(trashRoot, `${newTrashName}.json`)).catch(() => {})
      }
      renamed++
      console.log(`[Migration] Запись корзины '${entry.name}' -> '${newTrashName}'`)
    } catch (error) {
      console.error(`[Migration] Не удалось переименовать запись корзины '${entry.name}':`, error)
    }
  }

  return renamed
}
