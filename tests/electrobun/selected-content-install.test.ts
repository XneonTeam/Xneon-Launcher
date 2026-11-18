import { expect, test } from "bun:test"
import fs from "node:fs"
import vm from "node:vm"
import { transformSync } from "esbuild"

const version = { id: "chosen", name: "Chosen version", versionNumber: "1.11.1", files: [{ url: "https://cdn.example/chosen.zip", filename: "chosen.zip" }] }

function detailHandler(kind: "mod" | "resourcepack" | "shader", saved = true) {
  const source = fs.readFileSync(new URL("../../components/launcher/instance/instance-detail.tsx", import.meta.url), "utf8")
  const start = source.indexOf("  const handleInstallVersion = useCallback(")
  const end = source.indexOf("\n", source.indexOf("  }, [", start))
  const calls: any[] = []
  const scope: any = {
    useCallback: (fn: Function) => fn, detailsKind: kind, detailTab: kind === "resourcepack" ? "resourcepacks" : kind === "shader" ? "shaders" : "mods",
    activeBuild: { id: "build", mods: [], resourcepacks: [], shaders: [] },
    selectedDetails: { id: "project", projectId: "project", slug: "fresh-animations", name: "Fresh Animations", source: "modrinth" },
    beginContentInstall() {}, endContentInstall() {}, updateContentInstall() {}, t: (key: string) => key,
    resolveRequiredDeps: async () => [], filterDepsForBuild: async () => [], askAboutDeps() {}, planDeps() {}, isInstalledBuildMod() {},
    installVersionWithDeps: async () => { calls.push(["mod"]); return saved },
    addContentToBuild: async (...args: any[]) => { calls.push(args); return saved },
    installContentToBuild: async (...args: any[]) => { calls.push(args); return saved },
    updateItemVersion: async (...args: any[]) => { calls.push(args); return saved },
  }
  const handler = vm.runInNewContext(transformSync(source.slice(start, end) + "\nhandleInstallVersion", { loader: "ts" }).code, scope)
  return { handler, calls }
}

test("Версии ресурспака/шейдера передают выбранную версию в соответствующий каталог, не mods", async () => {
  for (const kind of ["resourcepack", "shader"] as const) {
    const fixture = detailHandler(kind)
    expect(await fixture.handler(version)).toBe(true)
    expect(fixture.calls).toHaveLength(1)
    expect(fixture.calls[0]).toContain(kind === "resourcepack" ? "resourcepacks" : "shaders")
    expect(fixture.calls[0]).toContain(version)
    expect(fixture.calls[0][0]).not.toBe("mod")
  }
})

test("неудачная установка выбранной версии не помечается успешной", async () => {
  for (const kind of ["mod", "resourcepack", "shader"] as const) {
    expect(await detailHandler(kind, false).handler(version)).toBe(false)
  }
})

function contentHandler(savedPath: string, persist = true) {
  const source = fs.readFileSync(new URL("../../components/launcher/instance/use-builds.ts", import.meta.url), "utf8")
  const start = source.indexOf("  const addContentToBuild = useCallback(")
  const end = source.indexOf("\n", source.indexOf("  }, [", start))
  const calls: any[] = [], notices: any[] = []
  const build = { id: "build", name: "Build", version: "26.3", modLoader: "fabric", resourcepacks: [], shaders: [] }
  const handler = vm.runInNewContext(transformSync(source.slice(start, end) + "\naddContentToBuild", { loader: "ts" }).code, {
    useCallback: (fn: Function) => fn, builds: [build], crypto, t: (key: string) => key,
    beginContentMutation: () => () => {}, beginContentInstall() {}, endContentInstall() {},
    pushNotification: (notice: any) => notices.push(notice), isContentDownloadCancelled: () => false,
    CONTENT_KIND_BY_KEY: { resourcepacks: "resourcepack", shaders: "shader" },
    pickCompatibleVersion: (versions: any[]) => versions[0],
    updatedContentItem: (item: any, selected: any) => ({ ...item, versionId: selected.id }),
    persistLocalAddition: async (_id: string, apply: Function) => { calls.push(["persist", apply(build)]); return persist ? [build] : null },
    window: { electrobunAPI: {
      modsModrinthVersions: async () => { calls.push(["versions"]); return [{ id: "latest", files: [{ url: "https://cdn.example/latest.zip", filename: "latest.zip" }] }] },
      saveContentToIntent: async (...args: any[]) => { calls.push(args); return savedPath },
    } },
  })
  return { handler, calls, notices }
}

test("сохраняется ровно выбранная версия, без повторного выбора latest", async () => {
  const fixture = contentHandler("C:/Build/resourcepacks/chosen.zip")
  const result = await fixture.handler("build", "resourcepacks", { id: "project", slug: "fresh", name: "Fresh", source: "modrinth" }, version)
  expect(result).toBe(true)
  expect(fixture.calls[0]).toEqual(["Build", "resourcepack", "https://cdn.example/chosen.zip", "chosen.zip"])
  expect(fixture.calls.some(call => call[0] === "versions")).toBe(false)
})

test("нет файла/сохранения метаданных — нет успеха", async () => {
  for (const [path, persist] of [["", true], ["C:/chosen.zip", false]] as const) {
    const fixture = contentHandler(path, persist)
    expect(await fixture.handler("build", "resourcepacks", { id: "project", slug: "fresh", name: "Fresh", source: "modrinth" }, version)).toBe(false)
    expect(fixture.notices.some(notice => notice.kind === "success")).toBe(false)
  }
})
