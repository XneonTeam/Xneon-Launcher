import { fail, MAX_FILE_BYTES } from "./manifest.js"

export interface ArchiveEntry {
  name: string
  size: number
  directory: boolean
  read(): Uint8Array
}
export type ArchiveReader = (bytes: Uint8Array) => ArchiveEntry[]

/** Одинаковые правила содержимого для предпросмотра и сервера; чтение ZIP передаёт адаптер. */
export function inspectExternalObject(bytes: Uint8Array, openArchive: ArchiveReader): void {
  const inspect = (data: Uint8Array, depth = 0): void => {
    const head = Array.from(data.subarray(0, 4), byte => byte.toString(16).padStart(2, "0")).join("")
    if (head === "504b0304") {
      if (depth > 2) fail("FILE_POLICY", "Archive nesting limit exceeded")
      let entries: ArchiveEntry[]
      try { entries = openArchive(data) } catch { fail("FILE_POLICY", "Invalid archive") }
      if (entries.length > 10000) fail("FILE_POLICY", "Archive entry limit exceeded")
      let size = 0
      for (const entry of entries) {
        size += entry.size
        if (size > MAX_FILE_BYTES * 4 || entry.size > MAX_FILE_BYTES) fail("FILE_POLICY", "Archive expansion limit exceeded")
        if (entry.directory) continue
        const name = entry.name.replace(/\\/g, "/")
        if (/(^|\/)\.\.(\/|$)/.test(name) || name.startsWith("/") || /[\x00:]/.test(name) || /\.(exe|dll|msi|bat|cmd|ps1|sh|com|scr|lnk|node|so|dylib)$/i.test(name)) fail("FILE_POLICY", "Unsafe archive entry")
        if (/\.(class|mf)$/i.test(name)) continue
        let content: Uint8Array
        try { content = entry.read() } catch { fail("FILE_POLICY", "Invalid archive entry") }
        inspect(content, depth + 1)
      }
    } else if (head.startsWith("4d5a") || head === "7f454c46" || ["feedface", "feedfacf", "cefaedfe", "cffaedfe"].includes(head) || head.startsWith("2321")) {
      fail("FILE_POLICY", "Executable content is forbidden")
    }
  }
  inspect(bytes)
}
