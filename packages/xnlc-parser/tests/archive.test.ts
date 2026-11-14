import { describe, expect, test } from "bun:test"
import AdmZip from "adm-zip"
import { ArchiveContext, ParserError } from "../src"
import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

function zip(files: Record<string, string>) {
  const archive = new AdmZip()
  for (const [name, contents] of Object.entries(files)) archive.addFile(name, Buffer.from(contents))
  return new Uint8Array(archive.toBuffer())
}

describe("ArchiveContext", () => {
  test("indexes and reads compressed entries, then closes", async () => {
    const archive = await ArchiveContext.open(zip({ "fabric.mod.json": '{"id":"example"}', "other.txt": "hello" }))
    expect(archive.entries().map(e => e.name)).toEqual(["fabric.mod.json", "other.txt"])
    expect(new TextDecoder().decode(await archive.read("fabric.mod.json"))).toBe('{"id":"example"}')
    archive.close()
    expect(() => archive.entries()).toThrow(ParserError)
  })
  test("rejects invalid, truncated and traversal archives", async () => {
    await expect(ArchiveContext.open(new Uint8Array([1, 2]))).rejects.toMatchObject({ code: "INVALID_ARCHIVE" })
    const bytes = zip({ "safe.txt": "a" })
    await expect(ArchiveContext.open(bytes.subarray(0, bytes.length - 4))).rejects.toThrow()
    const bad = zip({ "ab/x": "a" })
    const central = bad.findIndex((_, i) => [0x50, 0x4b, 0x01, 0x02].every((b, j) => bad[i + j] === b))
    bad[central + 46] = 46; bad[central + 47] = 46
    await expect(ArchiveContext.open(bad)).rejects.toMatchObject({ code: "CORRUPTED_ARCHIVE" })
  })
  test("enforces declared entry limit and cancellation", async () => {
    const bytes = zip({ "a": "123456" })
    const archive = await ArchiveContext.open(bytes, { limits: { maxEntrySize: 5 } })
    expect(Object.isFrozen(archive.limits)).toBe(true)
    await expect(archive.read("a")).rejects.toMatchObject({ code: "LIMIT_EXCEEDED" })
    const controller = new AbortController(); controller.abort()
    await expect(ArchiveContext.open(bytes, { signal: controller.signal })).rejects.toMatchObject({ code: "ABORTED" })
  })
  test("отменяет и закрывает уже начатое чтение", async () => {
    const controller = new AbortController()
    const archive = await ArchiveContext.open(zip({ a: "hello" }), { signal: controller.signal })
    const pending = archive.read("a")
    controller.abort()
    await expect(pending).rejects.toMatchObject({ code: "ABORTED" })
    const other = await ArchiveContext.open(zip({ a: "hello" }))
    const reading = other.read("a")
    other.close()
    await expect(reading).rejects.toMatchObject({ code: "CLOSED" })
  })
  test("отклоняет шифрование и multi-disk до распаковки", async () => {
    const encrypted = Buffer.from(zip({ a: "hello" }))
    const central = encrypted.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]))
    encrypted.writeUInt16LE(encrypted.readUInt16LE(central + 8) | 1, central + 8)
    await expect(ArchiveContext.open(encrypted)).rejects.toMatchObject({ code: "UNSUPPORTED_ARCHIVE" })
    for (const flag of [0x40, 0x2000]) {
      const strong = Buffer.from(zip({ a: "hello" }))
      const offset = strong.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]))
      strong.writeUInt16LE(strong.readUInt16LE(offset + 8) | flag, offset + 8)
      await expect(ArchiveContext.open(strong)).rejects.toMatchObject({ code: "UNSUPPORTED_ARCHIVE" })
    }
    const multidisk = Buffer.from(zip({ a: "hello" }))
    multidisk.writeUInt16LE(1, multidisk.length - 22 + 4)
    await expect(ArchiveContext.open(multidisk)).rejects.toMatchObject({ code: "UNSUPPORTED_ARCHIVE" })
  })
  test("повреждённый DEFLATE не возвращает данные", async () => {
    const bytes = Buffer.from(zip({ a: "repeated text ".repeat(100) }))
    const header = bytes.indexOf(Buffer.from([0x50, 0x4b, 0x03, 0x04]))
    const offset = header + 30 + bytes.readUInt16LE(header + 26) + bytes.readUInt16LE(header + 28)
    bytes[offset] = 0xff
    const archive = await ArchiveContext.open(bytes)
    await expect(archive.read("a")).rejects.toMatchObject({ code: "CORRUPTED_ARCHIVE" })
    archive.close()
  })
  test("проверяет data descriptor с сигнатурой и без неё", async () => {
    const make = (signature: boolean, corrupt: boolean) => {
      const original = Buffer.from(zip({ a: "hello" }))
      const central = original.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]))
      const end = original.length - 22, extra = signature ? 4 : 0
      const descriptor = Buffer.alloc(12 + extra)
      if (signature) descriptor.writeUInt32LE(0x08074b50, 0)
      descriptor.writeUInt32LE(original.readUInt32LE(central + 16) ^ (corrupt ? 1 : 0), extra)
      descriptor.writeUInt32LE(original.readUInt32LE(central + 20), extra + 4)
      descriptor.writeUInt32LE(original.readUInt32LE(central + 24), extra + 8)
      const result = Buffer.concat([original.subarray(0, central), descriptor, original.subarray(central)])
      const newCentral = central + descriptor.length, newEnd = end + descriptor.length
      result.writeUInt16LE(result.readUInt16LE(6) | 8, 6)
      result.writeUInt16LE(result.readUInt16LE(newCentral + 8) | 8, newCentral + 8)
      result.writeUInt32LE(0, 14); result.writeUInt32LE(0, 18); result.writeUInt32LE(0, 22)
      result.writeUInt32LE(newCentral, newEnd + 16)
      return result
    }
    for (const signature of [false, true]) {
      const archive = await ArchiveContext.open(make(signature, false))
      expect(new TextDecoder().decode(await archive.read("a"))).toBe("hello")
      archive.close()
      const bad = await ArchiveContext.open(make(signature, true))
      await expect(bad.read("a")).rejects.toMatchObject({ code: "CORRUPTED_ARCHIVE" })
      bad.close()
    }
  })
  test("отклоняет хвост после DEFLATE и усечённый поток", async () => {
    const original = Buffer.from(zip({ a: "x".repeat(100) }))
    const central = original.readUInt32LE(original.length - 6)
    for (const delta of [-1, 1]) {
      const payload = delta < 0 ? original.subarray(0, central - 1) : Buffer.concat([original.subarray(0, central), Buffer.from([255])])
      const bytes = Buffer.concat([payload, original.subarray(central)])
      bytes.writeUInt32LE(original.readUInt32LE(18) + delta, 18)
      bytes.writeUInt32LE(original.readUInt32LE(central + 20) + delta, central + delta + 20)
      bytes.writeUInt32LE(central + delta, bytes.length - 6)
      const archive = await ArchiveContext.open(bytes)
      try { await expect(archive.read("a")).rejects.toMatchObject({ code: "CORRUPTED_ARCHIVE" }) }
      finally { archive.close() }
    }
  })
  test("неуспешное чтение расходует квоту попыток", async () => {
    const bytes = Buffer.from(zip({ a: "x".repeat(100) }))
    bytes[31] = 255
    const archive = await ArchiveContext.open(bytes, { limits: { maxReadAttempts: 1 } })
    try {
      await expect(archive.read("a")).rejects.toMatchObject({ code: "CORRUPTED_ARCHIVE" })
      await expect(archive.read("a")).rejects.toMatchObject({ code: "LIMIT_EXCEEDED" })
    } finally { archive.close() }
  })
  test("checks CRC after decompression", async () => {
    const bytes = zip({ "a": "hello" })
    const marker = [0x50, 0x4b, 0x01, 0x02]
    const pos = bytes.findIndex((_, i) => marker.every((b, j) => bytes[i + j] === b))
    bytes[pos + 16] ^= 1
    const archive = await ArchiveContext.open(bytes)
    await expect(archive.read("a")).rejects.toMatchObject({ code: "CORRUPTED_ARCHIVE" })
  })
  test("проверяет стандартный вектор CRC32", async () => {
    const archive = await ArchiveContext.open(zip({ vector: "123456789" }))
    expect(archive.get("vector")?.crc32).toBe(0xcbf43926)
    expect(new TextDecoder().decode(await archive.read("vector"))).toBe("123456789")
  })
  test("rejects duplicate entries and ZIP64 markers", async () => {
    const bytes = zip({ "a": "one", "b": "two" })
    const locations: number[] = []
    for (let i = 0; i < bytes.length - 4; i++) if ([0x50, 0x4b, 0x01, 0x02].every((b, j) => bytes[i + j] === b)) locations.push(i)
    bytes[locations[1] + 46] = 97
    await expect(ArchiveContext.open(bytes)).rejects.toMatchObject({ code: "CORRUPTED_ARCHIVE" })
    const zip64 = zip({ a: "one" })
    const end = zip64.length - 22
    zip64[end + 10] = 255; zip64[end + 11] = 255
    zip64[end + 8] = 255; zip64[end + 9] = 255
    await expect(ArchiveContext.open(zip64)).rejects.toMatchObject({ code: "UNSUPPORTED_ARCHIVE" })
  })
  test("отклоняет перекрытие локальных записей по центральному каталогу", async () => {
    const bytes = zip({ "first": "1234567890", "second": "another" })
    const marker = Buffer.from([0x50, 0x4b, 0x01, 0x02])
    const data = Buffer.from(bytes), first = data.indexOf(marker), second = data.indexOf(marker, first + 4)
    const firstOffset = data.readUInt32LE(first + 42)
    data.writeUInt32LE(firstOffset + 30, second + 42)
    await expect(ArchiveContext.open(data)).rejects.toMatchObject({ code: "CORRUPTED_ARCHIVE" })
  })
  test("проверяет переменную часть локального заголовка на перекрытие", async () => {
    const bytes = Buffer.from(zip({ first: "1234567890", second: "another" }))
    const initial = await ArchiveContext.open(bytes)
    const first = initial.get("first")!, second = initial.get("second")!
    initial.close()
    bytes.writeUInt16LE(second.offset - first.offset, first.offset + 28)
    const archive = await ArchiveContext.open(bytes)
    await expect(archive.read("first")).rejects.toMatchObject({ code: "CORRUPTED_ARCHIVE" })
    archive.close()
  })
  test("явно отклоняет архив с ZIP64 EOCD и locator", async () => {
    const original = Buffer.from(zip({ item: "value" }))
    const endOffset = original.length - 22
    const end = Buffer.from(original.subarray(endOffset))
    const zip64 = Buffer.alloc(56), locator = Buffer.alloc(20)
    zip64.writeUInt32LE(0x06064b50, 0); zip64.writeBigUInt64LE(44n, 4)
    zip64.writeUInt16LE(45, 12); zip64.writeUInt16LE(45, 14)
    zip64.writeBigUInt64LE(1n, 24); zip64.writeBigUInt64LE(1n, 32)
    zip64.writeBigUInt64LE(BigInt(end.readUInt32LE(12)), 40)
    zip64.writeBigUInt64LE(BigInt(end.readUInt32LE(16)), 48)
    locator.writeUInt32LE(0x07064b50, 0); locator.writeBigUInt64LE(BigInt(endOffset), 8); locator.writeUInt32LE(1, 16)
    end.writeUInt16LE(0xffff, 8); end.writeUInt16LE(0xffff, 10)
    end.writeUInt32LE(0xffffffff, 12); end.writeUInt32LE(0xffffffff, 16)
    const data = Buffer.concat([original.subarray(0, endOffset), zip64, locator, end])
    expect(new AdmZip(data).readAsText("item")).toBe("value")
    await expect(ArchiveContext.open(data)).rejects.toMatchObject({ code: "UNSUPPORTED_ARCHIVE" })
  })
  test("rejects unknown compression methods", async () => {
    const bytes = zip({ a: "one" })
    const central = bytes.findIndex((_, i) => [0x50, 0x4b, 0x01, 0x02].every((b, j) => bytes[i + j] === b))
    bytes[central + 10] = 99
    const archive = await ArchiveContext.open(bytes)
    await expect(archive.read("a")).rejects.toMatchObject({ code: "UNSUPPORTED_ARCHIVE" })
  })
  test("ограничивает фактическую распаковку при ложном размере записи", async () => {
    const bytes = zip({ bomb: "x".repeat(512 * 1024) })
    const central = bytes.findIndex((_, i) => [0x50, 0x4b, 0x01, 0x02].every((b, j) => bytes[i + j] === b))
    const data = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
    data.setUint32(22, 1, true)
    data.setUint32(central + 24, 1, true)
    const archive = await ArchiveContext.open(bytes, { limits: { maxEntrySize: 1024 } })
    await expect(archive.read("bomb")).rejects.toMatchObject({ code: "LIMIT_EXCEEDED" })
  })
  test("читает deflate-запись, сжатые данные которой занимают несколько чанков", async () => {
    const random = new Uint8Array(160000)
    for (let offset = 0; offset < random.length; offset += 40000) crypto.getRandomValues(random.subarray(offset, Math.min(offset + 40000, random.length)))
    const zip = new AdmZip()
    zip.addFile("random.bin", Buffer.from(random))
    const archive = await ArchiveContext.open(new Uint8Array(zip.toBuffer()))
    expect(archive.get("random.bin")!.compressedSize).toBeGreaterThan(64 * 1024)
    expect(await archive.read("random.bin")).toEqual(random)
  })
  test("общий лимит учитывает параллельные чтения", async () => {
    const archive = await ArchiveContext.open(zip({ a: "12345", b: "67890" }), { limits: { maxTotalUncompressedSize: 9 } })
    const results = await Promise.allSettled([archive.read("a"), archive.read("b")])
    expect(results.filter(item => item.status === "fulfilled")).toHaveLength(1)
    expect(results.filter(item => item.status === "rejected")).toHaveLength(1)
  })
  test("вложенный архив разделяет бюджет распаковки с родителем", async () => {
    const inner = zip({ item: "12345" })
    const outer = new AdmZip()
    outer.addFile("inner.jar", Buffer.from(inner))
    const archive = await ArchiveContext.open(new Uint8Array(outer.toBuffer()), { limits: { maxTotalUncompressedSize: inner.length + 4 } })
    const child = await archive.openNested(await archive.read("inner.jar"))
    await expect(child.read("item")).rejects.toMatchObject({ code: "LIMIT_EXCEEDED" })
    child.close(); archive.close()
  })
  test("вложенный контекст не ослабляет лимиты и учитывает собственную отмену", async () => {
    const parent = await ArchiveContext.open(zip({ a: "hello" }), { limits: { maxEntrySize: 100 } })
    const nested = zip({ item: "12345" }), controller = new AbortController()
    const child = await parent.openNested(nested, { limits: { maxEntrySize: 3 }, signal: controller.signal })
    expect(child.limits.maxEntrySize).toBe(3)
    await expect(child.read("item")).rejects.toMatchObject({ code: "LIMIT_EXCEEDED" })
    controller.abort()
    expect(() => child.entries()).toThrow("Operation aborted")
    const limited = await parent.openNested(nested, { limits: { maxEntrySize: 1000 } })
    expect(limited.limits.maxEntrySize).toBe(100)
    child.close(); limited.close(); parent.close()
  })
  test("повреждённые заголовки и случайные байты не прерывают обработку других архивов", async () => {
    let seed = 123456789
    const next = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed }
    const valid = zip({ "fabric.mod.json": '{"id":"safe"}' })
    for (let i = 0; i < 150; i++) {
      const input = i % 2 ? valid.slice() : new Uint8Array(next() % 256)
      if (i % 2) for (let j = 0; j < 4; j++) input[next() % input.length] ^= next() & 255
      else for (let j = 0; j < input.length; j++) input[j] = next() & 255
      try {
        const archive = await ArchiveContext.open(input, { limits: { maxArchiveSize: 4096, maxEntrySize: 1024, maxTotalUncompressedSize: 2048 } })
        for (const entry of archive.entries()) try { await archive.read(entry.name) } catch (error) { expect(error).toBeInstanceOf(Error) }
        archive.close()
      } catch (error) { expect(error).toBeInstanceOf(Error) }
    }
    const archive = await ArchiveContext.open(valid)
    expect(new TextDecoder().decode(await archive.read("fabric.mod.json"))).toBe('{"id":"safe"}')
  })
  test("файловый контекст отклоняет архив, изменённый после индексации", async () => {
    const dir = await mkdtemp(join(tmpdir(), "xnlc-zip-change-"))
    try {
      const path = join(dir, "file.jar")
      await writeFile(path, zip({ a: "hello" }))
      const archive = await ArchiveContext.open(path)
      await writeFile(path, zip({ a: "changed value" }))
      await expect(archive.read("a")).rejects.toMatchObject({ code: "IO_ERROR" })
      archive.close()
    } finally { await rm(dir, { recursive: true, force: true }) }
  })
})
