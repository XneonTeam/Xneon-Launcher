import { expect, test } from "bun:test"
import fs from "node:fs"
import vm from "node:vm"
import { transformSync } from "esbuild"
import { datapackVersionFile, datapackVersions } from "../../lib/datapack-version"
import { findInstalledDatapack } from "../../lib/datapack-installed"

function fixture() {
  const source = fs.readFileSync(new URL("../../components/launcher/instance/instance-worlds-tab.tsx", import.meta.url), "utf8")
  const start = source.indexOf("  const runDatapackInstall =")
  expect(start, "Установка датапаков должна владеть уведомлением от клика до результата").toBeGreaterThan(-1)
  const end = source.indexOf("  const handleInstallDatapackLocal", start)
  const events: any[] = []
  const run = vm.runInNewContext(transformSync(source.slice(start, end) + "\nrunDatapackInstall", { loader: "ts" }).code, {
    t: (key: string) => key,
    beginContentInstall: (event: any) => events.push(["begin", event]),
    endContentInstall: () => events.push(["end"]),
    pushNotification: (event: any) => events.push(["notice", event]),
    isContentDownloadCancelled: () => false, showAlert: (message: string) => events.push(["alert", message]),
  })
  return { run, events }
}

test("датапак: живое уведомление начинается до скачивания, успех — после подтверждения файла", async () => {
  const { run, events } = fixture()
  const gate = Promise.withResolvers<boolean>()
  const pending = run("VeinMiner", () => gate.promise)
  expect(events[0][0]).toBe("begin")
  expect(events.some(event => event[1]?.kind === "success")).toBe(false)
  gate.resolve(true)
  expect(await pending).toBe(true)
  expect(events.find(event => event[1]?.kind === "success")[1]).toMatchObject({ source: "install", message: "VeinMiner" })
  expect(events.at(-1)).toEqual(["end"])
})

test("датапак: сбой/отсутствующий файл не показывают успех и всегда снимают загрузку", async () => {
  for (const install of [async () => false, async () => { throw new Error("disk full") }]) {
    const { run, events } = fixture()
    expect(await run("Pack", install)).toBe(false)
    expect(events.some(event => event[1]?.kind === "success")).toBe(false)
    expect(events.some(event => event[1]?.kind === "error")).toBe(true)
    expect(events.at(-1)).toEqual(["end"])
  }
})

test("модал версий мира возвращает промис установки, а не забывает его через void", () => {
  const source = fs.readFileSync(new URL("../../components/launcher/instance/instance-worlds-tab.tsx", import.meta.url), "utf8")
  const callback = source.match(/onInstallVersion=\{\(version\) => \{([\s\S]*?)\n        \}\}/)?.[1]
  expect(callback).toBeDefined()
  expect(callback).not.toContain("void handleInstall")
  expect(callback).toContain("return handleInstallDatapackVersion")
})

test("локальный ZIP, каталог и выбранная версия действительно проходят через уведомление и возвращают результат", async () => {
  const source = fs.readFileSync(new URL("../../components/launcher/instance/instance-worlds-tab.tsx", import.meta.url), "utf8")
  const version = { id: "chosen", name: "Pack 1", gameVersion: "1.21.1", loaders: ["datapack"], fileName: "pack.zip", downloadUrl: "https://example.org/pack.zip", fileSize: 1, downloadCount: 0 }
  for (const success of [true, false]) {
    for (const name of ["handleInstallDatapackLocal", "handleInstallDatapackRemote", "handleInstallDatapackVersion"]) {
      const start = source.indexOf(`  const ${name} =`)
      const nextHandler = source.indexOf("\n  const ", start + 1)
      const end = nextHandler === -1 ? source.indexOf("\n  return (", start) : nextHandler
      const calls: any[] = []
      const handler = vm.runInNewContext(transformSync(source.slice(start, end) + `\n${name}`, { loader: "ts" }).code, {
        selectedWorld: { folder: "World", mcVersion: "1.21.1" }, build: { name: "Build", version: "1.21.1" }, selectedDetails: { source: "modrinth", name: "Pack" },
        runDatapackInstall: async (itemName: string, action: Function) => { calls.push(["notification", itemName]); return action() },
        datapackVersionFile, datapackVersions, findInstalledDatapack, datapacks: [], installing: null, setInstalling() {}, showAlert() {}, t: (key: string) => key,
        refreshDatapacks: async () => { calls.push(["refresh"]) },
        window: { electrobunAPI: {
          getFilePath: async () => "C:/pack.zip", modsModrinthVersions: async () => [version],
          installDatapackLocal: async (...args: any[]) => { calls.push(args); return { success } },
          installDatapackRemote: async (...args: any[]) => { calls.push(args); return { success } },
        } },
      })
      const input = name === "handleInstallDatapackVersion" ? version : name === "handleInstallDatapackLocal" ? { name: "pack.zip" } : { source: "modrinth", id: "pack", slug: "pack", name: "Pack" }
      expect(await handler(input)).toBe(success)
      expect(calls[0][0]).toBe("notification")
      expect(calls[1][0]).toBe("Build")
      expect(calls[1][1]).toBe("World")
      expect(calls.some(call => call[0] === "refresh")).toBe(success)
    }
  }
})
