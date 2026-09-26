// ============================================================
// Skins — IPC-обработчики домена скинов
// ============================================================
//
// Здесь только граница: привести аргументы renderer'а к вызову домена и вернуть
// результат. Ни запросов, ни кэша, ни работы с базой — всё это в `@xnlc/skins`,
// а доступ к базе/файлам/аккаунтам — в `./ports`.
//
// Каналы:
//   skins:*  — «Избранное», локальные скины, активный скин аккаунта
//   laby:*   — каталог Laby: страницы, теги, «похожие», игроки, импорт
//   read-local-file — содержимое текстуры из каталога скинов лаунчера

import fs from "fs/promises"
import path from "path"
import { ipcMain } from "electron"
import type { LabyOrder } from "@xnlc/types"
import { createSkinSystem, type SkinSystem } from "@xnlc/skins"
import { dbHelpers } from "../../db"
import { createAccountPort, createDiskCache, createLibraryStore } from "./ports"

/** Верхняя граница размера файла, который `read-local-file` отдаёт в renderer. */
const MAX_LOCAL_READ_BYTES = 16 * 1024 * 1024

let system: SkinSystem | null = null

/**
 * Домен скинов на процесс.
 *
 * Один экземпляр на всё приложение: он держит кэш и пулы загруженных страниц,
 * поэтому создавать его на каждый запрос бессмысленно.
 */
function skinSystem(): SkinSystem {
  system ??= createSkinSystem({
    library: createLibraryStore(),
    accounts: createAccountPort(),
    disk: createDiskCache(),
    locale: "ru",
  })
  return system
}

export function registerSkinsHandlers(): void {
  const skins = () => skinSystem()

  /**
   * Отдаёт renderer'у содержимое файла в base64.
   *
   * Путь приходит из renderer'а и не может быть произвольным: единственный
   * потребитель — превью скинов из «Избранного», а лаунчер сам складывает их в
   * `<data>/skins`. Читаем только оттуда и только картинки разумного размера,
   * иначе любой код в окне (в том числе из XSS в описании мода) прочитал бы
   * произвольный файл на диске.
   */
  ipcMain.handle("read-local-file", async (_event, filePath: string) => {
    try {
      if (typeof filePath !== "string" || !filePath) return null
      const skinsDir = path.resolve(await dbHelpers.getLauncherDirectory(), "skins")
      const resolved = path.resolve(filePath)
      const relative = path.relative(skinsDir, resolved)
      // Выход за пределы каталога скинов (в том числе через `..`) запрещён.
      if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) return null
      const stat = await fs.stat(resolved)
      if (!stat.isFile() || stat.size > MAX_LOCAL_READ_BYTES) return null
      return (await fs.readFile(resolved)).toString("base64")
    } catch {
      return null
    }
  })

  // ── Активный скин аккаунта ──────────────────────────────

  ipcMain.handle("skins:get-profile", async (_event, accountId?: string) => skins().minecraft.profile(accountId))

  ipcMain.handle("skins:delete-skin", async (_event, accountId?: string) => skins().library.reset(accountId))

  ipcMain.handle("skins:set-cape", async (_event, params: { capeId: string | null; accountId?: string }) =>
    skins().library.setCape(params?.capeId ?? null, params?.accountId),
  )

  // ── «Избранное» ─────────────────────────────────────────

  ipcMain.handle("skins:list-library", async (_event, accountId: string) => skins().library.list(accountId))

  ipcMain.handle(
    "skins:save-to-library",
    async (
      _event,
      params: { filePath: string; name: string; variant: "classic" | "slim"; accountId: string; capeId?: string | null },
    ) => {
      try {
        // Файл читает main: путь приходит из нативного диалога или drag&drop.
        const data = new Uint8Array(await fs.readFile(params.filePath))
        return await skins().library.save({
          accountId: params.accountId,
          name: params.name,
          variant: params.variant,
          capeId: params.capeId ?? null,
          data,
        })
      } catch {
        return null
      }
    },
  )

  ipcMain.handle("skins:delete-from-library", async (_event, id: string) => skins().library.remove(id))

  ipcMain.handle(
    "skins:update-variant",
    async (_event, params: { id: string; variant: "classic" | "slim"; capeId?: string | null; name?: string }) =>
      skins().library.update(params.id, {
        ...(params.variant !== undefined ? { variant: params.variant } : {}),
        ...(params.capeId !== undefined ? { capeId: params.capeId } : {}),
        ...(params.name !== undefined ? { name: params.name } : {}),
      }),
  )

  ipcMain.handle("skins:apply-library-skin", async (_event, params: { skinId: string; accountId: string }) =>
    skins().library.apply(params.skinId, params.accountId),
  )

  // ── Каталог Laby ────────────────────────────────────────

  ipcMain.handle(
    "laby:catalog",
    async (
      _event,
      params: { page: number; size?: number; order?: LabyOrder; tags?: string[] | null; query?: string | null },
    ) => skins().catalog.page(params ?? { page: 0 }),
  )

  ipcMain.handle("laby:tags", async (_event, locale?: string) =>
    skins().catalog.tags(typeof locale === "string" && locale ? locale : "ru"),
  )

  ipcMain.handle(
    "laby:similar",
    async (_event, params: { hash: string; tags: string[]; slim: boolean }) =>
      skins().catalog.similar({
        hash: params?.hash,
        tags: Array.isArray(params?.tags) ? params.tags : [],
        slim: params?.slim === true,
      }),
  )

  ipcMain.handle("laby:player", async (_event, username: string) => skins().catalog.player(username))

  ipcMain.handle(
    "laby:save-to-library",
    async (_event, params: { hash: string; accountId: string; name?: string; slim?: boolean }) =>
      skins().library.importFromCatalog(params, false),
  )

  ipcMain.handle(
    "laby:apply",
    async (_event, params: { hash: string; accountId: string; name?: string; slim?: boolean }) =>
      skins().library.importFromCatalog(params, true),
  )
}