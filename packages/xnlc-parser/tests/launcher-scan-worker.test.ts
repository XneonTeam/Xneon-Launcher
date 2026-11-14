import { expect, test } from "bun:test"
import AdmZip from "adm-zip"
import { copyFile, mkdtemp, rm, stat, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { pauseScanFiles, runScanWorker } from "@xnlc/parser"
import { curseforgeFingerprint } from "../src"
import { checkLoaderRequirements } from "../../../electrobun/main/mods-loader-requirements"

test("worker обрабатывает 220 архивов, не блокируя основной поток, и поддерживает отмену", async () => {
  const dir = await mkdtemp(join(tmpdir(), "xnlc-scan-worker-"))
  try {
    const zip = new AdmZip()
    zip.addFile("fabric.mod.json", Buffer.from('{"id":"demo","name":"Demo","version":"1","depends":{"fabricloader":">=0.15"}}'))
    const first = join(dir, "0.jar")
    await writeFile(first, zip.toBuffer())
    const files = await Promise.all(Array.from({ length: 220 }, async (_, i) => {
      const filePath = join(dir, `${i}.jar`)
      if (i) await copyFile(first, filePath)
      return { filePath }
    }))
    let ticks = 0
    const timer = setInterval(() => ticks++, 2)
    const results: string[] = []
    try {
      await runScanWorker(files, { sha1: true, metadata: true }, result => {
        expect(result.inspection?.metadata?.name).toBe("Demo")
        expect(result.inspection?.sha1).toMatch(/^[a-f0-9]{40}$/)
        results.push(result.filePath)
      })
    } finally { clearInterval(timer) }
    expect(results).toHaveLength(220)
    expect(new Set(results)).toEqual(new Set(files.map(file => file.filePath)))
    expect(ticks).toBeGreaterThan(0)

    let fingerprint: number | null | undefined
    await runScanWorker([{ filePath: first }], { curseforgeFingerprint: true }, result => { fingerprint = result.inspection?.curseforgeFingerprint })
    expect(fingerprint).toBe(curseforgeFingerprint(zip.toBuffer()))
    const requirements = await checkLoaderRequirements(dir, "fabric", "0.14.0")
    expect(requirements.checked).toBe(220)
    expect(requirements.issues).toHaveLength(220)
    expect(requirements.issues[0].satisfied).toBe(false)

    const controller = new AbortController()
    let received = 0
    await expect(runScanWorker(files, { metadata: true }, () => {
      if (++received === 4) controller.abort()
    }, controller.signal)).rejects.toMatchObject({ name: "AbortError" })
    expect(received).toBeLessThan(220)
  } finally { await rm(dir, { recursive: true, force: true }) }
}, 30000)

test("удаление прерывает чтение выбранного JAR, остальные файлы продолжают сканироваться", async () => {
  const dir = await mkdtemp(join(tmpdir(), "xnlc-worker-delete-"))
  try {
    const jar = new AdmZip()
    jar.addFile("fabric.mod.json", Buffer.from('{"id":"demo","name":"Demo","version":"1"}'))
    const bytes = jar.toBuffer()
    const files = await Promise.all(Array.from({ length: 24 }, async (_, i) => {
      const filePath = join(dir, `${i}.jar`)
      await writeFile(filePath, bytes)
      return { filePath }
    }))
    const target = files[23].filePath
    // Хэш большого файла оставляет время передать отмену после первой пачки.
    await writeFile(target, Buffer.alloc(32 * 1024 * 1024))
    const results = new Map<string, string | undefined>()
    let targetError: string | undefined
    let deletion: Promise<void> | undefined
    await runScanWorker(files, { sha1: true, metadata: true }, result => {
      results.set(result.filePath, result.inspection?.metadata?.name)
      if (result.filePath === target) targetError = result.error
      deletion ??= pauseScanFiles([target], async () => {
        // Новый запрос на тот же JAR не может открыть его до конца удаления.
        await runScanWorker([{ filePath: target }], { metadata: true }, blocked => {
          expect(blocked.inspection).toBeUndefined()
          expect(blocked.error).toBe("Content is being deleted")
        })
        await rm(target)
      })
    })
    await deletion
    await expect(stat(target)).rejects.toMatchObject({ code: "ENOENT" })
    expect(results.has(target)).toBe(true)
    expect(results.get(target)).toBeUndefined()
    expect(targetError).toBe("Content is being deleted")
    expect([...results.values()].filter(name => name === "Demo")).toHaveLength(23)
  } finally { await rm(dir, { recursive: true, force: true }) }
}, 30000)
