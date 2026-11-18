import { expect, test } from "bun:test"
import fs from "node:fs/promises"
import path from "node:path"
import { tmpdir } from "node:os"
import { streamDownloadToFile } from "../../electrobun/main/stream-download"

test("установка пишет сетевые чанки во временный файл до завершения скачивания", () => {
  const code = `
    import {mock} from "bun:test"
    import assert from "node:assert/strict"
    import fs from "node:fs/promises"
    import path from "node:path"
    import {tmpdir} from "node:os"
    const root=await fs.mkdtemp(path.join(tmpdir(),"xnlc-stream-install-"))
    const gate=Promise.withResolvers(),begun=Promise.withResolvers()
    let reads=0
    const body=new ReadableStream({async pull(controller){if(reads++===0){controller.enqueue(new Uint8Array(65536).fill(42));begun.resolve()}else{await gate.promise;controller.enqueue(new Uint8Array(65536).fill(43));controller.close()}}})
    mock.module("@xnlc/core/retry",()=>({fetchWithRetry:async()=>new Response(body,{headers:{"content-length":"131072"}})}))
    mock.module("./electrobun/db/index.ts",()=>({dbHelpers:{findBuildByName:async()=>({id:"test"}),findBuildById:async()=>({intentPath:root})}}))
    mock.module("./electrobun/main/jar-cache.ts",()=>({getCachedJarPath:async()=>null}))
    mock.module("./electrobun/main/runtime.ts",()=>({sendToRenderer:()=>{}}))
    mock.module("./electrobun/main/paths.ts",()=>({getLauncherDataRoot:()=>root}))
    mock.module("./electrobun/main/shared-game-cache.ts",()=>({prepareInstanceStorageSync:async()=>{}}))
    const {saveRemoteContentToIntent}=await import("./electrobun/main/builds/helpers.ts")
    const task=saveRemoteContentToIntent("test","mod","https://example.invalid/mod.jar","mod.jar")
    try{
      await begun.promise
      let streamed=false
      for(let i=0;i<100;i++){
        for(const name of await fs.readdir(root))if(name.startsWith(".xneon-content-")){
          const info=await fs.stat(path.join(root,name)).catch(()=>null)
          if(info?.size>=65536)streamed=true
        }
        if(streamed)break
        await new Promise(resolve=>setTimeout(resolve,5))
      }
      gate.resolve()
      const file=await task
      assert.equal(streamed,true,"download must reach disk before final response chunk, not Buffer.concat the entire file")
      assert.equal(file,path.join(root,"mods","mod.jar"))
      const bytes=await fs.readFile(file)
      assert.equal(bytes.length,131072);assert.equal(bytes[0],42);assert.equal(bytes.at(-1),43)
    }finally{gate.resolve();await task;await fs.rm(root,{recursive:true,force:true})}
  `
  const result = Bun.spawnSync([process.execPath,"--no-env-file","-e",code],{stdout:"pipe",stderr:"pipe"})
  expect(result.exitCode,result.stderr.toString()).toBe(0)
},30000)

test("потоковый download: реальные HTTP-байты, bounded progress и финальное событие", async () => {
  const root=await fs.mkdtemp(path.join(tmpdir(),"xnlc-stream-http-"))
  const bytes=new Uint8Array(2*1024*1024).fill(77)
  const server=Bun.serve({hostname:"127.0.0.1",port:0,fetch:()=>new Response(bytes)})
  try {
    const events: {current:number;total:number;done?:boolean}[]=[]
    const file=path.join(root,"download.tmp")
    await streamDownloadToFile(server.url.href,file,undefined,event=>events.push(event))
    expect(await fs.readFile(file)).toEqual(Buffer.from(bytes))
    expect(events.at(-1)?.done).toBe(true)
    expect(events.at(-1)?.current).toBe(bytes.length)
    expect(events.length).toBeLessThan(50)
  } finally {server.stop(true);await fs.rm(root,{recursive:true,force:true})}
})

test("потоковый download: отмена закрывает медленный reader и файл", async () => {
  const root=await fs.mkdtemp(path.join(tmpdir(),"xnlc-stream-abort-"))
  const server=Bun.serve({hostname:"127.0.0.1",port:0,fetch:()=>new Response(new ReadableStream({start(controller){controller.enqueue(new Uint8Array(65536))}}))})
  const controller=new AbortController()
  const file=path.join(root,"download.tmp")
  try {
    const pending=streamDownloadToFile(server.url.href,file,controller.signal)
    // Сразу подписываемся на rejection, пока ждём первую запись.
    const outcome=pending.then(()=>null,error=>error)
    for(let i=0;i<100;i++){
      if((await fs.stat(file).catch(()=>null))?.size)break
      await Bun.sleep(5)
    }
    controller.abort(new Error("cancelled fixture"))
    const result=await outcome
    expect(result).toBeInstanceOf(Error)
    await fs.rm(file)
    expect(await Bun.file(file).exists()).toBe(false)
  } finally {controller.abort();server.stop(true);await fs.rm(root,{recursive:true,force:true})}
},10000)

test("потоковый download: HTTP error не создаёт файл и существующий файл не затирается", async () => {
  const root=await fs.mkdtemp(path.join(tmpdir(),"xnlc-stream-errors-"))
  const server=Bun.serve({hostname:"127.0.0.1",port:0,fetch:request=>new URL(request.url).pathname==="/error"?new Response("error",{status:400}):new Response("new")})
  try {
    const file=path.join(root,"existing.tmp")
    await expect(streamDownloadToFile(server.url.href+"error",file)).rejects.toThrow("HTTP 400")
    expect(await Bun.file(file).exists()).toBe(false)
    await fs.writeFile(file,"keep")
    await expect(streamDownloadToFile(server.url.href,file)).rejects.toThrow()
    expect(await fs.readFile(file,"utf8")).toBe("keep")
  } finally {server.stop(true);await fs.rm(root,{recursive:true,force:true})}
})

test("JAR-кеш публикует файл только после полной загрузки и удаляет partial при отмене", () => {
  const code=`
    import {mock} from "bun:test"
    import assert from "node:assert/strict"
    import fs from "node:fs/promises"
    import path from "node:path"
    import {tmpdir} from "node:os"
    const root=await fs.mkdtemp(path.join(tmpdir(),"xnlc-jar-stream-cache-"))
    mock.module("os",()=>({default:{tmpdir:()=>root}}))
    const {cacheJarFromUrl,getCachedJarPath}=await import("./electrobun/main/jar-cache.ts")
    try{
      const url="https://example.invalid/fixture.jar"
      let calls=0
      const file=await cacheJarFromUrl(url,async(url,temporary)=>{
        calls++;await fs.writeFile(temporary,"jar")
        assert.equal(await getCachedJarPath(url),null)
      })
      assert.equal(await fs.readFile(file,"utf8"),"jar")
      assert.equal(await cacheJarFromUrl(url,async()=>{calls++;throw new Error("unexpected")}),file)
      assert.equal(calls,1)
      await assert.rejects(cacheJarFromUrl(url+"/abort",async(url,temporary)=>{
        await fs.writeFile(temporary,"partial");throw new DOMException("cancelled","AbortError")
      }),/cancelled/)
      assert.equal(await getCachedJarPath(url+"/abort"),null)
      assert.equal((await fs.readdir(path.join(root,"xneon-jar-cache"))).filter(name=>name.endsWith(".tmp")).length,0)
      const legacy=await cacheJarFromUrl(url+"/legacy",async()=>Buffer.from("legacy"))
      assert.equal(await fs.readFile(legacy,"utf8"),"legacy")
    }finally{await fs.rm(root,{recursive:true,force:true})}
  `
  const result=Bun.spawnSync([process.execPath,"--no-env-file","-e",code],{stdout:"pipe",stderr:"pipe"})
  expect(result.exitCode,result.stderr.toString()).toBe(0)
})
