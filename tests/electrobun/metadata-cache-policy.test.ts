import { expect, test } from "bun:test"

function scenario(body: string) {
  const code = `
    import assert from "node:assert/strict"
    const { enrichBuildModNames, clearModrinthEnrichCache } = await import("./lib/modrinth-metadata.ts")
    const items = [{ slug: "pack.zip", name: "Local name", projectId: "project", source: "modrinth" }]
    ${body}
  `
  const result = Bun.spawnSync([process.execPath, "--no-env-file", "-e", code], { stdout: "pipe", stderr: "pipe" })
  expect(result.exitCode, result.stderr.toString()).toBe(0)
}

test("одинаковые параллельные fallback запросы разделяют одну загрузку", () => scenario(`
  const gate = Promise.withResolvers()
  let requests = 0
  globalThis.fetch = async () => { requests++; await gate.promise; return Response.json([{ id: "project", title: "Remote name", author: "Author" }]) }
  const first = enrichBuildModNames(items), second = enrichBuildModNames(items)
  gate.resolve()
  await Promise.all([first, second])
  assert.equal(requests, 1)
`))

test("отрицательный cache истекает; fallback не заменяет известные данные", () => scenario(`
  let now = 1000, requests = 0
  Date.now = () => now
  globalThis.fetch = async () => { requests++; if (requests === 1) throw new Error("offline"); return Response.json([{ id: "project", title: "Remote name", author: "Recovered" }]) }
  await enrichBuildModNames(items)
  await enrichBuildModNames(items)
  assert.equal(requests, 1)
  now += 31000
  const recovered = await enrichBuildModNames(items)
  assert.equal(requests, 2)
  assert.equal(recovered[0].author, "Recovered")
  assert.equal(recovered[0].name, "Local name")
  const known = await enrichBuildModNames([{ ...items[0], author: "Authoritative" }])
  assert.equal(known[0].author, "Authoritative")
`))

test("очистка cache во время запроса не позволяет старому ответу заменить новый", () => scenario(`
  const gate = Promise.withResolvers()
  let requests = 0
  globalThis.fetch = async () => { const index = ++requests; if (index === 1) await gate.promise; return Response.json([{ id: "project", author: index === 1 ? "Old" : "New" }]) }
  const old = enrichBuildModNames(items)
  clearModrinthEnrichCache()
  await enrichBuildModNames(items)
  gate.resolve()
  await old
  assert.equal((await enrichBuildModNames(items))[0].author, "New")
`))
