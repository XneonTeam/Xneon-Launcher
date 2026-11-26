import { expect, test } from "bun:test"
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises"
import { createHash } from "node:crypto"
import path from "node:path"
import os from "node:os"
import { downloadUnixUpdateFile } from "../../electrobun/main/unix-update-download"
import { updateBaseUrls } from "../../electrobun/main/repository-identity"

const bytes = Buffer.from("verified package bytes")
const file = { file: "xneon-launcher-1.0.9-x86_64.AppImage", format: "appimage" as const, downloadSize: bytes.length, downloadSha256: createHash("sha256").update(bytes).digest("hex") }
const base = updateBaseUrls.stable
async function fixture(run: (directory: string) => Promise<void>) {
  const directory = await mkdtemp(path.join(os.tmpdir(), "xneon-download-test-"))
  try { await run(directory) } finally { await rm(directory, { recursive: true, force: true }) }
}

test("скачивание проверяет bytes перед публикацией готового файла", () => fixture(async directory => {
  const progress: number[] = []
  const result = await downloadUnixUpdateFile(base, file, directory, { channel: "stable", version: "1.0.9", request: async url => { expect(url).toBe(`${base}/${file.file}`); return new Response(bytes) }, onProgress: value => progress.push(value.percent) })
  expect(await readFile(result.path)).toEqual(bytes)
  expect(progress.at(-1)).toBe(100)
  expect(await readdir(result.directory)).toEqual([file.file])
}))

test("неудачная загрузка очищает только свой staging, а повторная попытка не использует неполный файл", async () => {
  for (const kind of ["hash", "short", "long", "interrupted", "cancelled", "disk-full", "permissions"] as const) {
    await fixture(async directory => {
      const controller = new AbortController()
      const request = async () => {
        if (kind === "cancelled") controller.abort()
        if (kind === "disk-full" || kind === "permissions") throw Object.assign(new Error(kind), { code: kind === "disk-full" ? "ENOSPC" : "EACCES" })
        if (kind === "interrupted") return new Response(new ReadableStream({ start(stream) { stream.enqueue(bytes.subarray(0, 3)); stream.error(new Error("Connection interrupted")) } }))
        return new Response(kind === "hash" ? Buffer.alloc(bytes.length) : kind === "short" ? bytes.subarray(0, 3) : kind === "long" ? Buffer.concat([bytes, bytes]) : bytes)
      }
      await expect(downloadUnixUpdateFile(base, file, directory, { channel: "stable", version: "1.0.9", request, signal: controller.signal }), kind).rejects.toThrow()
      expect(await readdir(directory)).toEqual([])
      const result = await downloadUnixUpdateFile(base, file, directory, { channel: "stable", version: "1.0.9", request: async () => new Response(bytes) })
      expect(await readFile(result.path)).toEqual(bytes)
    })
  }
})

test("HTTP и небезопасное имя отклоняются до сети и записи", () => fixture(async directory => {
  let requests = 0
  const options = { channel: "stable" as const, version: "1.0.9", request: async () => { requests++; return new Response(bytes) } }
  await expect(downloadUnixUpdateFile("http://github.com", file, directory, options)).rejects.toThrow()
  for (const name of ["../escape", "/absolute", "a\\b", "a:b", "..", "bad\u0000"]) {
    await expect(downloadUnixUpdateFile(base, { ...file, file: name }, directory, options)).rejects.toThrow()
  }
  expect(requests).toBe(0)
  expect(await readdir(directory)).toEqual([])
}))

test("разрешён только официальный base URL канала, не historical tag или подкаталог", () => fixture(async directory => {
  const result = await downloadUnixUpdateFile(base, file, directory, { channel: "stable", version: "1.0.9", request: async () => new Response(bytes) })
  expect(await readFile(result.path)).toEqual(bytes)
  await rm(result.directory, { recursive: true, force: true })
  const historical = base.replace("latest/download", "download/v1.0.8")
  for (const invalid of [historical, historical + "/other", base + "/other", base + "?q=x", base.replace("github.com", "evil.invalid")]) {
    await expect(downloadUnixUpdateFile(invalid, file, directory, { channel: "stable", version: "1.0.9", request: async () => { throw new Error("Must reject before network") } })).rejects.toThrow(/origin/)
  }
}))

test("отмена закрывает даже зависший reader, не ожидая следующего network chunk", () => fixture(async directory => {
  const controller = new AbortController()
  let stream: ReadableStreamDefaultController<Uint8Array> | undefined
  const promise = downloadUnixUpdateFile(base, file, directory, { channel: "stable", version: "1.0.9", signal: controller.signal,
    request: async () => new Response(new ReadableStream<Uint8Array>({ start(value) { stream = value; value.enqueue(bytes.subarray(0, 3)) } })) })
  const timer = setTimeout(() => controller.abort(new Error("user-cancelled")), 30)
  try {
    await expect(Promise.race([promise, Bun.sleep(700).then(() => { throw new Error("reader-did-not-cancel") })])).rejects.toThrow(/user-cancelled/)
  } finally { clearTimeout(timer); try { stream?.close() } catch {}; await promise.catch(() => {}) }
  expect(await readdir(directory)).toEqual([])
}))
