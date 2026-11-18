import { expect, test } from "bun:test"

function scenario(body: string) {
  const code = `
    import { mock } from "bun:test"
    import assert from "node:assert/strict"
    import fs from "node:fs/promises"
    import path from "node:path"
    import { tmpdir } from "node:os"
    const root=await fs.mkdtemp(path.join(tmpdir(),"xnlc-incremental-scan-"))
    const mods=path.join(root,"mods");await fs.mkdir(mods)
    const calls=[];let generation=0,failMetadata=false,onResolve=()=>{}
    mock.module("./electrobun/main/builds/helpers.ts",()=>({formatDisplayNameFromFileName:name=>name}))
    mock.module("./electrobun/main/builds/content-resolver.ts",()=>({resolveContentEntries:async files=>{
      calls.push([...files]);onResolve(files);return Object.fromEntries(files.map(file=>[file,{sha1:path.basename(file),name:"Mod "+generation,version:"1",description:"",source:"local",...(failMetadata?{diagnostics:[{code:"SCAN_ERROR",message:"retry"}]}:{})}]))
    }}))
    const {scanIntentDir}=await import("./electrobun/main/builds/scanner.ts")
    const {contentMetadataEvents}=await import("./electrobun/main/builds/content-metadata-events.ts")
    try { ${body} } finally {await fs.rm(root,{recursive:true,force:true})}
  `
  const result = Bun.spawnSync([process.execPath, "--no-env-file", "-e", code], { stdout: "pipe", stderr: "pipe" })
  expect(result.exitCode, result.stderr.toString()).toBe(0)
}

test("150 модов: установка одного разбирает только новый файл, удаление не перечитывает остальные", () => scenario(`
  for(let i=0;i<150;i++)await fs.writeFile(path.join(mods,i+".jar"),"fixture")
  assert.equal((await scanIntentDir(root)).mods.length,150)
  assert.equal(calls[0].length,150);calls.length=0
  const added=path.join(mods,"new.jar");await fs.writeFile(added,"new")
  assert.equal((await scanIntentDir(root)).mods.length,151)
  assert.deepEqual(calls,[[added]]);calls.length=0
  await fs.rm(added)
  assert.equal((await scanIntentDir(root)).mods.length,150)
  assert.deepEqual(calls,[])
`),30000)

test("скан без изменений не повторяет resolver; замена одного JAR и metadata event инвалидируют точечно", () => scenario(`
  const a=path.join(mods,"a.jar"),b=path.join(mods,"b.jar")
  await fs.writeFile(a,"a");await fs.writeFile(b,"b")
  await scanIntentDir(root);calls.length=0
  await scanIntentDir(root);assert.deepEqual(calls,[])
  await fs.writeFile(a,"changed")
  await scanIntentDir(root);assert.deepEqual(calls,[[a]]);calls.length=0
  generation++
  contentMetadataEvents.emit("updated",[b])
  const next=await scanIntentDir(root)
  assert.deepEqual(calls,[[b]])
  assert.equal(next.mods.find(item=>item.slug==="b.jar").name,"Mod 1")
`))

test("ошибка resolver не отравляет кеш и файл можно проверить повторно", () => scenario(`
  const file=path.join(mods,"a.jar");await fs.writeFile(file,"a")
  failMetadata=true;await scanIntentDir(root);calls.length=0
  failMetadata=false;await scanIntentDir(root)
  assert.deepEqual(calls,[[file]]);calls.length=0
  await scanIntentDir(root);assert.deepEqual(calls,[])
`))

test("событие обогащения во время прохода не теряется за поздним кешированием", () => scenario(`
  const file=path.join(mods,"a.jar");await fs.writeFile(file,"a")
  onResolve=files=>{contentMetadataEvents.emit("updated",files);onResolve=()=>{}}
  await scanIntentDir(root);calls.length=0
  generation++
  const result=await scanIntentDir(root)
  assert.deepEqual(calls,[[file]])
  assert.equal(result.mods[0].name,"Mod 1")
`))

test("rename/disable и удаление последнего мода отражаются без старых записей", () => scenario(`
  const file=path.join(mods,"a.jar"),disabled=file+".disabled"
  await fs.writeFile(file,"a");await scanIntentDir(root);calls.length=0
  await fs.rename(file,disabled)
  const result=await scanIntentDir(root)
  assert.equal(result.mods.length,1);assert.equal(result.mods[0].enabled,false)
  assert.equal(result.installedMods["a.jar"],disabled)
  assert.deepEqual(calls,[[disabled]]);calls.length=0
  await fs.rm(disabled)
  const empty=await scanIntentDir(root)
  assert.deepEqual(empty.mods,[]);assert.deepEqual(empty.installedMods,{})
  assert.deepEqual(calls,[])
`))
