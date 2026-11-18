import {expect,test} from "bun:test"
import fs from "node:fs"
import vm from "node:vm"
import {transformSync} from "esbuild"

function cleanup(protectedBy?:"mutation"|"draft"|"write",visible=false){
  const source=fs.readFileSync(new URL("../../components/launcher/instance/use-builds.ts",import.meta.url),"utf8")
  const start=source.indexOf("  useEffect(() => () => {",source.indexOf("const pageActiveRef"))
  const end=source.indexOf("  }, [])",start)+"  }, [])".length
  if(start<0||end<0)throw new Error("Missing hidden content lifecycle")
  const original={id:"build",name:"Draft name",mods:Array.from({length:100},(_,i)=>({id:String(i),slug:i+".jar"})),resourcepacks:[],shaders:[],installedMods:{a:"a.jar"},modsCount:100}
  let state=[original],stop=()=>{}
  const ref={current:state}
  const saved=new Map([["build",original]]),shown=new Set(["build"]),manifests=new Map([["build",{}]]),cache=new Map()
  const scope={pageActiveRef:{current:visible},contentMutationsRef:{current:new Map(protectedBy==="mutation"?[["build",1]]:[])},
    pendingEditsRef:{current:new Map(protectedBy==="draft"?[["build",{}]]:[])},pendingPatchesRef:{current:[]},buildsRef:ref,
    displayedContentRef:{current:shown},savedContentRef:{current:saved},scanManifestsRef:{current:manifests},contentScanSeqRef:{current:new Map()},CONTENT_PATCH_FIELDS:new Set(["mods"]),
    buildWrites:{getPending:()=>protectedBy==="write"?{mods:original.mods}:{}},
    updateCachedBuildContent:(id:string,content:unknown)=>cache.set(id,content),setBuildsState:(update:Function)=>{state=update(state)},
    useEffect:(setup:Function)=>{stop=setup()},
  }
  vm.runInNewContext(transformSync(source.slice(start,end),{loader:"ts"}).code,scope)
  stop()
  return{original,state,ref,saved,shown,manifests,cache}
}
test("скрытая сборка отпускает DOM-state snapshots, один владелец контента остаётся в bounded cache",()=>{
  const result=cleanup()
  expect(result.state[0].mods).toEqual([])
  expect(result.state[0].modsCount).toBe(100)
  expect(result.state[0].name).toBe("Draft name")
  expect(result.saved.size).toBe(0);expect(result.shown.size).toBe(0)
  expect(result.manifests.size).toBe(1) // Только bounded hashes/WeakRef, не массивы.
  expect(result.cache.get("build").mods).toBe(result.original.mods)
  expect(result.ref.current).toBe(result.state)
})
test("cleanup не выбрасывает активную установку, черновик или незафиксированную запись",()=>{
  for(const guard of ["mutation","draft","write"] as const){
    const result=cleanup(guard)
    expect(result.state[0]).toBe(result.original)
    expect(result.saved.size).toBe(1)
  }
  expect(cleanup(undefined,true).saved.size).toBe(1)
})
