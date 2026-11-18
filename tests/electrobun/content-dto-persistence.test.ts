import {expect, test} from "bun:test"
import fs from "node:fs"
import vm from "node:vm"
import {transformSync} from "esbuild"
import {Database} from "bun:sqlite"
import * as delta from "../../lib/content-delta"
import * as reconciliation from "../../lib/content-reconciliation"
import {retainInstalledIdentity} from "../../lib/content-update-state"
import {buildContentPatch, createContentRefreshQueue} from "../../lib/build-content-patch"
import {BuildWriteQueue} from "../../lib/build-write-queue"

const source = fs.readFileSync(new URL("../../components/launcher/instance/use-builds.ts", import.meta.url), "utf8")
function callback(name: string, next: string, scope: object) {
  const start = source.indexOf(`  const ${name} = useCallback`)
  const end = source.indexOf(next, start)
  return vm.runInNewContext(transformSync(source.slice(start, end) + `\n${name}`, {loader: "ts"}).code, {
    useCallback: (fn: Function) => fn, ...delta, ...reconciliation, ...scope,
  })
}
const row = (i: number) => ({id: String(i), slug: `${i}.jar`, name: `Mod ${i}`, description: "", version: "1", source: "modrinth", projectId: String(i), author: "Author"})
test("DTO: чужой modId не меняет manifest Modrinth, реальный CurseForge ID и автор меняют", async () => {
  const base = {mods: [row(1)], resourcepacks: [], shaders: [], installedMods: {}}
  const known = await delta.contentManifest(base)
  expect((await delta.createContentDelta({...base, mods: [{...row(1), modId: 123}]}, known)).mods.upsert).toHaveLength(0)
  expect((await delta.createContentDelta({...base, mods: [{...row(1), author: "New author"}]}, known)).mods.upsert).toHaveLength(1)
  expect((await delta.createContentDelta({...base, mods: [{...row(1), author: " Author "}]}, known)).mods.upsert).toHaveLength(0)
  const cf = {...base, mods: [{...row(1), source: "curseforge", modId: 123}]}
  expect((await delta.createContentDelta({...cf, mods: [{...cf.mods[0], modId: 456}]}, await delta.contentManifest(cf))).mods.upsert).toHaveLength(1)
})
test("нормализация не переносит автора/ID Modrinth поверх выбранного CurseForge", async () => {
  const current = {id:"build",name:"Build",mods:[{...row(1), source:"curseforge",modId:123,projectId:undefined,author:"CF author"}],resourcepacks:[],shaders:[],installedMods:{}}
  const sync = callback("syncBuildContent", "  /**", {
    window:{electrobunAPI:{scanBuildIntentContent:async()=>({...current,mods:[{...row(1),author:"MR author"}]})}},
    scanManifestsRef:{current:new Map()},retainInstalledIdentity,
  })
  const result = await sync(current)
  expect(result.mods[0]).toMatchObject({source:"curseforge",modId:123,author:"CF author"})
  expect(result.mods[0].projectId).toBeUndefined()
})
test("локальный DTO не теряет известный сканеру modId при merge", async () => {
  const current={id:"build",name:"Build",mods:[{...row(1),source:"local",projectId:undefined}],resourcepacks:[],shaders:[],installedMods:{}}
  const scanned={...current,mods:[{...current.mods[0],modId:123}]}
  const sync=callback("syncBuildContent","  /**",{window:{electrobunAPI:{scanBuildIntentContent:async()=>scanned}},scanManifestsRef:{current:new Map()},retainInstalledIdentity})
  const merged=await sync(current)
  expect((await delta.createContentDelta(scanned,await delta.contentManifest(merged))).mods.upsert).toHaveLength(0)
})
test("добавление UI fallback автора сохраняет scanner baseline для следующей mutation",async()=>{
  const pack={...row(1),author:undefined}
  const build={id:"build",mods:[],resourcepacks:[pack],shaders:[],installedMods:{}}
  let state=[build]
  const baseline={manifest:await delta.contentManifest(build),base:{mods:new WeakRef(build.mods),resourcepacks:new WeakRef(build.resourcepacks),shaders:new WeakRef(build.shaders),installedMods:new WeakRef(build.installedMods)}}
  const start=source.indexOf("  useEffect(() => {",source.indexOf("// Ресурспаки и шейдеры"))
  const tail="  }, [activeBuild?.id, activeBuild?.resourcepacks, activeBuild?.shaders, setBuilds])"
  const end=source.indexOf(tail,start)+tail.length
  let task:Promise<unknown>|undefined
  vm.runInNewContext(transformSync(source.slice(start,end),{loader:"ts"}).code,{
    activeBuild:build,useEffect:(setup:Function)=>setup(),
    enrichBuildModNames:()=>({then:(fn:Function)=>{task=Promise.resolve().then(()=>fn([{...pack,author:"Owner"}]));return task}}),
    setBuilds:(update:Function)=>{state=update(state)},updateCachedBuildContent:()=>{},
    scanManifestsRef:{current:new Map([[build.id,baseline]])},WeakRef,
  })
  await task
  expect(state[0].resourcepacks[0].author).toBe("Owner")
  expect(baseline.base.resourcepacks.deref()).toBe(state[0].resourcepacks)
  const known=await delta.contentManifest(state[0],{manifest:baseline.manifest,content:{resourcepacks:baseline.base.resourcepacks.deref()}})
  expect((await delta.createContentDelta(build,known)).resourcepacks.upsert).toHaveLength(0)
})
test("после merge 156 DTO установка одного мода даёт один upsert, удаление — только remove", async () => {
  const original = {id: "build", name: "Build", mods: Array.from({length:156}, (_, i) => row(i)), resourcepacks: [], shaders: [], installedMods: {}}
  const scanned = {...original, mods: original.mods.map((item, i) => ({...item, modId: 100+i, author: i<4 ? "Updated author" : item.author}))}
  const sync = callback("syncBuildContent", "  /**", {
    window: {electrobunAPI: {scanBuildIntentContent: async () => scanned}},
    scanManifestsRef: {current: new Map()}, retainInstalledIdentity,
  })
  const merged = await sync(original)
  expect(merged).not.toBeNull()
  const next = {...scanned, mods: [...scanned.mods, {...row(156), modId: 999}]}
  const change = await delta.createContentDelta(next, await delta.contentManifest(merged))
  expect(change.mods.upsert.map(item => item.slug)).toEqual(["156.jar"])
  const removed = await delta.createContentDelta(scanned, await delta.contentManifest(next))
  expect(removed.mods.upsert).toHaveLength(0)
  expect(removed.mods.remove).toEqual(["156.jar"])
})
test("no-op скан после оптимистического удаления всё равно фиксирует SQLite, повторный — нет", async () => {
  const db = new Database(":memory:")
  db.exec("CREATE TABLE builds(id TEXT PRIMARY KEY, mods TEXT, modsCount INTEGER, installedMods TEXT)")
  const saved = {id: "build", mods: [row(0)], resourcepacks: [], shaders: [], installedMods: {"0.jar": "0.jar"}}
  db.query("INSERT INTO builds VALUES (?,?,?,?)").run(saved.id, JSON.stringify(saved.mods), 1, JSON.stringify(saved.installedMods))
  const current = {...saved, mods: [], installedMods: {}}
  const savedRef = {current: new Map([[saved.id, saved]])}
  let writes = 0
  let failNext = true
  const writer = new BuildWriteQueue(async (_id, fields: any) => {
    if(failNext){failNext=false;throw new Error("SQLite temporarily unavailable")}
    writes++
    db.query("UPDATE builds SET mods=?,modsCount=?,installedMods=? WHERE id=?").run(JSON.stringify(fields.mods),fields.modsCount,JSON.stringify(fields.installedMods),saved.id)
  })
  const refresh = callback("refreshBuildContent", "  contentRefreshRef.current", {
    queueContentRefresh: createContentRefreshQueue(), contentMutationsRef: {current: new Map()},
    buildsRef: {current: [current]}, contentScanSeqRef: {current: new Map()},
    syncBuildContent: async () => current, scanManifestsRef: {current: new Map()}, savedContentRef: savedRef,
    buildContentPatch, displayedContentRef: {current: new Set()}, updateCachedBuildContent: () => {},
    setBuilds: () => {}, buildWrites: writer,
  })
  try {
    await refresh(saved.id, true)
    expect(savedRef.current.get(saved.id)).toBe(saved)
    expect(db.query("SELECT modsCount FROM builds").get()).toEqual({modsCount:1})
    expect(writer.getPending(saved.id).mods).toEqual([])
    await refresh(saved.id, true)
    expect(db.query("SELECT modsCount,mods,installedMods FROM builds").get()).toEqual({modsCount:0, mods:"[]", installedMods:"{}"})
    await refresh(saved.id, true)
    expect(writes).toBe(1)
  } finally {db.close()}
})
