import fs from "node:fs"
import path from "node:path"
const root=process.cwd()
const contracts=fs.readFileSync(path.join(root,"packages/xnlc-types/src/ipc-contracts.ts"),"utf8")
const preload=fs.readFileSync(path.join(root,"electrobun/preload.ts"),"utf8")
const channels=[...contracts.slice(contracts.indexOf("export interface IpcInvokeMap"),contracts.indexOf("export interface IpcEventMap")).matchAll(/^  ["']([^"']+)["']:/gm)].map(match=>match[1])
const events=[...contracts.slice(contracts.indexOf("export interface IpcEventMap"),contracts.indexOf("export interface ElectrobunAPIExplicit")).matchAll(/^  ["']([^"']+)["']:/gm)].map(match=>match[1])
const channelSet=new Set(channels)
const allChannelSet=new Set([...channels,...events])
function split(value){let depth=0,quote="",start=0,result=[];for(let i=0;i<value.length;i++){const c=value[i];if(quote){if(c===quote&&value[i-1]!=="\\")quote="";continue}if(/["'`]/.test(c)){quote=c;continue}if("([{<".includes(c))depth++;else if(")]}>".includes(c)&&depth>0)depth--;if(c===","&&depth===0){result.push(value.slice(start,i).trim());start=i+1}}if(value.slice(start).trim())result.push(value.slice(start).trim());return result}
function parameters(signature){if(!signature.startsWith("("))return[];let depth=0,end=0;for(let i=0;i<signature.length;i++){if(signature[i]==="(")depth++;if(signature[i]===")"&&--depth===0){end=i;break}}return split(signature.slice(1,end)).map(part=>{const at=part.indexOf(":");const name=part.slice(0,at).trim();return{name:name.replace(/[?]/g,""),optional:name.includes("?"),type:part.slice(at+1).trim()}})}
const declarations=new Map([...contracts.slice(contracts.indexOf("export interface ElectrobunAPIExplicit")).matchAll(/^  (\w+): (.+)$/gm)].map(match=>[match[1],match[2].trim()]))
const entries=[...preload.slice(preload.indexOf("installDesktopApi({")).matchAll(/^  (\w+):/gm)]
const catalog=entries.map((entry,index)=>{const method=entry[1],signature=declarations.get(method);if(!signature)throw Error("Missing contract: "+method);const body=preload.slice(entry.index+preload.indexOf("installDesktopApi({"),entries[index+1]?entries[index+1].index+preload.indexOf("installDesktopApi({"):preload.length);return{method,signature,parameters:parameters(signature),channels:[...body.matchAll(/["']([^"']+)["']/g)].map(match=>match[1]).filter(value=>allChannelSet.has(value)),event:method.startsWith("on")&&signature.includes("callback"),callable:signature.startsWith("(")}})
const covered=new Set(catalog.flatMap(item=>item.channels));const unbridged=[...channelSet].filter(channel=>!covered.has(channel))
const registered=new Set()
function registrations(directory){for(const item of fs.readdirSync(directory,{withFileTypes:true})){const file=path.join(directory,item.name);if(item.isDirectory())registrations(file);else if(file.endsWith('.ts')&&!file.endsWith('.d.ts'))for(const match of fs.readFileSync(file,'utf8').matchAll(/(?:rpcRegistry\.handle|registerMcServerHandler|ctxHandler|rawHandler)\s*\(\s*["']([^"']+)["']/g))registered.add(match[1])}}
registrations(path.join(root,'electrobun'))
// Декларативная таблица списков игроков регистрируется общим циклом.
const serverHandlers=fs.readFileSync(path.join(root,'electrobun/main/mc-server-handlers.ts'),'utf8')
for(const block of serverHandlers.matchAll(/channels:\s*\{([^}]+)\}/g))for(const match of block[1].matchAll(/(?:get|add|remove):\s*["']([^"']+)["']/g))registered.add(match[1])
const unregistered=[...channelSet].filter(channel=>!registered.has(channel))
const undeclared=[...registered].filter(channel=>!channelSet.has(channel))
if(unregistered.length||undeclared.length)throw Error('IPC registration mismatch: '+JSON.stringify({unregistered,undeclared}))
const output='// Сгенерировано scripts/gen-agent-ipc-catalog.mjs из IPC-контрактов и preload.\nimport type { ElectrobunAPI } from "@xnlc/types"\nexport interface LauncherCapability { method: keyof ElectrobunAPI; signature: string; parameters: Array<{name:string;optional:boolean;type:string}>; channels:string[]; event:boolean; callable:boolean }\nexport const LAUNCHER_CAPABILITIES: LauncherCapability[] = '+JSON.stringify(catalog,null,2)+'\nexport const UNBRIDGED_IPC_CHANNELS = '+JSON.stringify(unbridged)+'\nexport const IPC_CHANNELS = '+JSON.stringify([...channelSet])+'\n'
const finalOutput=output+'export const IPC_EVENTS = '+JSON.stringify(events)+'\n'
const out=path.join(root,'packages/xnlc-agent/src/launcher-ipc-catalog.ts');if(process.argv.includes('--check')){if(fs.readFileSync(out,'utf8')!==finalOutput)throw Error('IPC catalog is outdated; run bun scripts/gen-agent-ipc-catalog.mjs')}else fs.writeFileSync(out,finalOutput)
console.log(JSON.stringify({methods:catalog.length,invoke:channelSet.size,events:events.length,unbridged,unregistered}))
