import { collectDirectorySources } from "@xnlc/archives"
import { archiveService, type ArchiveServicePackSource } from "../archives/service"
import { META_ICON_ENTRY, META_NAME_ENTRY } from "./archive-meta"
import { EXPORT_CATEGORY_DIRS, SHARED_GAME_ENTRIES, categoriesOf } from "./categories"

export type ArchiveStage = "scan" | "compress"

export type ArchiveOptions = {
  /** Только выбранные категории; пусто — всё содержимое. */
  categories?: string[]
  /** Иконка сборки (data-URL): хранится в БД, поэтому кладётся в архив отдельно. */
  icon?: string
  /** Настоящее имя: имя файла архива санитизировано и теряет `:`, `?`, `*`. */
  name?: string
  onProgress?: (stage: ArchiveStage, percent: number) => void
  signal?: AbortSignal
}

/** Собирает ZIP сборки или сервера: каталог обходится один раз, файлы идут потоком. */
export async function createArchive(rootDir: string, archivePath: string, options: ArchiveOptions = {}): Promise<void> {
  const { categories, icon, name, onProgress, signal } = options
  onProgress?.("scan", 5)

  // Пустой список = «всё содержимое» (кроме общих junction-папок).
  const filter = categories && categories.length > 0 ? new Set(categories) : null
  const sources: ArchiveServicePackSource[] = await collectDirectorySources(rootDir, {
    signal,
    include: (relativePath) => {
      const top = relativePath.split("/")[0]
      if (top.toLowerCase() === ".xnlc-modpack") return false
      if (SHARED_GAME_ENTRIES.has(top)) return false // junctions в общий кэш игр не пакуем
      if (!filter) return true
      return categoriesOf(relativePath, EXPORT_CATEGORY_DIRS).some(category => filter.has(category))
    },
  })

  if (sources.length === 0) {
    throw new Error("Нечего загружать: выбранные категории не содержат файлов")
  }
  onProgress?.("scan", 15)

  if (icon && icon.trim()) sources.push({ kind: "data", data: Buffer.from(icon, "utf-8"), entryName: META_ICON_ENTRY })
  if (name && name.trim()) sources.push({ kind: "data", data: Buffer.from(name, "utf-8"), entryName: META_NAME_ENTRY })

  await archiveService.pack(sources, archivePath, {
    signal,
    onProgress: ({ done, total }) => onProgress?.("compress", 15 + Math.round(done / total * 85)),
  })
  onProgress?.("compress", 100)
}
