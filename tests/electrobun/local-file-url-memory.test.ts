import { expect, test } from "bun:test"

function scenario(body: string) {
  const result = Bun.spawnSync([process.execPath, "--no-env-file", "-e", `
    import assert from "node:assert/strict"
    const urls = await import("./lib/local-file-url.ts")
    let created = 0, revoked = 0, reads = 0
    URL.createObjectURL = () => "blob:" + (++created)
    URL.revokeObjectURL = () => { revoked++ }
    globalThis.window = { electrobunAPI: { readLocalFile: async () => { reads++; return btoa("png") } } }
    ${body}
  `], { stdout: "pipe", stderr: "pipe" })
  expect(result.exitCode, result.stderr.toString()).toBe(0)
}

test("blob-URL: параллельные владельцы разделяют чтение и освобождают последний URL", () => scenario(`
  const [a, b] = await Promise.all([urls.localFileToBlobUrl("skin"), urls.localFileToBlobUrl("skin")])
  assert.equal(a, b); assert.equal(reads, 1); assert.equal(created, 1)
  urls.releaseLocalFileUrl("skin"); assert.equal(revoked, 0)
  urls.releaseLocalFileUrl("skin"); assert.equal(revoked, 1)
  urls.releaseLocalFileUrl("skin"); assert.equal(revoked, 1)
`))

test("blob-URL: размонтирование до ответа IPC не создаёт бесхозный URL", () => scenario(`
  const gate = Promise.withResolvers()
  window.electrobunAPI.readLocalFile = () => gate.promise
  const pending = urls.localFileToBlobUrl("late")
  urls.releaseLocalFileUrl("late")
  gate.resolve(btoa("png")); assert.equal(await pending, "")
  assert.equal(created, 0); assert.equal(revoked, 0)
`))

test("blob-URL: 30 циклов не накапливают ресурсы; повторный mount работает", () => scenario(`
  for (let cycle = 0; cycle < 30; cycle++) {
    await urls.localFileToBlobUrl("skin")
    urls.releaseLocalFileUrl("skin")
  }
  assert.equal(created, 30); assert.equal(revoked, 30)
`))
