import {expect,test} from "bun:test"
test("новый путь известного SHA-1 не распаковывает JAR и не декодирует PNG повторно",()=>{
  const code=`
    import {mock} from 'bun:test';import assert from 'node:assert/strict';import fs from 'node:fs/promises';import path from 'node:path';import{tmpdir}from'node:os';
    const root=await fs.mkdtemp(path.join(tmpdir(),'xnl-known-scan-'));const file=path.join(root,'known.jar');await fs.writeFile(file,'fixture');const requests=[];
    mock.module('@xnlc/parser',()=>({probeImage:()=>{throw new Error('no image decode expected')},rememberLoaderRequirements(){},runScanWorker:async(files,request,onResult)=>{
      if(files.length)requests.push(request);for(const item of files)onResult({...item,inspection:{sha1:'known',...(request.metadata?{metadata:{name:'unnecessary JAR parse'}}:{})}})
    }}));
    mock.module('./electrobun/db/index.ts',()=>({dbHelpers:{getFileSnapshots:async()=>[],upsertFileSnapshots:async()=>{},getResources:async()=>[{sha1:'known',name:'Known',version:'1',description:'kept',icon:'https://example.org/icon.png',author:'Author',source:'modrinth',projectId:'project',versionId:'version',cfChecked:1}],upsertResources:async()=>{}}}));
    mock.module('./electrobun/main/builds/helpers.ts',()=>({loadModsModule:async()=>{throw new Error('unexpected network')}}));
    try{const{resolveContentEntries}=await import('./electrobun/main/builds/content-resolver.ts');const result=await resolveContentEntries([file]);assert.equal(result[file].name,'Known');assert.equal(requests.length,1);assert.equal(requests[0].sha1,true);assert.notEqual(requests[0].metadata,true,'metadata already persisted by hash must not be reparsed')}finally{await fs.rm(root,{recursive:true,force:true})}
  `
  const result=Bun.spawnSync([process.execPath,"--no-env-file","-e",code],{stdout:"pipe",stderr:"pipe"})
  expect(result.exitCode,result.stderr.toString()).toBe(0)
})
