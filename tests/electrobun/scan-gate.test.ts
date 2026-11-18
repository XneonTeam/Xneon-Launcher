import {expect,test} from "bun:test"
import {ScanGate} from "../../packages/xnlc-parser/src/scan-gate"
test("глобальная граница потоков соблюдается между несколькими сканами, отмена не теряет слот",async()=>{
  const gate=new ScanGate(2),release=Promise.withResolvers<void>()
  let active=0,peak=0,completed=0
  const tasks=Array.from({length:20},()=>gate.run(async()=>{active++;peak=Math.max(peak,active);await release.promise;active--;completed++}))
  const abort=new AbortController()
  const cancelled=gate.run(async()=>{throw new Error("must not run")},abort.signal).catch(error=>error)
  abort.abort(new Error("cancelled"));release.resolve()
  await Promise.all(tasks)
  expect(peak).toBe(2);expect(completed).toBe(20);expect((await cancelled).message).toBe("cancelled")
  expect(await gate.run(async()=>42)).toBe(42)
})
test("готовый результат освобождается сразу, не ждёт удерживающую его медленную пачку",()=>{
  const code=`
    import {mock} from 'bun:test';import assert from 'node:assert/strict';
    const slow=Promise.withResolvers();const started=Promise.withResolvers();const received=[];
    mock.module('./packages/xnlc-parser/src/jar-inspector.ts',()=>({inspectJar:async file=>{if(file==='slow.jar'){started.resolve();await slow.promise}return{sha1:file,metadata:{name:file,icon_url:'data:large'}}}}));
    const {runScanWorker}=await import('./packages/xnlc-parser/src/scan-worker-client.ts');
    const task=runScanWorker([{filePath:'fast.jar'},{filePath:'slow.jar'}],{metadata:true},result=>received.push(result.filePath));
    try{await started.promise;await Bun.sleep(20);assert.deepEqual(received,['fast.jar'],'completed result must not wait for slow peer')}finally{slow.resolve();await task}
    assert.deepEqual(received,['fast.jar','slow.jar']);
  `
  const result=Bun.spawnSync([process.execPath,"--no-env-file","-e",code],{stdout:"pipe",stderr:"pipe"})
  expect(result.exitCode,result.stderr.toString()).toBe(0)
})
