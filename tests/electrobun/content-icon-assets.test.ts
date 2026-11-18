import {expect,test} from "bun:test"
import {PNG} from "pngjs"
import fs from "node:fs/promises"
import path from "node:path"
import {tmpdir} from "node:os"

test("иконки передаются URL, работают через asset server, а в БД возвращается переносимая data-URL",async()=>{
  const code=`
    import {mock} from 'bun:test';import assert from 'node:assert/strict';import fs from 'node:fs/promises';import path from 'node:path';import {tmpdir} from 'node:os';import {PNG} from 'pngjs';
    const root=await fs.mkdtemp(path.join(tmpdir(),'xnl-icon-assets-'));
    mock.module('./electrobun/main/profile-path.ts',()=>({getDefaultLauncherDataRoot:()=>root}));
    const {publicContentIcons,storedContentIcons}=await import('./electrobun/main/builds/content-icon-assets.ts');
    const image=new PNG({width:256,height:256});image.data.fill(255);const icon='data:image/png;base64,'+PNG.sync.write(image).toString('base64');
    const current={mods:[{slug:'a',icon_url:icon}],resourcepacks:[],shaders:[],installedMods:{a:'C:/a'}};
    try{
      const [first,second]=await Promise.all([publicContentIcons(current),publicContentIcons(current)]);
      assert.equal(first.mods[0].icon_url,second.mods[0].icon_url);assert.ok(first.mods[0].icon_url.startsWith('http://127.0.0.1:'));
      assert.ok(JSON.stringify(first).length<1000);assert.equal(current.mods[0].icon_url,icon);
      const response=await fetch(first.mods[0].icon_url);assert.equal(response.status,200);assert.equal(response.headers.get('content-type'),'image/png');
      assert.equal(PNG.sync.read(Buffer.from(await response.arrayBuffer())).width,128);
      const stored=await storedContentIcons(first);assert.ok(stored.mods[0].icon_url.startsWith('data:image/png;base64,'));
      assert.equal((await fetch(first.mods[0].icon_url.replace(/\\/[a-f0-9]{48}\\//,'/wrong/'))).status,404);
      const remote={mods:[{slug:'remote',icon_url:'https://example.org/icon.png'}]};assert.equal(await storedContentIcons(remote),remote);
    }finally{await fs.rm(root,{recursive:true,force:true})}
    process.exit(0)
  `
  const result=Bun.spawnSync([process.execPath,"--no-env-file","-e",code],{stdout:"pipe",stderr:"pipe"})
  expect(result.exitCode,result.stderr.toString()).toBe(0)
},30000)
