import { expect, test } from "bun:test"
import fs from "node:fs"
import vm from "node:vm"
import { transformSync } from "esbuild"
import { updatedContentItem } from "../../lib/content-update-state"

test("успех обновления ждёт записи идентичности в БД, CurseForge URL разрешается для выбора версии", async () => {
  const source = fs.readFileSync(new URL("../../components/launcher/instance/use-builds.ts", import.meta.url), "utf8").replace(/\r\n/g, "\n")
  const start = source.indexOf("  const updateItemVersion = useCallback(")
  const end = source.indexOf("\n\n  return { builds,", start)
  let state = { id: "build", name: "Build", mods: [{ id: "a".repeat(40), slug: "old.jar", version: "1", source: "curseforge", modId: 123, fileId: 1 }], resourcepacks: [], shaders: [], installedMods: { "old.jar": "old" } }
  const gate = Promise.withResolvers<void>()
  let finished = false, persisted = false, resolved = false, update: Function
  const scope = {
    useCallback: (fn: Function) => { update = fn; return fn },
    buildsRef: { current: [state] },
    beginContentMutation: () => () => { finished = true },
    persistLocalAddition: async (_id: string, apply: Function) => { state = apply(state); await gate.promise; persisted = true; return [state] },
    updatedContentItem,
    CONTENT_KIND_BY_KEY: { mods: "mod" },
    CustomEvent: class { constructor(public type: string) {} },
    window: { dispatchEvent: () => {}, electrobunAPI: {
      modsCurseforgeDownloadUrl: async (id: number, modId: number) => { expect(id).toBe(2); expect(modId).toBe(123); resolved = true; return "https://example.org/new.jar" },
      saveModToIntent: async () => "new-path",
      deleteContentFromIntent: async () => ({ success: true }),
    } },
  }
  vm.runInNewContext(transformSync(source.slice(start, end), { loader: "ts" }).code, scope)
  const pending = update!("build", "mods", "a".repeat(40), { id: "2", name: "2", fileName: "new.jar" })
  await new Promise(resolve => setTimeout(resolve, 0))
  expect(resolved).toBe(true)
  expect(finished).toBe(false)
  expect(persisted).toBe(false)
  gate.resolve()
  expect(await pending).toBe(true)
  expect(state.mods[0].fileId).toBe(2)
  expect(state.mods[0].id).not.toBe("a".repeat(40))
  expect(finished).toBe(true)
})
