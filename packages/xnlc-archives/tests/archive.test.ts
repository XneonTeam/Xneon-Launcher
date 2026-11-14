import { expect, test } from "bun:test"
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { unzipSync } from "fflate"
import { extractArchive, packArchive, packArchiveSync, readArchiveEntry } from "../src/index"

test("распаковка не пишет через junction корневого каталога", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "xnlc-archive-root-"))
  try {
    const outside = path.join(root, "outside")
    const destination = path.join(root, "destination")
    await mkdir(outside)
    await symlink(outside, destination, process.platform === "win32" ? "junction" : "dir")
    const bytes = packArchiveSync({ "escaped.txt": Buffer.from("forbidden") })
    await expect(extractArchive(bytes, destination)).rejects.toMatchObject({ code: "UNSAFE_ENTRY" })
    await expect(readFile(path.join(outside, "escaped.txt"))).rejects.toMatchObject({ code: "ENOENT" })
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test("чтение отклоняет ложный распакованный размер даже при верном CRC", async () => {
  const bytes = packArchiveSync({ "item": Buffer.from("actual contents") })
  const directory = bytes.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]))
  expect(directory).toBeGreaterThan(0)
  bytes.writeUInt32LE(1, directory + 24)
  await expect(readArchiveEntry(bytes, "item")).rejects.toMatchObject({ code: "INVALID_ARCHIVE" })
})

test("overwrite=false сохраняет существующий файл после отказа распаковки", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "xnlc-archive-existing-"))
  try {
    const target = path.join(root, "existing.txt")
    await writeFile(target, "user data")
    const archive = packArchiveSync({ "existing.txt": Buffer.alloc(0) })
    await expect(extractArchive(archive, root, { overwrite: false })).rejects.toBeDefined()
    expect(await readFile(target, "utf8")).toBe("user data")
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test("отмена упаковки не заменяет существующий архив частичным файлом", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "xnlc-archive-abort-"))
  try {
    const output = path.join(root, "archive.zip")
    await writeFile(output, "previous archive")
    const controller = new AbortController()
    await expect(packArchive([
      { kind: "data", entryName: "first", data: Buffer.from("first") },
      { kind: "data", entryName: "second", data: Buffer.from("second") },
    ], output, { signal: controller.signal, onProgress: () => controller.abort() })).rejects.toBeDefined()
    expect(await readFile(output, "utf8")).toBe("previous archive")
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test("упаковка и выборочная распаковка совместимы с независимым reader", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "xnlc-archive-roundtrip-"))
  try {
    const file = path.join(root, "source")
    const output = path.join(root, "archive.zip")
    await writeFile(file, "привет")
    await packArchive([
      { kind: "file", filePath: file, entryName: "overrides/config/мод.txt" },
      { kind: "data", entryName: "ignored.txt", data: Buffer.from("ignored") },
    ], output)
    const decoded = unzipSync(await readFile(output))
    expect(Buffer.from(decoded["overrides/config/мод.txt"]).toString()).toBe("привет")
    const destination = path.join(root, "extracted")
    expect(await extractArchive(output, destination, { stripPrefix: "overrides/" })).toMatchObject({ files: 1 })
    expect(await readFile(path.join(destination, "config/мод.txt"), "utf8")).toBe("привет")
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
