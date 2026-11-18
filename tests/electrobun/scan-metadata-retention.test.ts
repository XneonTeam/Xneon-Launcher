import { expect, test } from "bun:test"

test("скан с владельцем SQLite возвращает metadata, но не удерживает вторую копию; хеши остаются в кеше", () => {
  const code = `
    import { mock } from "bun:test"
    import assert from "node:assert/strict"
    import fs from "node:fs/promises"
    import path from "node:path"
    import { tmpdir } from "node:os"
    const root=await fs.mkdtemp(path.join(tmpdir(),"xnlc-inspector-ownership-"))
    try {
      const file=path.join(root,"fixture.jar")
      await fs.writeFile(file,"fixture")
      let reads=0,hashes=0
      mock.module("./packages/xnlc-parser/src/archive-inspection.ts",()=>({inspectArchive:async()=>{
        reads++;return{metadata:{name:"Fixture",icon_url:"data:image/png;base64,fixture"},diagnostics:[],loaderRequirements:null}
      }}))
      mock.module("./packages/xnlc-parser/src/utilities.ts",()=>({sha1File:async()=>{hashes++;return"sha1"},curseforgeFingerprintFile:async()=>1}))
      const {inspectJar}=await import("./packages/xnlc-parser/src/jar-inspector.ts")
      const first=await inspectJar(file,{metadata:true,sha1:true,cacheMetadata:false})
      const second=await inspectJar(file,{metadata:true,sha1:true,cacheMetadata:false})
      assert.deepEqual(first.metadata,second.metadata)
      assert.equal(first.metadata.name,"Fixture")
      assert.equal(reads,2,"caller-owned metadata must not stay in the parser cache")
      assert.equal(hashes,1,"metadata ownership must not invalidate SHA-1")
      await inspectJar(file,{metadata:true,sha1:true})
      await inspectJar(file,{metadata:true,sha1:true})
      assert.equal(reads,3,"default parser callers still share cached metadata")
      assert.equal(hashes,1)
    } finally {await fs.rm(root,{recursive:true,force:true})}
  `
  const result = Bun.spawnSync([process.execPath, "--no-env-file", "-e", code], { stdout: "pipe", stderr: "pipe" })
  expect(result.exitCode, result.stderr.toString()).toBe(0)
})
