import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import vm from 'node:vm'
import { transformSync } from 'esbuild'

function fixture(){
 const source=fs.readFileSync(new URL('../../electrobun/main/remote-servers/index.ts',import.meta.url),'utf8')
 const body=source.match(/export async function listRemoteServers\([\s\S]*?\n\}/)?.[0]
 assert.ok(body)
 let resolveRequest,calls=0,user='user';const events=[]
 const c=vm.createContext({shareConfiguration:async()=>{if(!user)throw new Error('Signed out');return {userId:user}},shareRequest:()=>{calls++;return new Promise(r=>resolveRequest=r)},connections:new Map(),closeConnection(){},remoteInfo:access=>({id:'remote:'+access.id,...access.info,remote:{id:access.id}}),sendToRenderer:(...args)=>events.push(args),Date,Promise})
 vm.runInContext('let remoteList = [], listUser = "", remoteListAt = 0, remoteListTask; const REMOTE_LIST_TTL_MS = 30000;',c)
 vm.runInContext(transformSync(body.replace('export ',''),{loader:'ts'}).code,c)
 return {list:()=>c.listRemoteServers(),finish:value=>resolveRequest(value),events,calls:()=>calls,setUser:value=>user=value}
}
test('Серверы: локальный список не ожидает сеть совместного доступа',async()=>{
 const f=fixture();let settled=false;f.list().then(()=>settled=true)
 for(let i=0;i<6;i++)await Promise.resolve()
 assert.equal(settled,true,'Сеть не должна задерживать локальные серверы')
})
test('Серверы: фоновое обновление объединяет запросы и пушит найденные серверы',async()=>{
 const f=fixture();await f.list();await f.list();assert.equal(f.calls(),1)
 f.finish([{id:'one',isOwner:false,info:{name:'Remote'}}]);await Promise.resolve();await Promise.resolve()
 assert.ok(f.events.some(([channel])=>channel==='mc-server:remote-connection'))
 const list=await f.list();assert.equal(list[0].id,'remote:one');assert.equal(f.calls(),1)
})
test('Серверы: локальный UI использует модульный снимок, TTL и не скрывает список при обновлении',()=>{
 const source=fs.readFileSync(new URL('../../src/hooks/use-mc-servers.ts',import.meta.url),'utf8')
 assert.match(source,/useState<McServerInfo\[\]>\(\(\) => serversCache \?\? \[\]\)/)
 assert.match(source,/if \(serversCache === null\) setLoading\(true\)/)
 assert.match(source,/SERVERS_CACHE_TTL_MS/)
 assert.match(source,/next\.filter\(server => !server.remote\)/)
})
test('Серверы: поздний ответ другого аккаунта не попадает в список',async()=>{
 const f=fixture();await f.list();f.setUser(null);assert.equal((await f.list()).length,0)
 f.finish([{id:'private',isOwner:false,info:{name:'Old account'}}]);for(let i=0;i<6;i++)await Promise.resolve()
 assert.equal(f.events.length,0);f.setUser('other');assert.equal((await f.list()).length,0)
})
test('Серверы: создание/удаление сразу обновляет снимок, удалённый доступ не кэшируется',()=>{
 const source=fs.readFileSync(new URL('../../src/hooks/use-mc-servers.ts',import.meta.url),'utf8')
 const statement=source.match(/const setServers = useCallback\([\s\S]*?\n  \}, \[\]\)/)?.[0];assert.ok(statement)
 const ref={current:[]};let state
 const context=vm.createContext({serversRef:ref,setServersState:value=>state=value,useCallback:fn=>fn})
 vm.runInContext('let serversCache=null,hadRemoteServers=false;',context)
 vm.runInContext(transformSync(statement,{loader:'ts'}).code+';globalThis.update=setServers;globalThis.snapshot=()=>({serversCache,hadRemoteServers})',context)
 context.update([{id:'local'},{id:'remote',remote:{id:'access'}}]);assert.equal(state.length,2)
 assert.deepEqual([...context.snapshot().serversCache].map(s=>s.id),['local']);assert.equal(context.snapshot().hadRemoteServers,true)
 context.update(previous=>previous.filter(s=>s.id!=='local'));assert.equal(context.snapshot().serversCache.length,0)
})
