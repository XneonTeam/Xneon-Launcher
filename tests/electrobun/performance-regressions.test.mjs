import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import vm from 'node:vm'
import { transformSync } from 'esbuild'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { createPageLoader } from '../../lib/page-loader.ts'
import { preloadedPage } from '../../components/launcher/preloaded-page.tsx'

const read=file=>fs.readFileSync(new URL('../../'+file,import.meta.url),'utf8')
test('Запуск: готовый интерфейс не ждёт обязательных 2,8 секунды заставки',()=>{
 assert.doesNotMatch(read('src/startup-splash.ts'),/2800\s*-\s*elapsed/)
})
test('Бандл: тяжёлые независимые библиотеки не объединяются в общий startup vendor',()=>{
 assert.doesNotMatch(read('vite.config.mts'),/return 'vendor'/)
 assert.doesNotMatch(read('vite.config.mts'),/return 'markdown'/)
})
test('3D-превью: движок загружается по требованию, общий сниматель не имеет постоянного render loop',()=>{
 assert.doesNotMatch(read('lib/skin-preview-cache.ts'),/^import \{ SkinViewer \} from/m)
 assert.match(read('lib/skin-preview-cache.ts'),/renderPaused: true/)
})
function cache(){const module={exports:{}};vm.runInNewContext(transformSync(read('lib/swr.ts'),{loader:'ts',format:'cjs'}).code,{module,exports:module.exports,Date,Promise,localStorage:{getItem(){return null},setItem(){},removeItem(){}}});return module.exports.dataCache}
test('SWR: одновременные холодные потребители ждут один запрос, не получают undefined',async()=>{
 const c=cache();let calls=0,finish;const pending=new Promise(r=>finish=r)
 const fetch=()=>{calls++;return pending};const a=c.getOrFetch('same',fetch),b=c.getOrFetch('same',fetch)
 finish('ready');assert.deepEqual(await Promise.all([a,b]),['ready','ready']);assert.equal(calls,1)
})
test('SWR: invalidation не позволяет старому запросу перезаписать свежие данные',async()=>{
 const c=cache();let finish;const old=c.getOrFetch('same',()=>new Promise(r=>finish=r));c.invalidate('same')
 assert.equal(await c.getOrFetch('same',()=>Promise.resolve('new')),'new');finish('old');await old
 assert.equal(await c.getOrFetch('same',()=>Promise.resolve('unexpected')),'new')
})
test('SWR: null и синхронная ошибка не отравляют последующую попытку',async()=>{
 const c=cache();assert.equal(await c.getOrFetch('empty',()=>null),null)
 assert.equal(await c.getOrFetch('empty',()=>Promise.resolve('ready')),'ready')
 await assert.rejects(c.getOrFetch('failed',()=>{throw new Error('offline')}),/offline/)
 assert.equal(await c.getOrFetch('failed',()=>Promise.resolve('online')),'online')
})

test('Навигация: prefetch и открытие используют один import, ошибка допускает повтор',async()=>{
 const code=transformSync(read('lib/page-loader.ts'),{loader:'ts',format:'cjs'}).code,module={exports:{}}
 vm.runInNewContext(code,{module,exports:module.exports});let calls=0
 const load=module.exports.createPageLoader(async()=>{calls++;return {default:'page'}})
 assert.equal(load.peek(),undefined)
 const [a,b]=await Promise.all([load(),load()]);assert.equal(calls,1);assert.equal(a,b);assert.equal(load.peek(),a)
 let failed=true;const retry=module.exports.createPageLoader(async()=>{if(failed)throw new Error('retry');return 'ok'})
 await assert.rejects(retry(),/retry/);failed=false;assert.equal(await retry(),'ok')
})

test('Настройки: пакетный IPC не выдаёт приватные AI настройки и ограничивает размер запроса',async()=>{
 const source=read('electrobun/main/system.ts')
 const statement=source.match(/rpcRegistry\.handle\("settings:get-many",[\s\S]*?\n  \}\)/)?.[0]
 assert.ok(statement)
 let handler;const calls=[]
 vm.runInNewContext(transformSync(statement,{loader:'ts'}).code,{
  rpcRegistry:{handle:(_name,fn)=>handler=fn},privateAiSettings:new Set(['aiApiKey','aiEndpoint','aiModel','aiProtocol','aiModels']),
  dbHelpers:{getSetting:async key=>{calls.push(key);return key==='memoryMax'?'4G':undefined}},
 })
 const values=await handler(null,['memoryMax','memoryMax','missing','aiApiKey','aiModels'])
 assert.equal(values.memoryMax,'4G');assert.equal(values.aiApiKey,undefined);assert.equal(Object.hasOwn(values,'aiModels'),false)
 assert.deepEqual(calls,['memoryMax','missing'])
 await assert.rejects(handler(null,Array(129).fill('memoryMax')),/Invalid/)
 await assert.rejects(handler(null,'memoryMax'),/Invalid/)
})

test('Prefetch: загруженная страница рендерится напрямую, без нового Suspense и потери props',async()=>{
 const Component=({name})=>React.createElement('p',null,name)
 const load=createPageLoader(async()=>({default:Component}));const Page=preloadedPage(load)
 assert.notEqual(Page({name:'before'}).type,Component)
 await load();assert.equal(Page({name:'after'}).type,Component)
 assert.equal(renderToStaticMarkup(React.createElement(Page,{name:'after'})),'<p>after</p>')
})

test('RAM: удерживаются только builds/settings, а idle-прогрев не монтирует страницы',()=>{
 assert.match(read('components/launcher/launcher.tsx'),/\["builds", "settings"\]\.includes\(activeTab\)/)
 assert.match(read('components/launcher/launcher.tsx'),/<Activity[^>]*mode=/)
 assert.match(read('components/launcher/page-loaders.ts'),/requestIdleCallback/)
 assert.doesNotMatch(read('components/launcher/page-loaders.ts'),/setTimeout|setInterval/)
})

test('Статичные обои не запускают фоновый опрос JVM, а список сборок не сопоставляется квадратично',()=>{
 assert.match(read('components/launcher/settings/theme-runtime.tsx'),/if \(!enabled\) return/)
 assert.match(read('components/launcher/theme-background-layer.tsx'),/useMediaPaused\(kind === "video"/)
 assert.match(read('components/launcher/instance/use-builds.ts'),/previousById\.get\(build.id\)/)
 assert.doesNotMatch(read('components/launcher/instance/use-builds.ts'),/buildsRef\.current\.find\(existing => existing.id === build.id/)
})
