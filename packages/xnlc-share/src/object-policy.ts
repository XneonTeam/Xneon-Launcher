import { assertSafeEntryName, withArchiveEntries } from "@xnlc/archives"
import { fail, MAX_FILE_BYTES } from "./manifest.js"

/** Проверяет содержимое Share, используя общий каталог и потоковое чтение ZIP. */
export async function inspectExternalObject(bytes: Uint8Array): Promise<void> {
  let expansion = 0
  let inspected = 0
  let untilYield = performance.now() + 4
  let processed = 0
  const inspect = async (data: Uint8Array, depth = 0): Promise<void> => {
    const head = (data[0] << 24 | data[1] << 16 | data[2] << 8 | data[3]) >>> 0
    if (head === 0x504b0304 || head === 0x504b0506) {
      if (depth > 2) fail("FILE_POLICY", "Archive nesting limit exceeded")
      try {
        await withArchiveEntries(data, async (entries, read) => {
          inspected += entries.length
          if (inspected > 10000) fail("FILE_POLICY", "Archive entry limit exceeded")
          for (const entry of entries) {
            expansion += entry.size
            if (expansion > MAX_FILE_BYTES * 4 || entry.size > MAX_FILE_BYTES) fail("FILE_POLICY", "Archive expansion limit exceeded")
            assertSafeEntryName(entry.name)
            if (entry.symlink) fail("FILE_POLICY", "Unsafe archive entry")
            if (entry.directory) continue
            const name = entry.name
            if (/\.(exe|dll|msi|bat|cmd|ps1|sh|com|scr|lnk|node|so|dylib)$/i.test(name)) fail("FILE_POLICY", "Unsafe archive entry")
            if (/\.(class|mf)$/i.test(name)) continue
            await inspect(await read(entry), depth + 1)
            if (++processed % 16 === 0 && performance.now() >= untilYield) {
              await new Promise<void>(resolve => setTimeout(resolve, 0))
              untilYield = performance.now() + 4
            }
          }
        }, { maxEntries: 10000, maxEntrySize: MAX_FILE_BYTES, maxTotalSize: MAX_FILE_BYTES * 4 })
      } catch { fail("FILE_POLICY", "Invalid or unsafe archive") }
    } else if (head >>> 16 === 0x4d5a || head === 0x7f454c46 || [0xfeedface, 0xfeedfacf, 0xcefaedfe, 0xcffaedfe].includes(head) || head >>> 16 === 0x2321) {
      fail("FILE_POLICY", "Executable content is forbidden")
    }
  }
  await inspect(bytes)
}
