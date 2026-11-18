import { expect, test } from "bun:test"
import { datapackVersions } from "../../lib/datapack-version"
import type { ModVersion } from "@xnlc/types"

function version(id: string, loaders: string[], fileName: string, gameVersion = "1.21.1"): ModVersion {
  return { id, loaders, fileName, gameVersion, name: id, fileSize: 1, downloadCount: 0, downloadUrl: `https://example.org/${fileName}` }
}

test("VeinMiner: пропускает NeoForge JAR и выбирает совместимый датапак", () => {
  const versions = [version("mod", ["neoforge"], "veinminer.jar"), version("new-pack", ["datapack"], "latest.zip", "26.3"), version("pack", ["datapack"], "Veinminer-1.2.4.zip", "1.21, 1.21.1, 1.21.2")]
  expect(datapackVersions(versions, "1.21.1").map(item => item.id)).toEqual(["pack"])
  expect(datapackVersions(versions).map(item => item.id)).toEqual(["new-pack", "pack"])
})

test("нормализует ZIP и его URL вместо первого файла релиза", () => {
  const pack = version("pack", ["datapack"], "first.jar")
  pack.files = [{ filename: "first.jar", url: "https://example.org/first.jar", size: 1 }, { filename: "actual.zip", url: "https://example.org/actual.zip", size: 1 }]
  expect(datapackVersions([pack])[0]).toMatchObject({ fileName: "actual.zip", downloadUrl: "https://example.org/actual.zip" })
  expect(datapackVersions([version("cf", [], "pack.zip")])).toHaveLength(1)
  expect(datapackVersions([version("plugin", ["paper"], "plugin.jar")])).toEqual([])
  expect(datapackVersions([version("wrong", ["datapack"], "pack.zip", "1.21.10")], "1.21.1")).toEqual([])
})
