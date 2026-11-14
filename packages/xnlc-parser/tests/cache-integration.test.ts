import { expect, test } from "bun:test"
import AdmZip from "adm-zip"
import { copyFile, mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

test("устаревшие локальные metadata обновляются без потери внешних идентификаторов", async () => {
  const dir = await mkdtemp(join(tmpdir(), "xnlc-cache-"))
  try {
    const zip = new AdmZip()
    zip.addFile("fabric.mod.json", Buffer.from('{"id":"demo","name":"Updated","version":"2","depends":{"fabricloader":">=0.15"}}'))
    const file = join(dir, "demo.jar")
    await writeFile(file, zip.toBuffer())
    const missingName = new AdmZip()
    missingName.addFile("fabric.mod.json", Buffer.from('{"id":"unnamed"}'))
    const unnamed = join(dir, "unnamed.jar")
    await writeFile(unnamed, missingName.toBuffer())
    const batch = await Promise.all(Array.from({ length: 24 }, async (_, index) => {
      const target = join(dir, `batch-${index}.jar`)
      await copyFile(file, target)
      return target
    }))
    const code = `
      import { mock } from "bun:test"
      import assert from "node:assert/strict"
      import { stat } from "node:fs/promises"
      import { resolve } from "node:path"
      let row = { sha1:"unused", name:"Old", version:"1", description:"kept", icon:"", author:"", source:"local", projectId:"project", versionId:"version", modId:42, fileId:43, cfChecked:1, parserVersion:"old", updatedAt:1 }
      let writes = 0
      mock.module("./electrobun/db/index.ts", () => ({ dbHelpers: {
        getFileSnapshots: async () => [], upsertFileSnapshots: async () => {},
        getResources: async ids => ids.map(sha1 => ({ ...row, sha1 })),
        upsertResources: async values => { if (values.length) { writes++; row = { ...values[0], updatedAt: 2 } } },
        markResourcesCurseforgeChecked: async () => {}, setResourcesCurseforge: async () => {},
      } }))
      mock.module("./electrobun/main/builds/helpers.ts", () => ({ loadModsModule: async () => { throw new Error("offline") } }))
      mock.module("./electrobun/main/runtime.ts", () => ({ logRuntime: () => {} }))
      const { cachedLoaderRequirements, setScanWorkerEntry } = await import("@xnlc/parser")
      setScanWorkerEntry(resolve("dist-workers/scan-worker.js"))
      const { resolveContentEntries } = await import("./electrobun/main/builds/content-resolver.ts")
      const first = await resolveContentEntries([process.env.XNLC_TEST_FILE])
      assert.equal(first[process.env.XNLC_TEST_FILE].name, "Updated")
      const snapshot = await stat(process.env.XNLC_TEST_FILE)
      assert.equal(cachedLoaderRequirements(process.env.XNLC_TEST_FILE, snapshot).requirements[0].requirement, ">=0.15")
      assert.equal(cachedLoaderRequirements(process.env.XNLC_TEST_FILE, { ...snapshot, ctimeMs: snapshot.ctimeMs + 1 }), undefined)
      assert.equal(row.description, "kept")
      assert.equal(row.projectId, "project")
      assert.equal(row.versionId, "version")
      assert.equal(row.modId, 42)
      assert.equal(row.fileId, 43)
      assert.equal(row.cfChecked, 1)
      assert.equal(row.parserVersion, "@xnlc/parser@1.0.0")
      assert.equal(writes, 1)
      await resolveContentEntries([process.env.XNLC_TEST_FILE])
      assert.equal(writes, 1)
      row = { ...row, source:"modrinth", name:"Remote", parserVersion:"old" }
      const remote = await resolveContentEntries([process.env.XNLC_TEST_FILE])
      assert.equal(remote[process.env.XNLC_TEST_FILE].name, "Remote")
      assert.equal(writes, 1)
      row = { ...row, source:"local", name:"Saved", parserVersion:"old" }
      const incomplete = await resolveContentEntries([process.env.XNLC_TEST_UNNAMED])
      assert.equal(incomplete[process.env.XNLC_TEST_UNNAMED].name, "Saved")
      assert.equal(writes, 2)
      await resolveContentEntries([process.env.XNLC_TEST_UNNAMED])
      assert.equal(writes, 2)
      row = { ...row, name:"", parserVersion:"old" }
      const unnamedResult = await resolveContentEntries([process.env.XNLC_TEST_UNNAMED])
      assert.equal(unnamedResult[process.env.XNLC_TEST_UNNAMED].name, "")
      assert.equal(writes, 3)
      await resolveContentEntries([process.env.XNLC_TEST_UNNAMED])
      assert.equal(writes, 3)
      row = { ...row, parserVersion:"old" }
      const batch = JSON.parse(process.env.XNLC_TEST_BATCH)
      const missing = batch[0] + ".missing"
      const controller = new AbortController()
      await assert.rejects(resolveContentEntries(batch, done => {
        if (done >= 8) controller.abort()
      }, controller.signal), { name: "AbortError" })
      const scanned = await resolveContentEntries([...batch, missing])
      assert.equal(scanned[missing].diagnostics[0].code, "SCAN_ERROR")
      for (const path of batch) assert.equal(scanned[path].name, "Updated")
    `
    const processResult = Bun.spawnSync([process.execPath, "-e", code], { env: { ...process.env, XNLC_TEST_FILE: file, XNLC_TEST_UNNAMED: unnamed, XNLC_TEST_BATCH: JSON.stringify(batch) }, stdout: "pipe", stderr: "pipe" })
    expect({ exitCode: processResult.exitCode, stderr: processResult.stderr.toString() }).toEqual({ exitCode: 0, stderr: "" })
  } finally { await rm(dir, { recursive: true, force: true }) }
}, 30000)

