import { expect, test } from "bun:test"
import { clearModrinthEnrichCache, enrichBuildModNames } from "../../lib/modrinth-metadata"

test("автор установленного ресурспака берётся из команды Modrinth", async () => {
  clearModrinthEnrichCache()
  const previousFetch = globalThis.fetch
  const calls: string[] = []
  globalThis.fetch = (async input => {
    const url = String(input)
    calls.push(url)
    if (url.includes("/projects?")) return Response.json([{ id: "pack-id", title: "Pack", team: "team-id" }])
    if (url.includes("/teams?")) return Response.json([[{ team_id: "team-id", role: "Member", user: { username: "contributor" } }, { team_id: "team-id", role: "Owner", user: { username: "Author" } }]])
    throw new Error(`Unexpected request: ${url}`)
  }) as typeof fetch
  try {
    const items = [{ slug: "pack.zip", name: "Pack", source: "modrinth" as const, projectId: "pack-id" }]
    const initial = await enrichBuildModNames(items)
    expect(initial[0].author).toBeUndefined()
    const enriched = await enrichBuildModNames(items, { includeOwners: true })
    expect(enriched[0].author).toBe("Author")
    expect((await enrichBuildModNames(items))[0].author).toBeUndefined()
    const count = calls.length
    expect((await enrichBuildModNames(items, { includeOwners: true }))[0].author).toBe("Author")
    expect(calls).toHaveLength(count)
  } finally {
    globalThis.fetch = previousFetch
    clearModrinthEnrichCache()
  }
})
