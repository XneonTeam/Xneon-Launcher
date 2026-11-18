import fs from "node:fs/promises"
import path from "node:path"
import {assetBase,protocol} from "../../platform/assets"
import {getDefaultLauncherDataRoot} from "../profile-path"
import {normalizeContentIcon} from "./content-icon"
import {BoundedCache} from "../../../lib/bounded-cache"

const namespace="xnl-content-icon"
const filenames=new BoundedCache<string,string>({capacity:512,ttlMs:5*60_000})
const pending=new Map<string,Promise<string>>()
let registered=false
let pruning:Promise<void>|undefined
// Превью привязано к профилю, а не к переносимому каталогу инстансов.
const directory=()=>path.join(getDefaultLauncherDataRoot(),"cache","content-icons")
const filePattern=/^[a-f0-9]{64}\.(png|jpeg|gif|webp|bmp|ico|svg)$/
function ownedFile(icon:string):string|null{
  try{
    const url=new URL(icon)
    if(url.protocol!=="http:"||url.hostname!=="127.0.0.1")return null
    const match=url.pathname.match(/^\/[a-f0-9]{48}\/xnl-content-icon\/([^/]+)$/)
    return match&&filePattern.test(match[1])?match[1]:null
  }catch{return null}
}
function register(){
  if(registered)return
  registered=true
  protocol.handle(namespace,async request=>{
    const file=new URL(request.url).hostname
    if(!filePattern.test(file))return new Response(null,{status:404})
    const target=path.join(directory(),file)
    const stat=await fs.lstat(target).catch(()=>null)
    if(!stat?.isFile()||stat.isSymbolicLink())return new Response(null,{status:404})
    const data=Bun.file(target)
    if(!(await data.exists()))return new Response(null,{status:404})
    const extension=file.split(".").at(-1)
    const subtype=extension==="svg"?"svg+xml":extension==="ico"?"x-icon":extension
    return new Response(data,{headers:{"Content-Type":`image/${subtype}`,"Cache-Control":"private, max-age=31536000, immutable","X-Content-Type-Options":"nosniff","Content-Security-Policy":"default-src 'none'; sandbox"}})
  })
}
function pruneDisk(){
  return pruning??=(async()=>{
    const files=[] as Array<{file:string;size:number;mtime:number}>
    for(const file of await fs.readdir(directory()).catch(()=>[])){
      if(!filePattern.test(file))continue
      const stat=await fs.stat(path.join(directory(),file)).catch(()=>null)
      if(stat?.isFile())files.push({file,size:stat.size,mtime:stat.mtimeMs})
    }
    files.sort((a,b)=>b.mtime-a.mtime)
    let bytes=0,count=0
    for(const item of files){
      bytes+=item.size;count++
      if(count>4096||bytes>256*1024*1024||Date.now()-item.mtime>7*24*60*60_000)await fs.rm(path.join(directory(),item.file),{force:true}).catch(()=>{})
    }
  })()
}
async function publicIcon(icon:string):Promise<string>{
  register()
  await pruneDisk()
  const owned=ownedFile(icon)
  if(owned)return assetBase()+namespace+"/"+owned
  if(!/^data:image\/(png|jpeg|gif|webp|bmp|x-icon|svg\+xml);base64,/.test(icon))return icon
  const key=new Bun.CryptoHasher("sha256").update(icon).digest("hex")
  let filename=filenames.get(key)
  if(!filename){
    let task=pending.get(key)
    if(!task){
      task=(async()=>{
    const normalized=normalizeContentIcon(icon)
    const match=normalized.match(/^data:image\/(png|jpeg|gif|webp|bmp|x-icon|svg\+xml);base64,([\s\S]*)$/)!
    if(match[2].length>8*1024*1024)throw new Error("Content image exceeds preview budget")
    const extension=match[1]==="svg+xml"?"svg":match[1]==="x-icon"?"ico":match[1]
    const bytes=Buffer.from(match[2],"base64")
    const filename=new Bun.CryptoHasher("sha256").update(bytes).digest("hex")+"."+extension
    await fs.mkdir(directory(),{recursive:true})
    const file=path.join(directory(),filename)
    const stat=await fs.lstat(file).catch(()=>null)
    if(!stat?.isFile()||stat.isSymbolicLink()||stat.size!==bytes.length){
      const temporary=file+"."+crypto.randomUUID()+".tmp"
      try{await fs.writeFile(temporary,bytes,{flag:"wx"});await fs.rename(temporary,file)}
      finally{await fs.rm(temporary,{force:true}).catch(()=>{})}
    }
    filenames.set(key,filename)
    return filename
      })().finally(()=>pending.delete(key))
      pending.set(key,task)
    }
    filename=await task
  }
  return assetBase()+namespace+"/"+filename
}
async function storedIcon(icon:string):Promise<string>{
  const filename=ownedFile(icon)
  if(!filename)return icon
  const target=path.join(directory(),filename)
  const stat=await fs.lstat(target)
  if(!stat.isFile()||stat.isSymbolicLink())throw new Error("Invalid cached content image")
  const bytes=await fs.readFile(target)
  const ext=filename.split(".").at(-1)
  return `data:image/${ext==="svg"?"svg+xml":ext==="ico"?"x-icon":ext};base64,${bytes.toString("base64")}`
}
async function mapIcons<T extends object>(content:T|null,convert:(icon:string)=>Promise<string>):Promise<T|null>{
  if(!content)return content
  let result=content
  for(const key of ["mods","resourcepacks","shaders"] as const){
    const rows=(content as Record<string,unknown>)[key]
    if(!Array.isArray(rows))continue
    let changed=false
    const next:unknown[]=[]
    // Ограничиваем одновременно живущие PNG/file буферы одним изображением.
    for(const item of rows){
      if(!item||typeof item!=="object"||typeof item.icon_url!=="string"){next.push(item);continue}
      const icon=await convert(item.icon_url).catch(error=>{
        // Ошибка дискового кеша не должна скрывать содержимое сборки.
        // Обратное преобразование при сохранении, напротив, не теряет данные молча.
        if(convert===publicIcon)return item.icon_url as string
        throw error
      })
      if(icon===item.icon_url)next.push(item)
      else{changed=true;next.push({...item,icon_url:icon})}
    }
    if(changed)result={...result,[key]:next}
  }
  return result
}
/** Только wire/UI: картинки не встраиваются в выполняемые IPC-скрипты. */
export const publicContentIcons=<T extends object>(content:T|null)=>mapIcons(content,publicIcon)
/** SQLite/экспорт остаются переносимыми; session URL не записывается в сборку. */
export const storedContentIcons=<T extends object>(content:T|null)=>mapIcons(content,storedIcon)
