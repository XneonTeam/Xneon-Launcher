import { expect, test } from "bun:test"
import { PNG } from "pngjs"
import { normalizeContentIcon, getContentIconCacheStats } from "../../electrobun/main/builds/content-icon"

function scenario(cold: boolean) {
  const source = `
    import { mock } from "bun:test"
    import assert from "node:assert/strict"
    import { mkdtemp, writeFile, stat, rm } from "node:fs/promises"
    import { tmpdir } from "node:os"
    import path from "node:path"
    import { PNG } from "pngjs"
    import { packArchiveSync } from "./packages/xnlc-archives/src/index.ts"
    const root = await mkdtemp(path.join(tmpdir(), "xnlc-content-icon-"))
    try {
      const png = new PNG({width:1800,height:900})
      for(let i=0;i<png.data.length;i+=4){png.data[i]=50;png.data[i+1]=100;png.data[i+2]=150;png.data[i+3]=128}
      const original = "data:image/png;base64,"+PNG.sync.write(png).toString("base64")
      const file = path.join(root,"mod.jar")
      await writeFile(file, packArchiveSync({"fabric.mod.json":Buffer.from(JSON.stringify({schemaVersion:1,id:"fixture",name:"Fixture",version:"1",icon:"icon.png"})),"icon.png":Buffer.from(original.split(",")[1],"base64")}))
      const info=await stat(file)
      let snapshots = ${cold ? "[]" : '[{path:file,size:info.size,mtime:Math.round(info.mtimeMs),sha1:"known"}]'}
      let resources = ${cold ? "[]" : '[{sha1:"known",name:"Fixture",version:"1",description:"keep",icon:original,author:"author",source:"modrinth",projectId:"project",versionId:"version",modId:null,fileId:null,cfChecked:1}]'}
      let normalizedWrites=0
      mock.module("./electrobun/db/index.ts",()=>({dbHelpers:{
        getFileSnapshots:async()=>snapshots,upsertFileSnapshots:async rows=>{snapshots=rows},getResources:async()=>resources.map(row=>({...row})),
        upsertResources:async rows=>{for(const row of rows)resources=[...resources.filter(item=>item.sha1!==row.sha1),row]},
        updateResourceIcons:async rows=>{for(const row of rows){const existing=resources.find(item=>item.sha1===row.sha1&&item.icon===row.previous);if(existing){existing.icon=row.icon;normalizedWrites++}}},
        markResourcesCurseforgeChecked:async()=>{},setResourcesCurseforge:async()=>{},
      }}))
      mock.module("./electrobun/main/builds/helpers.ts",()=>({loadModsModule:async()=>{throw new Error("offline fixture")}}))
      const parser=await import("@xnlc/parser")
      const scan=parser.runScanWorker
      mock.module("@xnlc/parser",()=>({...parser,runScanWorker:async(files,request,onResult,signal)=>{
        if(request.metadata)assert.equal(request.cacheMetadata,false,"SQLite owns metadata; parser must not retain originals")
        return scan(files,request,onResult,signal)
      }}))
      const {resolveContentEntries}=await import("./electrobun/main/builds/content-resolver.ts")
      const first=(await resolveContentEntries([file]))[file]
      const thumbnail=PNG.sync.read(Buffer.from(first.icon_url.split(",")[1],"base64"))
      assert.equal(thumbnail.width,128);assert.equal(thumbnail.height,64)
      assert.deepEqual([...thumbnail.data.subarray(0,4)],[50,100,150,128])
      assert.equal(first.name,"Fixture");assert.ok(first.sha1)
      const saved=PNG.sync.read(Buffer.from(resources[0].icon.split(",")[1],"base64"))
      assert.equal(saved.width,128)
      const second=(await resolveContentEntries([file]))[file]
      assert.equal(second.icon_url,first.icon_url)
      ${cold ? "" : 'assert.equal(normalizedWrites,1);assert.equal(resources[0].description,"keep");assert.equal(resources[0].projectId,"project")'}
    } finally { await rm(root,{recursive:true,force:true}) }
  `
  const result = Bun.spawnSync([process.execPath, "--no-env-file", "-e", source], { stdout: "pipe", stderr: "pipe" })
  expect(result.exitCode, result.stderr.toString()).toBe(0)
}

test("контент: тёплый скан уменьшает старую большую PNG до IPC и обновляет только иконку кеша", () => scenario(false), 30000)
test("контент: холодный скан сохраняет thumbnail, а не оригинальную PNG из JAR", () => scenario(true), 30000)

test("миниатюры: небольшие PNG, удалённые URL и неподдерживаемые форматы не меняются", () => {
  const small = "data:image/png;base64," + PNG.sync.write(new PNG({ width: 32, height: 16 })).toString("base64")
  for (const icon of ["", small, "https://example.invalid/icon.png", "data:image/gif;base64,AAAA", "data:image/png;base64,broken"]) {
    expect(normalizeContentIcon(icon)).toBe(icon)
  }
})

test("миниатюры: LRU ограничен и повторная нормализация не увеличивает кеш", () => {
  let last = ""
  for (let i = 0; i < 270; i++) {
    const png = new PNG({ width: 129, height: 129 })
    for (let p = 0; p < png.data.length; p += 4) { png.data[p] = i & 255; png.data[p + 1] = i >> 8; png.data[p + 3] = 255 }
    last = "data:image/png;base64," + PNG.sync.write(png).toString("base64")
    const first = normalizeContentIcon(last)
    expect(normalizeContentIcon(last)).toBe(first)
  }
  const before = getContentIconCacheStats()
  for (let i = 0; i < 30; i++) normalizeContentIcon(last)
  expect(getContentIconCacheStats()).toEqual(before)
  expect(before.entries).toBeLessThanOrEqual(256)
  expect(before.estimatedBytes).toBeLessThanOrEqual(4 * 1024 * 1024)
})

test("SQLite: замена иконки не меняет метаданные и не затирает более свежую иконку", () => {
  const source = `
    import { mock } from "bun:test"
    import assert from "node:assert/strict"
    import { Database } from "bun:sqlite"
    const db=new Database(":memory:")
    db.run("CREATE TABLE resources(sha1 TEXT PRIMARY KEY,icon TEXT,name TEXT,parserVersion TEXT,updatedAt INTEGER)")
    db.run("INSERT INTO resources VALUES ('hash','large','Keep','parser',42)")
    mock.module("./electrobun/db/core.ts",()=>({isDbAvailable:()=>true,run:(sql,args)=>db.run(sql,args),transactionImmediate:fn=>db.transaction(fn)(),queryAll:(sql,args)=>db.query(sql).all(args)}))
    const {updateResourceIcons}=await import("./electrobun/db/resources.ts")
    await updateResourceIcons([{sha1:"hash",previous:"large",icon:"thumbnail"}])
    assert.deepEqual(db.query("SELECT * FROM resources").get(),{sha1:"hash",icon:"thumbnail",name:"Keep",parserVersion:"parser",updatedAt:42})
    await updateResourceIcons([{sha1:"hash",previous:"large",icon:"stale"}])
    assert.equal(db.query("SELECT icon FROM resources").get().icon,"thumbnail")
    db.close()
  `
  const result = Bun.spawnSync([process.execPath, "--no-env-file", "-e", source], { stdout: "pipe", stderr: "pipe" })
  expect(result.exitCode, result.stderr.toString()).toBe(0)
})
