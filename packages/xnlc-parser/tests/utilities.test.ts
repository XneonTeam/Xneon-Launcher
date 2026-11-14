import { expect, test } from "bun:test"
import TestZip from "../../../tests/helpers/zip"
import { ArchiveContext, curseforgeFingerprint, curseforgeFingerprintFile, extractIcon, sha1, sha1File } from "../src"
import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

test("SHA-1 и отпечаток совпадают с зафиксированными векторами", () => {
  expect(sha1(new TextEncoder().encode("abc"))).toBe("a9993e364706816aba3e25717850c26c9cd0d89d")
  // Результаты зафиксированы по прежней реализации; независимый вектор Aternos — в real-world.test.ts.
  for (const [bytes, expected] of [[[], 1540447798], [[9, 10, 13, 32], 1540447798], [[0, 1, 2, 3, 4, 9, 255], 858989264], [Array.from({ length: 1024 }, (_, i) => i % 256), 3164413637]] as [number[], number][]) {
    const input = Uint8Array.from(bytes), before = input.slice()
    expect(curseforgeFingerprint(input)).toBe(expected)
    expect(input).toEqual(before)
  }
})

test("потоковый SHA-1 учитывает лимит и отмену", async () => {
  const dir = await mkdtemp(join(tmpdir(), "xnlc-sha1-"))
  try {
    const path = join(dir, "file")
    const data = new Uint8Array(300000).map((_, i) => i % 251)
    await writeFile(path, data)
    expect(await sha1File(path)).toBe(sha1(data))
    expect(await curseforgeFingerprintFile(path)).toBe(3105965953)
    await expect(sha1File(path, { maxSize: 2 })).rejects.toMatchObject({ code: "LIMIT_EXCEEDED" })
    await expect(curseforgeFingerprintFile(path, { maxSize: 2 })).rejects.toMatchObject({ code: "LIMIT_EXCEEDED" })
    const controller = new AbortController(); controller.abort()
    await expect(sha1File(path, { signal: controller.signal })).rejects.toMatchObject({ code: "ABORTED" })
    await expect(curseforgeFingerprintFile(path, { signal: controller.signal })).rejects.toMatchObject({ code: "ABORTED" })
    await expect(curseforgeFingerprintFile(join(dir, "missing"), { signal: controller.signal })).rejects.toMatchObject({ code: "ABORTED" })
  } finally { await rm(dir, { recursive: true, force: true }) }
})

test("иконка возвращается как бинарные данные, некорректная сигнатура отклоняется", async () => {
  const zip = new TestZip()
  zip.addFile("icon.png", Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGNgYGBgAAAABQABpfZFQAAAAABJRU5ErkJggg==", "base64"))
  zip.addFile("header.png", Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
  zip.addFile("bad.png", Buffer.from("bad"))
  const archive = await ArchiveContext.open(new Uint8Array(zip.toBuffer()))
  expect(await extractIcon(archive, "missing.png")).toBeUndefined()
  expect(await extractIcon(archive, "icon.png")).toMatchObject({ mimeType: "image/png" })
  await expect(extractIcon(archive, "bad.png")).rejects.toMatchObject({ code: "CORRUPTED_ARCHIVE" })
  await expect(extractIcon(archive, "header.png")).rejects.toMatchObject({ code: "CORRUPTED_ARCHIVE" })
})
