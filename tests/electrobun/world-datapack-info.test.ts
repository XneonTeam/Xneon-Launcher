import { expect, test } from "bun:test"
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { PNG } from "pngjs"
import TestZip from "../helpers/zip"
import { analyzeDatapack } from "../../packages/xnlc-parser/src"
import { localDatapackDisplay, enrichDatapacks as enrichWithProviders, type CurseforgeDatapackClient } from "../../electrobun/main/world-datapack-info"
import { curseforgeFingerprintFile } from "../../packages/xnlc-parser/src"
import type { DatapackInfo } from "@xnlc/types"

const enrichDatapacks = (items: DatapackInfo[], fetcher: typeof fetch, client: CurseforgeDatapackClient | null = null) => enrichWithProviders(items, fetcher, client)

test("читает название, составной текст и pack.png из ZIP", async () => {
  const root = await mkdtemp(join(tmpdir(), "xnl-datapack-"))
  try {
    const zip = new TestZip()
    zip.addFile("pack.mcmeta", Buffer.from(JSON.stringify({ pack: { pack_format: 48, description: [{ text: "§aTerralith" }, { text: "\nWorld generation", extra: [{ text: "!" }] }] } })))
    const png = new PNG({ width: 1, height: 1 })
    zip.addFile("pack.png", PNG.sync.write(png))
    const file = join(root, "Terralith_v2.zip")
    await writeFile(file, zip.toBuffer())
    const result = await localDatapackDisplay(file, await analyzeDatapack(file))
    expect(result.displayName).toBe("Terralith")
    expect(result.description).toBe("Terralith\nWorld generation!")
    expect(result.iconUrl).toStartWith("data:image/png;base64,")
  } finally { await rm(root, { recursive: true, force: true }) }
})

test("Modrinth определяется по SHA-1, автор берётся из команды проекта", async () => {
  const root = await mkdtemp(join(tmpdir(), "xnl-datapack-"))
  try {
    const file = join(root, "renamed.zip")
    await writeFile(file, "archive")
    const item = { name: "renamed.zip", path: file, sizeBytes: 7, lastModified: 1 }
    const hash = new Bun.CryptoHasher("sha1").update("archive").digest("hex")
    const fetcher = (async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input)
      if (url.endsWith("/version_files")) {
        expect(JSON.parse(String(init?.body))).toEqual({ hashes: [hash], algorithm: "sha1" })
        return Response.json({ [hash]: { project_id: "project" } })
      }
      if (url.includes("/projects?")) return Response.json([{ id: "project", title: "Terralith", icon_url: "https://cdn.modrinth.com/icon.png", team: "team" }])
      if (url.endsWith("/team/team/members")) return Response.json([{ role: "Owner", user: { username: "Stardust Labs" } }])
      throw new Error(url)
    }) as typeof fetch
    let curseforgeCalls = 0
    const [result] = await enrichDatapacks([item], fetcher, {
      matches: async () => { curseforgeCalls++; return { exactMatches: [] } },
      project: async () => { throw new Error("Unexpected project lookup") },
    })
    expect(result.displayName).toBe("Terralith")
    expect(result.author).toBe("Stardust Labs")
    expect(result.iconUrl).toBe("https://cdn.modrinth.com/icon.png")
    expect(result.name).toBe("renamed.zip")
    expect(curseforgeCalls).toBe(0)
    const [offline] = await enrichDatapacks([item], (async () => { throw new Error("offline") }) as typeof fetch)
    expect(offline).toEqual(item)
  } finally { await rm(root, { recursive: true, force: true }) }
})

test("папка датапака использует локальную иконку и не отправляется в Modrinth", async () => {
  const root = await mkdtemp(join(tmpdir(), "xnl-datapack-"))
  try {
    await mkdir(join(root, "data", "example"), { recursive: true })
    await writeFile(join(root, "pack.mcmeta"), JSON.stringify({ pack: { name: "Example Pack", pack_format: 48, description: { text: "Description", extra: [{ text: " extra" }] } } }))
    await writeFile(join(root, "pack.png"), PNG.sync.write(new PNG({ width: 1, height: 1 })))
    const pack = await analyzeDatapack(root)
    const metadata = await localDatapackDisplay(root, pack)
    expect(metadata.displayName).toBe("Example Pack")
    expect(metadata.description).toBe("Description extra")
    expect(metadata.iconUrl).toStartWith("data:image/png;base64,")
    const item = { name: "folder", path: root, sizeBytes: 0, lastModified: 1, ...metadata }
    const result = await enrichDatapacks([item], (async () => { throw new Error("Unexpected network call") }) as typeof fetch)
    expect(result).toEqual([item])
    await writeFile(join(root, "pack.png"), "broken")
    expect((await localDatapackDisplay(root, pack)).iconUrl).toBeUndefined()
  } finally { await rm(root, { recursive: true, force: true }) }
})

test("неизвестный хеш и отказ Modrinth сохраняют локальное название", async () => {
  const root = await mkdtemp(join(tmpdir(), "xnl-datapack-"))
  try {
    const file = join(root, "Example_Pack_v1.zip")
    const zip = new TestZip()
    zip.addFile("pack.mcmeta", Buffer.from('{"pack":{"pack_format":48}}'))
    await writeFile(file, zip.toBuffer())
    const local = await localDatapackDisplay(file, await analyzeDatapack(file))
    expect(local.displayName).toBe("Example Pack")
    expect(local.iconUrl).toBeUndefined()
    const item = { name: "Example_Pack_v1.zip", path: file, sizeBytes: 0, lastModified: 1, ...local }
    expect(await enrichDatapacks([item], (async () => Response.json({})) as typeof fetch)).toEqual([item])
    expect(await enrichDatapacks([item], (async () => new Response("", { status: 429 })) as typeof fetch)).toEqual([item])
  } finally { await rm(root, { recursive: true, force: true }) }
})

test("CurseForge распознаёт ZIP по fingerprint после промаха или сбоя Modrinth", async () => {
  const root = await mkdtemp(join(tmpdir(), "xnl-cf-datapack-"))
  try {
    const file = join(root, "renamed.zip")
    await writeFile(file, "datapack archive")
    const fingerprint = await curseforgeFingerprintFile(file)
    const hash = new Bun.CryptoHasher("sha1").update("datapack archive").digest("hex")
    const item = { name: "renamed.zip", path: file, sizeBytes: 16, lastModified: 1, displayName: "Local", description: "Local description" }
    const client: CurseforgeDatapackClient = {
      matches: async fingerprints => {
        expect(fingerprints).toEqual([fingerprint])
        return { exactMatches: [{ fileFingerprint: fingerprint, modId: 513688, fileId: 1, sha1: hash }] }
      },
      project: async id => {
        expect(id).toBe(513688)
        return { name: "Terralith", iconUrl: "https://media.forgecdn.net/icon.png", author: "Starmute, catter1", slug: "terralith" }
      },
    }
    for (const fetcher of [(async () => Response.json({})) as typeof fetch, (async () => { throw new Error("offline") }) as typeof fetch]) {
      const [result] = await enrichDatapacks([item], fetcher, client)
      expect(result.displayName).toBe("Terralith")
      expect(result.author).toBe("Starmute, catter1")
      expect(result.iconUrl).toBe("https://media.forgecdn.net/icon.png")
      expect(result.name).toBe(item.name)
      expect(result.description).toBe(item.description)
    }
    const [collision] = await enrichDatapacks([item], (async () => Response.json({})) as typeof fetch, {
      ...client,
      matches: async () => ({ exactMatches: [{ fileFingerprint: fingerprint, modId: 1, fileId: 1, sha1: "different" }] }),
      project: async () => { throw new Error("Unexpected project lookup") },
    })
    expect(collision).toEqual(item)
    const [offline] = await enrichDatapacks([item], (async () => Response.json({})) as typeof fetch, {
      ...client, matches: async () => { throw new Error("offline") },
    })
    expect(offline).toEqual(item)
  } finally { await rm(root, { recursive: true, force: true }) }
})
