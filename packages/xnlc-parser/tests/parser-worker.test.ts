import { expect, test } from "bun:test"
import AdmZip from "adm-zip"
import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { ParserWorker } from "../src"

test("дедлайн ограничивает ожидание worker", async () => {
  const worker = new ParserWorker(1, 1)
  try { await expect(worker.analyze("absent.jar")).rejects.toMatchObject({ code: "TIMEOUT" }) }
  finally { await worker.close() }
})

test("worker сообщает об ошибке отсутствующего файла", async () => {
  const worker = new ParserWorker()
  try { await expect(worker.analyze("Z:/xnlc-missing.jar")).rejects.toMatchObject({ code: "IO_ERROR" }) }
  finally { await worker.close() }
})

test("самостоятельный worker обрабатывает файлы, ограничивает очередь и закрывается", async () => {
  const dir = await mkdtemp(join(tmpdir(), "xnlc-package-worker-")), path = join(dir, "mod.jar")
  const zip = new AdmZip(); zip.addFile("fabric.mod.json", Buffer.from('{"id":"demo","version":"1"}')); await writeFile(path, zip.toBuffer())
  const worker = new ParserWorker(1)
  try {
    const first = worker.analyze(path)
    await expect(worker.analyze(path)).rejects.toMatchObject({ code: "LIMIT_EXCEEDED" })
    expect((await first).mods[0].id).toBe("demo")
    await expect(worker.analyze(join(dir, "missing.jar"))).rejects.toMatchObject({ code: "IO_ERROR" })
    const controller = new AbortController(); controller.abort()
    await expect(worker.analyze(path, { signal: controller.signal })).rejects.toMatchObject({ code: "ABORTED" })
  } finally { await worker.close(); await rm(dir, { recursive: true, force: true }) }
  await expect(worker.analyze(path)).rejects.toMatchObject({ code: "CLOSED" })
})

test("отмена ожидающей задачи не отменяет соседнюю", async () => {
  const dir = await mkdtemp(join(tmpdir(), "xnlc-package-worker-")), path = join(dir, "mod.jar")
  const zip = new AdmZip(); zip.addFile("fabric.mod.json", Buffer.from('{"id":"demo","version":"1"}')); await writeFile(path, zip.toBuffer())
  const worker = new ParserWorker(2), controller = new AbortController()
  try {
    const first = worker.analyze(path), second = worker.analyze(path, { signal: controller.signal })
    controller.abort()
    await expect(second).rejects.toMatchObject({ code: "ABORTED" })
    expect((await first).mods[0].id).toBe("demo")
  } finally { await worker.close(); await rm(dir, { recursive: true, force: true }) }
})

test("активная отмена и закрытие отклоняют ожидающие задачи", async () => {
  const worker = new ParserWorker(2), controller = new AbortController()
  const active = worker.analyze("Z:/xnlc-cancel.jar", { signal: controller.signal })
  const queued = worker.analyze("Z:/xnlc-queued.jar")
  const settled = Promise.allSettled([active, queued])
  controller.abort()
  await worker.close()
  const results = await settled
  expect(results[0]).toMatchObject({ status: "rejected", reason: { code: "ABORTED" } })
  expect(results[1]).toMatchObject({ status: "rejected", reason: { code: "CLOSED" } })
})

test("worker фиксирует лимиты в момент постановки задачи", async () => {
  const dir = await mkdtemp(join(tmpdir(), "xnlc-worker-options-")), path = join(dir, "mod.jar")
  const zip = new AdmZip(); zip.addFile("fabric.mod.json", Buffer.from('{"id":"demo","version":"1"}')); await writeFile(path, zip.toBuffer())
  const worker = new ParserWorker(), options = { limits: { maxMetadataSize: 2 } }
  try {
    const pending = worker.analyze(path, options)
    options.limits.maxMetadataSize = 1000
    expect((await pending).diagnostics[0]?.code).toBe("LIMIT_EXCEEDED")
  } finally { await worker.close(); await rm(dir, { recursive: true, force: true }) }
})
