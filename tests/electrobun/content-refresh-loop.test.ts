import { expect, test } from "bun:test"
import { mkdir, mkdtemp, rm, stat, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

test("скан не возвращает удалённый JAR и видит установленный во время прохода", async () => {
  const dir = await mkdtemp(join(tmpdir(), "xnlc-scan-race-"))
  try {
    const mods = join(dir, "mods")
    await mkdir(mods)
    await writeFile(join(mods, "old.jar"), "old")
    const code = `
      import { mock } from "bun:test"
      import assert from "node:assert/strict"
      import { rm, writeFile } from "node:fs/promises"
      import { join } from "node:path"
      const dir = process.env.CONTENT_TEST_DIR
      const oldPath = join(dir, "mods", "old.jar")
      const newPath = join(dir, "mods", "new.jar.disabled")
      const started = Promise.withResolvers()
      const release = Promise.withResolvers()
      const calls = []
      mock.module("./electrobun/main/builds/content-resolver.ts", () => ({
        resolveContentEntries: async files => {
          calls.push(files)
          if (calls.length === 1) {
            started.resolve()
            await release.promise
          }
          return {}
        }
      }))
      mock.module("./electrobun/main/builds/helpers.ts", () => ({ formatDisplayNameFromFileName: name => name }))
      const { scanIntentDir } = await import("./electrobun/main/builds/scanner.ts")
      const scan = scanIntentDir(dir)
      await started.promise
      assert.equal(scanIntentDir(dir), scan)
      await rm(oldPath)
      await writeFile(newPath, "new")
      release.resolve()
      const result = await scan
      assert.deepEqual(calls, [[oldPath], [newPath]])
      assert.deepEqual(result.mods.map(({ slug, enabled }) => [slug, enabled]), [["new.jar", false]])
      assert.deepEqual(result.installedMods, { "new.jar": newPath })
    `
    const result = Bun.spawnSync([process.execPath, "-e", code], { env: { ...process.env, CONTENT_TEST_DIR: dir }, stdout: "pipe", stderr: "pipe" })
    expect({ code: result.exitCode, stderr: result.stderr.toString() }).toEqual({ code: 0, stderr: "" })
  } finally { await rm(dir, { recursive: true, force: true }) }
}, 10000)

test("ресурс без имени из Modrinth не запускает повторное сетевое обогащение", async () => {
  const dir = await mkdtemp(join(tmpdir(), "xnlc-refresh-loop-"))
  try {
    const file = join(dir, "pack.zip")
    await writeFile(file, "fixture")
    const info = await stat(file)
    const code = `
      import { mock } from "bun:test"
      import assert from "node:assert/strict"
      const file = process.env.CONTENT_TEST_FILE, sha1 = "a".repeat(40)
      let networkCalls = 0, writes = 0, events = 0
      mock.module("./electrobun/db/index.ts", () => ({ dbHelpers: {
        getFileSnapshots: async () => [{ path: file, size: Number(process.env.CONTENT_TEST_SIZE), mtime: Number(process.env.CONTENT_TEST_MTIME), sha1 }],
        getResources: async () => [{ sha1, name: "", version: "", description: "", icon: "https://example.invalid/icon.png", author: "", source: "modrinth", projectId: "project", versionId: "version", modId: null, fileId: null, cfChecked: 1 }],
        upsertResources: async values => { if (values.length) writes++ }, upsertFileSnapshots: async () => {},
      } }))
      mock.module("./electrobun/main/builds/helpers.ts", () => ({ loadModsModule: async () => { networkCalls++; throw new Error("unexpected") } }))
      const { contentMetadataEvents } = await import("./electrobun/main/builds/content-metadata-events.ts")
      contentMetadataEvents.on("updated", () => { events++ })
      const { resolveContentEntries } = await import("./electrobun/main/builds/content-resolver.ts")
      const first = await resolveContentEntries([file])
      const second = await resolveContentEntries([file])
      await new Promise(resolve => setTimeout(resolve, 20))
      assert.equal(first[file].source, "modrinth")
      assert.equal(second[file].source, "modrinth")
      assert.equal(networkCalls, 0)
      assert.equal(writes, 0)
      assert.equal(events, 0)
    `
    const result = Bun.spawnSync([process.execPath, "-e", code], { env: { ...process.env, CONTENT_TEST_FILE: file, CONTENT_TEST_SIZE: String(info.size), CONTENT_TEST_MTIME: String(Math.round(info.mtimeMs)) }, stdout: "pipe", stderr: "pipe" })
    expect({ code: result.exitCode, stderr: result.stderr.toString() }).toEqual({ code: 0, stderr: "" })
  } finally { await rm(dir, { recursive: true, force: true }) }
}, 30000)
