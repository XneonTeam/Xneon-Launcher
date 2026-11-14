import { unzipSync, type UnzipFileInfo } from "fflate"
import type { ArchiveReader } from "./object-policy.js"

/**
 * Синхронный ZIP-адаптер для `inspectExternalObject` на fflate.
 *
 * Каталог разбирается один раз и без распаковки: `filter` только собирает имена
 * и размеры, поэтому лимиты политики проверяются до выделения памяти. Данные
 * записи распаковываются лишь тогда, когда политика действительно её читает
 * (вложенный архив), а не для каждой записи подряд.
 */
export const fflateArchiveReader: ArchiveReader = (bytes) => {
  const infos: UnzipFileInfo[] = []
  unzipSync(bytes, {
    filter: (file) => {
      infos.push(file)
      return false
    },
  })
  return infos.map((file) => ({
    name: file.name,
    size: file.originalSize,
    directory: file.name.endsWith("/"),
    read: () => {
      const extracted = unzipSync(bytes, { filter: (candidate) => candidate.name === file.name })
      const content = extracted[file.name]
      if (!content) throw new Error(`Archive entry is missing: ${file.name}`)
      return content
    },
  }))
}
