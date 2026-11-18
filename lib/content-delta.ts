import {normalizeContentDto} from "./content-reconciliation"
/** Дельта не хранит серверную сессию: состояние сравнения принадлежит клиенту. */
export type ContentRows = { mods: Array<{id:string;slug:string;name:string;description:string;version:string;[key:string]:unknown}>; resourcepacks: ContentRows["mods"]; shaders: ContentRows["mods"]; installedMods: Record<string,string> }
export type ContentManifest = { mods: Record<string,string>; resourcepacks: Record<string,string>; shaders: Record<string,string>; installedMods: Record<string,string> }
export type RowDelta = { upsert: ContentRows["mods"]; remove: string[]; order?: string[] }
export type ContentDelta = { mods:RowDelta;resourcepacks:RowDelta;shaders:RowDelta;installedMods:{upsert:Record<string,string>;remove:string[]};manifest:ContentManifest }
const sections=["mods","resourcepacks","shaders"] as const
async function digest(value:unknown):Promise<string>{
  const json=JSON.stringify(value,(_key,item)=>item&&typeof item==="object"&&!Array.isArray(item)?Object.fromEntries(Object.keys(item).sort().map(key=>[key,item[key]])):item)
  return [...new Uint8Array(await crypto.subtle.digest("SHA-256",new TextEncoder().encode(json)))].map(byte=>byte.toString(16).padStart(2,"0")).join("")
}
export async function contentManifest(content:ContentRows,previous?:{content:Partial<ContentRows>;manifest:ContentManifest}):Promise<ContentManifest>{
  const manifest:ContentManifest={mods:Object.create(null),resourcepacks:Object.create(null),shaders:Object.create(null),installedMods:{...content.installedMods}}
  for(const key of sections){
    const old=new Map(previous?.content[key]?.map(item=>[item.slug,item]))
    for(const item of content[key]){
      // UI может сохранить известного автора при пустом scanner author. Пока
      // строка та же, сравниваем с её scanner DTO, а не с этим fallback.
      const known=old.get(item.slug)===item?previous?.manifest[key][item.slug]:undefined
      manifest[key][item.slug]=known??await digest(normalizeContentDto(item))
    }
  }
  return manifest
}
export async function createContentDelta(content:ContentRows,known?:ContentManifest):Promise<ContentDelta>{
  const manifest=await contentManifest(content)
  const delta={} as ContentDelta
  for(const key of sections){
    const old=known?.[key]??{},current=manifest[key]
    const order=content[key].map(item=>item.slug)
    const previous=Object.keys(old)
    delta[key]={upsert:content[key].filter(item=>old[item.slug]!==current[item.slug]),remove:previous.filter(slug=>!Object.hasOwn(current,slug)),
      ...(!known||order.length!==previous.length||order.some((slug,i)=>slug!==previous[i])?{order}:{})}
  }
  delta.installedMods={upsert:Object.fromEntries(Object.entries(content.installedMods).filter(([key,value])=>known?.installedMods?.[key]!==value)),remove:Object.keys(known?.installedMods??{}).filter(key=>!Object.hasOwn(content.installedMods,key))}
  delta.manifest=manifest
  return delta
}
export function applyContentDelta<T extends ContentRows>(current:T,delta:ContentDelta):T{
  let result=current
  for(const key of sections){
    const change=delta[key]
    if(!change.upsert.length&&!change.remove.length&&!change.order)continue
    const rows=new Map(current[key].map(item=>[item.slug,item]))
    for(const slug of change.remove)rows.delete(slug)
    for(const item of change.upsert)rows.set(item.slug,item)
    const next=change.order?change.order.flatMap(slug=>{const row=rows.get(slug);return row?[row]:[]}):[...rows.values()]
    result={...result,[key]:next}
  }
  const change=delta.installedMods
  if(Object.keys(change.upsert).length||change.remove.length){
    const installedMods={...current.installedMods,...change.upsert}
    for(const slug of change.remove)delete installedMods[slug]
    result={...result,installedMods}
  }
  return result
}
