// ============================================================
// XNLC — Trash metadata snapshots
// Метаданные сборок, лежащих в корзине (`intents/.trash/<trashName>.json`).
//
// Запись сборки в БД удаляется сразу при перемещении в корзину, а папка
// переименовывается в санитизированное имя (`Create+` → `Create_`). Поэтому
// единственное место, где ещё живут настоящее имя и иконка, — снапшот рядом с
// папкой. Его читают список корзины, статистика и очистка корзины, поэтому
// чтение вынесено в отдельный модуль (без импорта `builds/index.ts`, чтобы не
// создавать цикл со `stats.ts`).
// ============================================================

import path from "path"
import fs from "fs/promises"
import { getInstancesRoot, loadInstancesRoot } from "./helpers"

export type TrashBuildMeta = {
  id?: string
  name?: string
  icon?: string
  /** Загрузчик сборки: по нему рисуется та же плашка-заглушка, что и в списке сборок. */
  modLoader?: string
}

export function getTrashRoot(): string {
  return path.join(getInstancesRoot(), "intents", ".trash")
}

/**
 * `getInstancesRoot()` отдаёт кэш, который наполняет `loadInstancesRoot()` при
 * старте окна. Если статистику запросят раньше, корень ещё не загружен — читаем
 * настройку один раз сами.
 */
let instancesRootEnsured = false
async function ensureInstancesRoot(): Promise<void> {
  if (instancesRootEnsured) return
  instancesRootEnsured = true
  await loadInstancesRoot().catch(() => {})
}

/** Метаданные одной записи корзины; `null`, если снапшота нет или он битый. */
export async function readTrashSnapshot(trashName: string): Promise<TrashBuildMeta | null> {
  try {
    await ensureInstancesRoot()
    const raw = await fs.readFile(path.join(getTrashRoot(), `${trashName}.json`), "utf-8")
    const parsed = JSON.parse(raw) as { id?: unknown; name?: unknown; icon?: unknown; iconUrl?: unknown; modLoader?: unknown }
    const icon = typeof parsed.icon === "string" ? parsed.icon : typeof parsed.iconUrl === "string" ? parsed.iconUrl : undefined
    return {
      id: typeof parsed.id === "string" ? parsed.id : undefined,
      name: typeof parsed.name === "string" ? parsed.name : undefined,
      icon: icon || undefined,
      modLoader: typeof parsed.modLoader === "string" ? parsed.modLoader : undefined,
    }
  } catch {
    return null
  }
}

/**
 * Все снапшоты корзины разом.
 *
 * Нужно статистике: сессии сборки остаются в БД до очистки корзины, а сама
 * сборка из `builds` уже удалена — без снапшотов в рейтинге не находится ни
 * иконка, ни настоящее имя.
 */
export async function listTrashedBuildMeta(): Promise<TrashBuildMeta[]> {
  await ensureInstancesRoot()
  const entries = await fs.readdir(getTrashRoot(), { withFileTypes: true }).catch(() => [])
  const names = entries
    .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
    .map((entry) => entry.name.slice(0, -".json".length))
  const metas = await Promise.all(names.map((name) => readTrashSnapshot(name)))
  return metas.filter((meta): meta is TrashBuildMeta => meta !== null)
}