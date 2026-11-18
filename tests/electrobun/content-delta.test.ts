import {expect,test} from "bun:test"
import {contentManifest,createContentDelta,applyContentDelta} from "../../lib/content-delta"

const row=(slug:string,name=slug)=>({id:slug,slug,name,description:"description",version:"1",enabled:true})
const fixture=(count=200)=>({mods:Array.from({length:count},(_,i)=>row(`${i}.jar`)),resourcepacks:[],shaders:[],installedMods:Object.fromEntries(Array.from({length:count},(_,i)=>[`${i}.jar`,`C:/${i}.jar`]))})
test("неизменённые 200 модов не пересылаются при refresh",async()=>{
  const current=fixture(),known=await contentManifest(current)
  const delta=await createContentDelta(structuredClone(current),known)
  expect(delta.mods.upsert).toEqual([]);expect(delta.mods.remove).toEqual([])
  expect(delta.installedMods.upsert).toEqual({});expect(delta.installedMods.remove).toEqual([])
  expect(applyContentDelta(current,delta)).toBe(current)
})
test("добавление, изменение, удаление и порядок передаются дельтой",async()=>{
  const current=fixture(100),known=await contentManifest(current)
  const next=fixture(100);next.mods.splice(3,1);next.mods[0]={...next.mods[0],name:"Updated"};next.mods.push(row("new.jar"));delete next.installedMods["3.jar"];next.installedMods["new.jar"]="C:/new.jar"
  const delta=await createContentDelta(next,known)
  expect(delta.mods.upsert).toHaveLength(2);expect(delta.mods.remove).toEqual(["3.jar"])
  const applied=applyContentDelta(current,delta)
  expect(applied).toEqual(next);expect(applied.mods[1]).toBe(current.mods[1])
})
test("холодный клиент получает полный снимок один раз и восстанавливается после удаления последнего",async()=>{
  const current=fixture(1)
  expect(applyContentDelta(fixture(0),await createContentDelta(current))).toEqual(current)
  expect(applyContentDelta(current,await createContentDelta(fixture(0),await contentManifest(current)))).toEqual(fixture(0))
})
test("порядок свойств JSON не создаёт ложные обновления; изменение иконки замечается",async()=>{
  const original=fixture(1)
  const next={...original,mods:[Object.fromEntries(Object.entries(original.mods[0]).reverse()) as typeof original.mods[0]]}
  expect((await createContentDelta(next,await contentManifest(original))).mods.upsert).toEqual([])
  next.mods[0]={...next.mods[0],icon_url:"https://example.org/new.png"} as typeof next.mods[0]
  expect((await createContentDelta(next,await contentManifest(original))).mods.upsert).toHaveLength(1)
})
test("имена папок __proto__/constructor не теряются и не меняют прототип manifest",async()=>{
  const content={...fixture(0),resourcepacks:[row("__proto__"),row("constructor")]}
  const delta=await createContentDelta(content)
  expect(delta.resourcepacks.upsert).toHaveLength(2)
  expect(Object.hasOwn(delta.manifest.resourcepacks,"__proto__")).toBe(true)
  expect(applyContentDelta(fixture(0),delta)).toEqual(content)
})
test("fallback автора в UI не инвалидирует scanner hash неизменённых строк при mutation",async()=>{
  const scanned={...fixture(1),resourcepacks:[{...row("pack.zip"),source:"modrinth"}]}
  const shown={...scanned,resourcepacks:[{...scanned.resourcepacks[0],author:"Known owner"}]}
  const next={...shown,mods:[...shown.mods,row("new.jar")]}
  const known=await contentManifest(next,{content:shown,manifest:await contentManifest(scanned)})
  const change=await createContentDelta({...scanned,mods:next.mods},known)
  expect(change.resourcepacks.upsert).toHaveLength(0)
  // Новое значение/объект обязано сравниваться заново, не прятать реальную правку.
  const edited={...shown,resourcepacks:[{...shown.resourcepacks[0],author:"Changed owner"}]}
  expect((await contentManifest(edited,{content:shown,manifest:await contentManifest(scanned)})).resourcepacks["pack.zip"])
    .not.toBe((await contentManifest(scanned)).resourcepacks["pack.zip"])
  const enriched={...scanned,resourcepacks:[{...scanned.resourcepacks[0],author:"New scanner owner"}]}
  expect((await createContentDelta(enriched,known)).resourcepacks.upsert).toHaveLength(1)
  const collected=await contentManifest(next,{content:{},manifest:await contentManifest(scanned)})
  expect(collected).toEqual(await contentManifest(next))
})
