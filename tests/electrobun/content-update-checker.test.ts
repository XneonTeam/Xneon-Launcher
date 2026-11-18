import { expect, test } from "bun:test"

test("проверка учитывает канал, загрузчик, тип контента и изменения во время запроса", () => {
  const code = `
    import {mock} from 'bun:test'; import assert from 'node:assert/strict';
    let cache=null, latest=null, versions=[], content={mods:[],resourcepacks:[],shaders:[],installedMods:{}}, batchLoaders=[], releaseCheck;
    const base={id:'build',name:'Build',version:'1.21.1',modLoader:'neoforge',source:'local'};
    const db={loadBuildsLight:async()=>[base],loadBuildContent:async()=>content,getResources:async()=>[],getSetting:async()=>cache,setSetting:async(k,v)=>{cache=v}};
    mock.module('./electrobun/db',()=>({dbHelpers:db}));
    mock.module('./electrobun/main/builds/helpers',()=>({loadModsModule:async()=>({modrinthGetFilesByHash:async()=>({}),modrinthCheckUpdates:async(hashes,loaders)=>{batchLoaders=loaders;if(releaseCheck)await releaseCheck;return latest?Object.fromEntries(hashes.map(h=>[h,latest])):{}},modrinthGetVersions:async()=>versions})}));
    const {checkContentUpdates}=await import('./electrobun/main/builds/update-checker.ts');
    const hash='a'.repeat(40),next='b'.repeat(40);
    const item={id:hash,slug:'old.jar',name:'Mod',version:'1.0.8',source:'modrinth',projectId:'p',versionId:'old'};
    const newer={id:'new',name:'New',versionNumber:'1.0.11',gameVersion:'1.21.1',loaders:['neoforge'],versionType:'release',fileName:'new.jar',files:[{filename:'new.jar',url:'url',hashes:{sha1:next}}]};
    content.mods=[item];latest={...newer,versionType:'beta'};versions=[];
    assert.equal((await checkContentUpdates('build','release')).updates.length,0,'batch must respect release channel');
    latest=null;versions=[{...newer,loaders:['fabric']}];
    assert.equal((await checkContentUpdates('build')).updates.length,0,'must not offer a Fabric mod for NeoForge');
    content.mods=[];content.resourcepacks=[{...item,slug:'pack.zip'}];latest={...newer,loaders:['minecraft']};versions=[];
    await checkContentUpdates('build');assert.deepEqual(batchLoaders,['minecraft'],'packs must not be checked as NeoForge mods');
    content.resourcepacks=[];content.shaders=[{...item,slug:'shader.zip'}];
    await checkContentUpdates('build');assert.deepEqual(batchLoaders,['iris','optifine'],'shaders need shader loaders, not NeoForge');
    content.shaders=[];
    content.resourcepacks=[];content.mods=[item];latest=newer;
    let resolve;releaseCheck=new Promise(r=>resolve=r);const pending=checkContentUpdates('build');
    await new Promise(r=>setTimeout(r,10));content={...content,mods:[{...item,id:next,versionId:'new',slug:'new.jar',version:'1.0.11'}]};resolve();
    assert.equal((await pending).updates.length,0,'an in-flight check must not resurrect an already updated file');
    content={...content,mods:[item]};let resolveOld;releaseCheck=new Promise(r=>resolveOld=r);
    const oldCheck=checkContentUpdates('build','release');await new Promise(r=>setTimeout(r,10));
    releaseCheck=null;await checkContentUpdates('build','beta');resolveOld();await oldCheck;
    assert.equal(JSON.parse(cache).build.channel,'beta','an older check must not overwrite the newer channel cache');
  `
  const result = Bun.spawnSync([process.execPath, "--no-env-file", "-e", code], { stdout: "pipe", stderr: "pipe" })
  expect(result.exitCode, result.stderr.toString()).toBe(0)
})
