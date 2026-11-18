import { expect, test } from "bun:test"
import fs from "node:fs"
import vm from "node:vm"
import { transformSync } from "esbuild"
import { PNG } from "pngjs"

async function catalogRequests(tab: string) {
  const effects: (()=>void|(()=>void))[]=[]
  const calls:string[]=[]
  const cleanups: Function[]=[]
  const module={exports:{} as any}
  const source=fs.readFileSync(new URL("../../components/launcher/instance/use-mod-search.ts",import.meta.url),"utf8")
  const react={useState:(initial:any)=>[typeof initial==="function"?initial():initial,()=>{}],useRef:(current:any)=>({current}),useCallback:(fn:any)=>fn,useMemo:(fn:any)=>fn(),useEffect:(fn:any)=>effects.push(fn)}
  const api={modsModrinthSearch:async()=>{calls.push("search");return{results:[],totalCount:0}},modsModrinthCategories:async()=>{calls.push("categories");return[]}}
  vm.runInNewContext(transformSync(source,{loader:"ts",format:"cjs"}).code,{
    module,exports:module.exports,window:{electrobunAPI:api},setTimeout,clearTimeout,console,
    require:(name:string)=>{
      if(name==="react")return react
      if(name==="./constants")return{MODS_PER_PAGE:20}
      if(name==="@/lib/swr")return{dataCache:{getOrFetch:(_key:string,fetcher:Function)=>fetcher()},MOD_SEARCH_CACHE_TTL:600000}
      if(name==="./sort-options")return{SORT_OPTIONS_BY_SOURCE:{modrinth:["downloads"]}}
      if(name==="./utils")return{groupVersionsByCompatibility:()=>({exact:[],byLoader:[],all:[]}),isProjectCompatibleWithBuild:()=>true}
      if(name==="./instance-content-tab")return{normalizeContentIdentity:(value:string)=>value}
      throw new Error("Unexpected import "+name)
    },
  })
  module.exports.useModSearch({id:"build",version:"1.21.1",modLoader:"fabric",mods:[],resourcepacks:[],shaders:[]},tab,"detail","build")
  for(const effect of effects){const cleanup=effect();if(typeof cleanup==="function")cleanups.push(cleanup)}
  await new Promise(resolve=>setTimeout(resolve,5))
  for(const cleanup of cleanups)cleanup()
  return calls
}

test("открытие общей страницы сборки не загружает невидимый каталог модов",async()=>{
  expect(await catalogRequests("general")).toEqual([])
})

test("миры/скриншоты/настройки сборки не поднимают невидимый поиск",async()=>{
  for(const tab of ["worlds","screenshots","servers","settings"])expect(await catalogRequests(tab)).toEqual([])
})

test("открытие контентных вкладок сохраняет загрузку поиска и категорий",async()=>{
  for(const tab of ["mods","resourcepacks","shaders"])expect((await catalogRequests(tab)).sort()).toEqual(["categories","search"])
})

test("первое чтение старого build content уменьшает иконку до отправки renderer, не меняя БД",async()=>{
  const source=fs.readFileSync(new URL("../../electrobun/main/system.ts",import.meta.url),"utf8")
  const statement=source.match(/rpcRegistry\.handle\("db:load-build-content",[^\n]+/)?.[0]
  expect(statement).toBeDefined()
  const image=new PNG({width:1024,height:512})
  image.data.fill(255)
  const icon="data:image/png;base64,"+PNG.sync.write(image).toString("base64")
  const content={mods:[{slug:"a.jar",name:"A",icon_url:icon}],resourcepacks:[],shaders:[],installedMods:{"a.jar":"C:/a.jar"}}
  const helpers=await import("../../electrobun/main/builds/content-icon")
  let handler:Function=()=>{}
  vm.runInNewContext(transformSync(statement!,{loader:"ts"}).code,{
    rpcRegistry:{handle:(_name:string,fn:Function)=>{handler=fn}},dbHelpers:{loadBuildContent:async()=>content},
    publicContentIcons:async(content:Parameters<typeof helpers.normalizeBuildContentIcons>[0])=>helpers.normalizeBuildContentIcons(content),
  })
  const result=await handler(null,"build")
  const normalized=PNG.sync.read(Buffer.from(result.mods[0].icon_url.split(",")[1],"base64"))
  expect(normalized.width).toBe(128)
  expect(normalized.height).toBe(64)
  expect(content.mods[0].icon_url).toBe(icon)
  expect(result.installedMods).toBe(content.installedMods)
})
