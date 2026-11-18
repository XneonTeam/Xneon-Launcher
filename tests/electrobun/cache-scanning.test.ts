// Проверки подсистемы: describe изолируют fixtures и хуки; runtime не подменяется общим состоянием.
import { describe, expect, test, afterAll } from "bun:test"
import { BoundedCache, estimateCacheBytes } from "../../lib/bounded-cache.ts"
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { setScanWorkerEntry, runScanWorker } from "../../packages/xnlc-parser/src/index.ts"
import { packArchiveSync } from "../../packages/xnlc-archives/src/index.ts"
import { bundledWorker } from "../../electrobun/platform/resources.ts"
import { test as nodeTest } from "node:test"
import assert from "node:assert/strict"
import fs from "node:fs"
import vm from "node:vm"
import { transformSync } from "esbuild"
import React from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { createPageLoader } from "../../lib/page-loader.ts"
import { preloadedPage } from "../../components/launcher/preloaded-page.tsx"

{
  describe("bounded-cache", () => {
    test("некорректный бюджет не создаёт бесконечную eviction-петлю", () => {
      for (const capacity of [0, -1, NaN, Infinity, 1.5]) expect(() => new BoundedCache({ capacity })).toThrow("capacity")
      expect(() => new BoundedCache({ capacity: 1, maxWeight: -1 })).toThrow("budget")
      expect(() => new BoundedCache({ capacity: 1 }).set("key", "value", NaN)).toThrow("TTL")
    })

    test("LRU ограничен числом и весом; повторный set и delete не искажают бюджет", () => {
      const cache = new BoundedCache<string, string>({ capacity: 3, maxWeight: 6, weight: value => value.length })
      cache.set("a", "aa").set("b", "bb").set("c", "cc")
      cache.get("a")
      cache.set("d", "dd")
      expect(cache.has("b")).toBe(false)
      expect(cache.weight).toBe(6)
      cache.set("a", "aaaa")
      expect(cache.size).toBe(2)
      cache.delete("a")
      expect(cache.weight).toBe(2)
      cache.set("huge", "x".repeat(100))
      expect(cache.has("huge")).toBe(false)
    })

    test("отрицательные результаты истекают и могут быть запрошены повторно", () => {
      let now = 0
      const cache = new BoundedCache<string, undefined>({ capacity: 10, ttlMs: 30, now: () => now })
      cache.set("negative", undefined)
      expect(cache.has("negative")).toBe(true)
      now = 31
      expect(cache.has("negative")).toBe(false)
      cache.set("negative", undefined)
      expect(cache.has("negative")).toBe(true)
    })

    test("оценка учитывает большие иконки без создания сериализованного снимка", () => {
      expect(estimateCacheBytes({ icon: "x".repeat(10000) })).toBeGreaterThan(20000)
      const cycle: { self?: object } = {}
      cycle.self = cycle
      expect(estimateCacheBytes(cycle)).toBeLessThan(100)
    })
  })
}

{
  function scenario(body: string) {
    const code = `
    import assert from "node:assert/strict"
    const { enrichBuildModNames, clearModrinthEnrichCache } = await import("./lib/modrinth-metadata.ts")
    const items = [{ slug: "pack.zip", name: "Local name", projectId: "project", source: "modrinth" }]
    ${body}
  `
    const result = Bun.spawnSync([process.execPath, "--no-env-file", "-e", code], { stdout: "pipe", stderr: "pipe" })
    expect(result.exitCode, result.stderr.toString()).toBe(0)
  }
  describe("metadata-cache-policy", () => {
    test("одинаковые параллельные fallback запросы разделяют одну загрузку", () => scenario(`
  const gate = Promise.withResolvers()
  let requests = 0
  globalThis.fetch = async () => { requests++; await gate.promise; return Response.json([{ id: "project", title: "Remote name", author: "Author" }]) }
  const first = enrichBuildModNames(items), second = enrichBuildModNames(items)
  gate.resolve()
  await Promise.all([first, second])
  assert.equal(requests, 1)
`))

    test("отрицательный cache истекает; fallback не заменяет известные данные", () => scenario(`
  let now = 1000, requests = 0
  Date.now = () => now
  globalThis.fetch = async () => { requests++; if (requests === 1) throw new Error("offline"); return Response.json([{ id: "project", title: "Remote name", author: "Recovered" }]) }
  await enrichBuildModNames(items)
  await enrichBuildModNames(items)
  assert.equal(requests, 1)
  now += 31000
  const recovered = await enrichBuildModNames(items)
  assert.equal(requests, 2)
  assert.equal(recovered[0].author, "Recovered")
  assert.equal(recovered[0].name, "Local name")
  const known = await enrichBuildModNames([{ ...items[0], author: "Authoritative" }])
  assert.equal(known[0].author, "Authoritative")
`))

    test("очистка cache во время запроса не позволяет старому ответу заменить новый", () => scenario(`
  const gate = Promise.withResolvers()
  let requests = 0
  globalThis.fetch = async () => { const index = ++requests; if (index === 1) await gate.promise; return Response.json([{ id: "project", author: index === 1 ? "Old" : "New" }]) }
  const old = enrichBuildModNames(items)
  clearModrinthEnrichCache()
  await enrichBuildModNames(items)
  gate.resolve()
  await old
  assert.equal((await enrichBuildModNames(items))[0].author, "New")
`))
  })
}

{
  // Worker собирается на месте, а не берётся из dist-workers: тест не должен
  // зависеть от порядка build-скриптов и случайного generated output.
  const directory = await mkdtemp(path.join(tmpdir(), "xnlc-scan-worker-"))
  describe("scan-worker", () => {
    afterAll(() => { setScanWorkerEntry(); return rm(directory, { recursive: true, force: true }) })

    function buildWorker(outdir: string) {
      const result = Bun.spawnSync([
        process.execPath, "build", "packages/xnlc-parser/src/scan-worker.ts",
        "--target=bun", "--format=cjs", `--outdir=${outdir}`, "--entry-naming=[name].js",
      ], { stdout: "pipe", stderr: "pipe" })
      expect(result.exitCode).toBe(0)
      return path.join(outdir, "scan-worker.js")
    }

    test("scan-worker собирается, упаковывается и подключён в main", async () => {
      const buildScript = await readFile(new URL("../../scripts/build-bun-workers.mjs", import.meta.url), "utf8")
      expect(buildScript).toContain("./packages/xnlc-parser/src/scan-worker.ts")
      expect(bundledWorker("scan-worker")).toMatch(/bun[\\/]workers[\\/]scan-worker\.js$/)

      const config = await readFile(new URL("../../electrobun.config.ts", import.meta.url), "utf8")
      expect(config).toContain('"dist-workers": "bun/workers"')

      const main = await readFile(new URL("../../electrobun/main/index.ts", import.meta.url), "utf8")
      expect(main).toContain("configureLauncherScan()")
      const mode = await import("../../electrobun/main/scan-mode")
      expect(mode.configureLauncherScan({})).toBe("inline")
    })

    test("runScanWorker действительно запускает worker, а не inline-путь", async () => {
      const jar = path.join(directory, "demo.jar")
      await writeFile(jar, packArchiveSync({
        "fabric.mod.json": Buffer.from(JSON.stringify({ id: "demo", version: "1.2.3", name: "Demo" })),
        "demo.class": Buffer.from([0xca, 0xfe, 0xba, 0xbe]),
      }))
      const files = [{ filePath: jar }]

      // Несуществующий entry доказывает, что запрос уходит в Worker: inline-путь
      // прочитал бы JAR независимо от значения entry.
      setScanWorkerEntry(path.join(directory, "missing-worker.js"))
      await expect(runScanWorker(files, { metadata: true }, () => {})).rejects.toBeDefined()

      const entry = buildWorker(path.join(directory, "out"))
      setScanWorkerEntry(entry)
      const results: { filePath: string; error?: string; name?: string; sha1?: boolean }[] = []
      await runScanWorker(files, { metadata: true, sha1: true }, result => {
        results.push({ filePath: result.filePath, error: result.error, name: result.inspection?.metadata?.name, sha1: Boolean(result.inspection?.sha1) })
      })
      expect(results).toHaveLength(1)
      expect(results[0].error).toBeUndefined()
      expect(results[0].name).toBe("Demo")
      expect(results[0].sha1).toBe(true)
    }, 60000)

    test("runScanWorker переживает битый JAR и уважает отмену", async () => {
      const entry = buildWorker(path.join(directory, "cancel"))
      setScanWorkerEntry(entry)
      const broken = path.join(directory, "broken.jar")
      await writeFile(broken, "not a zip archive")
      const results: { filePath: string; error?: string }[] = []
      await runScanWorker([{ filePath: broken }], { metadata: true }, result => {
        results.push({ filePath: result.filePath, error: result.error })
      })
      // Разбор не падает всем пакетом из-за одного файла: результат приходит по каждому.
      expect(results).toHaveLength(1)
      expect(results[0].filePath).toBe(broken)

      const controller = new AbortController()
      controller.abort(new Error("cancelled"))
      await expect(runScanWorker([{ filePath: path.join(directory, "demo.jar") }], { metadata: true }, () => {}, controller.signal))
        .rejects.toThrow("cancelled")
    }, 60000)
  })
}

{
  const test = nodeTest
  const read=file=>fs.readFileSync(new URL('../../'+file,import.meta.url),'utf8')
  describe("performance-regressions", () => {
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
    function cache(){const module={exports:{}};vm.runInNewContext(transformSync(read('lib/swr.ts'),{loader:'ts',format:'cjs'}).code,{module,exports:module.exports,Date,Promise,require(name){assert.equal(name,'./bounded-cache');return {estimateCacheBytes}},localStorage:{getItem(){return null},setItem(){},removeItem(){}}});return module.exports.dataCache}
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
     const source=read('electrobun/main/settings-handlers.ts')
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
  })
}
