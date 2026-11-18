import { expect, test } from "bun:test"
import { updatedContentItem, scopedContentUpdates, retainInstalledIdentity } from "../../lib/content-update-state"
import type { DbBuildMod, ModVersion, ContentUpdateInfo } from "@xnlc/types"

const oldHash = "a".repeat(40), newHash = "b".repeat(40)
const item: DbBuildMod = { id: oldHash, slug: "old.jar", name: "MoreCulling", description: "Description", version: "1.0.8", source: "modrinth", projectId: "project", versionId: "old-version", icon_url: "https://example.org/icon.png" }
const version: ModVersion = { id: "new-version", name: "MoreCulling 1.0.11 for NeoForge", versionNumber: "1.0.11", gameVersion: "1.21.1", fileName: "new.jar", fileSize: 1, downloadCount: 0, files: [{ url: "https://example.org/new.jar", filename: "new.jar", size: 1, hashes: { sha1: newHash } }] }

test("новый файл немедленно получает новый hash/versionId и сохраняет иконку", () => {
  const updated = updatedContentItem(item, version)
  expect(updated).toMatchObject({ id: newHash, slug: "new.jar", version: "1.0.11", versionId: "new-version", icon_url: item.icon_url, projectId: "project" })
  expect(item.id).toBe(oldHash)
})

test("CurseForge без SHA-1 не наследует хеш старого файла", () => {
  const updated = updatedContentItem({ ...item, source: "curseforge", modId: 123, fileId: 1, versionId: undefined }, { ...version, id: "2", files: [{ url: "url", filename: "new.jar", size: 1 }] })
  expect(updated.id).not.toBe(oldHash)
  expect(updated.fileId).toBe(2)
  expect(updated.versionId).toBeUndefined()
})

test("скан тех же байтов не теряет точную версию пакета и идентификаторы", () => {
  const installed = updatedContentItem(item, version)
  const scanned = { ...installed, version: "34", versionId: undefined, source: "local" as const, icon_url: undefined }
  expect(retainInstalledIdentity(installed, scanned)).toMatchObject({ version: "1.0.11", versionId: "new-version" })
  expect(retainInstalledIdentity(installed, { ...scanned, id: "c".repeat(40) }).versionId).toBeUndefined()
})

test("во вкладке ресурспаков нет обновлений модов и они не входят в обновить все", () => {
  const update = { itemId: oldHash, contentType: "mods", source: "modrinth", name: "Mod", currentVersion: "1", latestVersion: version } as ContentUpdateInfo
  const pack = { ...update, itemId: "pack", contentType: "resourcepacks" as const }
  expect(scopedContentUpdates([update, pack], "resourcepacks")).toEqual([pack])
  expect(scopedContentUpdates([update], "shaders")).toEqual([])
})
