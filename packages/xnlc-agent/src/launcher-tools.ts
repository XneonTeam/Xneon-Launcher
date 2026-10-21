import { getAgentHost } from "./host.js"
import type { ElectronAPI } from "@xnlc/types"
import type { AgentTool, Field } from "./tools.js"
import { LAUNCHER_CAPABILITIES, IPC_CHANNELS, type LauncherCapability } from "./launcher-ipc-catalog.js"

type Register = (name:string,description:string,risk:AgentTool["risk"],fields:Record<string,Field>,run:AgentTool["run"],group?:string)=>void
const str:Field={type:"string",maxLength:300}
const opt=(field:Field):Field=>({...field,optional:true})
const argsField:Field={type:"string",maxLength:128000,optional:true,description:"JSON-массив позиционных аргументов по signature из get_launcher_capability. Не передавай пароли или токены."}
const privateKey=/(?:password|secret|credential|api.?key|access.?token|refresh.?token|client.?token|device.?code|user.?code|^token$|^authorization$|^cookie$|customEnv)/i
const domain:Record<string,string[]>={renameBuildIntent:["rename_build"],copyBuild:["copy_build"],saveBuilds:["create_build","rename_build","set_build_options"],insertBuild:["create_build","install_modpack"],updateBuildFields:["get_build","unlock_build","set_build_options","set_build_memory","set_build_version"],setSetting:["set_setting","set_theme","set_language"],launchMinecraft:["launch_build"],importModrinthModpack:["install_modpack"],importCurseforgeModpack:["install_modpack"],importFtbModpack:["install_modpack"],saveModToIntent:["install_content"],saveContentToIntent:["install_content"],deleteContentFromIntent:["remove_content"],setContentEnabled:["toggle_content"],agentBuildFile:["read_build_file","list_build_files","write_build_config"],agentBuildDestination:["create_build","rename_build"],saveAccount:["open_launcher_section"],setBuildIntentPath:["create_build"],deleteBuildIntent:["trash_build"],moveBuildIntentToTrash:["trash_build"],restoreBuildIntentFromTrash:["restore_build"],setOfflineAuth:["open_launcher_section"]}
const extraRead = new Set(["loadAccounts","loadBuildsLight","loadBuildContent","agentGetChat","agentListChats","agentHardware","xnConnectStatus","updateCheck","mcServerAnalyzeJar","classifyDropPaths"])
const runtime=new Set(["startupReady","agentComplete","agentCancel","agentSaveChat","agentDeleteChat","agentSetArchived","analyzeCrash","analyzeCrashStream","getFilePath"])
function uiSection(method:string):string|null {
  if(/^(login|start.*DeviceCode|poll.*DeviceCode|authlibLogin|authlibEnsureSession|authlibAddServer)/.test(method))return"accounts"
  if(method==="cloudConnect")return"cloud"
  if(method==="xnConnectAuthorize")return"servers"
  if(method==="openAndImportModpack")return"builds"
  if(method==="saveAiConfig")return"settings:ai"
  if(method==="readLocalFile")return"agent:files"
  return null
}
export function launcherCapabilityMode(item:LauncherCapability):"read"|"action"|"event"|"interface"|"domain"|"runtime" {
  if(item.event)return"event"
  if(runtime.has(item.method))return"runtime"
  if(uiSection(item.method))return"interface"
  if(domain[item.method])return"domain"
  if(extraRead.has(item.method)||!item.callable||/^(get|list|fetch|detect|scan|check|ping|discover|read|is|dbIs|skinsGet|skinsList|labyCatalog|labyTags|labySimilar|labyPlayer|quickPlayList|xnConnectUsage|xnConnectGet|cloudList|cloudIs|cloudGet|mods|authlibList|authlibProbe|authlibGet|mcServerGet|mcServerList|mcServerStatus|mcServerLogs|mcServerInstallState|mcServerRead|mcServerCheck|mcServerFsList|mcServerFsRead|mcServerResolve|avatarGet)/.test(item.method))return"read"
  return"action"
}
export function redactLauncherValue(value:unknown,depth=0):unknown {
  if(depth>16)return"[TRUNCATED]"
  if(Array.isArray(value))return value.slice(0,500).map(item=>redactLauncherValue(item,depth+1))
  if(value&&typeof value==="object"){
    const object=value as Record<string,unknown>
    return Object.fromEntries(Object.entries(object).filter(([key])=>!["__proto__","constructor","prototype"].includes(key)).map(([key,item])=>[key,privateKey.test(key)||key==="value"&&typeof object.key==="string"&&privateKey.test(object.key)?"[REDACTED]":redactLauncherValue(item,depth+1)]))
  }
  if(typeof value==="string"&&value.startsWith("data:"))return "[MEDIA: use the attachment UI to send this file]"
  if(typeof value==="string")return value.replace(/-----BEGIN [^-]*PRIVATE KEY-----[\s\S]*?-----END [^-]*PRIVATE KEY-----/g,"[REDACTED]").replace(/((?:password|secret|api[_-]?key|access[_-]?token|refresh[_-]?token|authorization)["']?\s*[:=]\s*["']?)[^\s,"'}]+/gi,"$1[REDACTED]").replace(/Bearer\s+[\w.\-]+/gi,"Bearer [REDACTED]").slice(0,128000)
  return value
}
function describe(item:LauncherCapability){return{...item,mode:launcherCapabilityMode(item),useTools:domain[item.method],section:uiSection(item.method)}}
function resolve(method:string){const item=LAUNCHER_CAPABILITIES.find(item=>item.method===method);if(!item)throw new Error("Unknown launcher method; call list_launcher_capabilities");return item}
function parseArgs(item:LauncherCapability,raw:string){const args:unknown=JSON.parse(raw||"[]");if(!Array.isArray(args)||args.length>item.parameters.length||args.length<item.parameters.filter(param=>!param.optional).length)throw new Error("Arguments must match the launcher method signature");function validate(value:unknown,depth=0){if(depth>16)throw new Error("Arguments are too deeply nested");if(typeof value==="number"&&!Number.isFinite(value))throw new Error("Invalid number");if(typeof value==="string"&&value.length>128000)throw new Error("Argument too large");if(value&&typeof value==="object")for(const[key,part]of Object.entries(value)){if(["__proto__","constructor","prototype"].includes(key))throw new Error("Invalid object key");if(privateKey.test(key))throw new Error("Enter credentials in the launcher UI");validate(part,depth+1)}}validate(args);return args.map((value,index)=>{const param=item.parameters[index];if(value===null&&param.optional)return undefined;const type=param.type;if(["string","number","boolean"].includes(type)&&typeof value!==type)throw new Error("Invalid argument: "+param.name);return value})}
export async function invokeLauncherCapability(api:ElectronAPI,method:string,raw:string,mode:"read"|"action"):Promise<unknown>{
  const item=resolve(method),kind=launcherCapabilityMode(item)
  if(kind==="interface") { const section=uiSection(method)!; getAgentHost().emit("launcher:open-section",{section});return{opened:true,section,awaitingUserInput:true,instruction:"The user completes credential entry or file selection in the launcher. Do not request passwords or codes in chat."} }
  if(kind==="domain")return{useTools:domain[method],instruction:"Use these domain tools to preserve build metadata, compatibility, dependency handling and user confirmations."}
  if(kind==="runtime")return{managedByRuntime:true,method,instruction:"This lifecycle or agent-persistence method is already managed by the launcher. Use chat controls or normal agent tools."}
  if(kind!==mode)throw new Error("Use the matching launcher read/action/event tool")
  if(method==="getSetting") { const args=JSON.parse(raw||"[]");if(privateKey.test(String(args[0])))return{requiresUserInput:true,section:"settings",redacted:true} }
  const args=parseArgs(item,raw)
  // Низкоуровневые файловые действия не должны обходить согласие на разблокировку.
  if(mode==="action"&&/^(saveLocal|installDatapack|deleteWorldDatapack|mcServerFs)/.test(method)&&typeof args[0]==="string"){
    const target=(await api.loadBuildsLight()).find(build=>build.id===args[0]||build.name===args[0])
    if(target&&(target.locked===true||["modrinth","curseforge","ftb"].includes(target.source)&&target.locked!==false))return{requiresUnlock:true,buildId:target.id,useTools:["unlock_build"],instruction:"Ask for unlocking through unlock_build, then retry."}
  }
  const member=api[item.method]
  if(!item.callable)return redactLauncherValue(member)
  if(typeof member!=="function")throw new Error("Launcher method is unavailable")
  const result=await(member as(...args:unknown[])=>unknown)(...args)
  if(mode==="action"){getAgentHost().emit("launcher:agent-updated");if(/account|skin|laby/i.test(method))getAgentHost().emit("launcher:agent-accounts-updated")}
  return redactLauncherValue(result===undefined?{success:true}:result)
}
export function registerLauncherTools(add:Register){
  add("get_launcher_news","Новости Xneon Launcher из настоящей ленты лаунчера.","read",{},api=>api.fetchLauncherNews())
  add("get_minecraft_news","Новости Minecraft из ленты главной страницы.","read",{},api=>api.fetchMinecraftNews())
  add("get_ftb_catalog","Фильтры каталога FTB: категории, версии Minecraft и загрузчики.","read",{},api=>api.modsFtbCatalogFacets(),"ftb")
  add("get_ftb_versions","Все версии модпака FTB.","read",{projectId:{type:"number"}},async(api,input)=>{const result=await api.modsFtbDetails(Number(input.projectId));if(!result)throw new Error("FTB project not found");return result.versions},"ftb")
  add("get_ftb_changelog","Список изменений выбранной версии FTB.","read",{projectId:{type:"number"},versionId:{type:"number"}},(api,input)=>api.modsFtbChangelog(Number(input.projectId),Number(input.versionId)),"ftb")
  add("list_launcher_capabilities","Полный каталог всех IPC-функций лаунчера. Ищи по имени, каналу или разделу (ftb, news, cloud, skins, server, world, account, update, storage). query пусто — весь каталог постранично.","read",{query:opt(str),offset:opt({type:"number"})},async(_api,input)=>{const query=String(input.query||"").toLowerCase(),all=LAUNCHER_CAPABILITIES.filter(item=>(item.method+" "+item.channels.join(" ")).toLowerCase().includes(query)),offset=Math.max(0,Number(input.offset)||0);return{total:all.length,totalMethods:LAUNCHER_CAPABILITIES.length,totalChannels:IPC_CHANNELS.length,items:all.slice(offset,offset+30).map(describe),nextOffset:offset+30<all.length?offset+30:null}},undefined)
  add("get_launcher_capability","Сигнатура, аргументы, IPC-канал и способ вызова конкретной функции лаунчера. После изучения используй invoke_launcher_read/action или watch_launcher_event из группы launcher_ipc.","read",{method:str},async(_api,input)=>describe(resolve(String(input.method))))
  add("invoke_launcher_read","Прочитать данные любой функции чтения из каталога IPC. arguments — JSON-массив аргументов по её signature. Секреты скрываются.","read",{method:str,arguments:argsField},(api,input)=>invokeLauncherCapability(api,String(input.method),String(input.arguments||"[]"),"read"),"launcher_ipc")
  add("invoke_launcher_action","Выполнить действие из полного каталога IPC с отдельным подтверждением. arguments — JSON-массив позиционных аргументов. Для защищённых доменных операций вернёт конкретные инструменты; для входа откроет штатный интерфейс.","sensitive",{method:str,arguments:argsField},(api,input)=>invokeLauncherCapability(api,String(input.method),String(input.arguments||"[]"),"action"),"launcher_ipc")
  add("watch_launcher_event","Наблюдать любое событие моста IPC до 10 секунд (прогресс, игра, сервер, облако). Возвращает до 20 образцов, затем обязательно снимает подписку.","read",{method:str,timeoutMs:opt({type:"number"})},async(api,input)=>{const item=resolve(String(input.method));if(!item.event)throw new Error("Select an event subscription from the catalog");const timeout=Math.min(10000,Math.max(100,Number(input.timeoutMs)||2000));return new Promise(resolve=>{const samples:unknown[]=[];const subscribe=api[item.method] as(callback:(value:unknown)=>void)=>()=>void;const off=subscribe(value=>{if(samples.length<20)samples.push(redactLauncherValue(value))});setTimeout(()=>{off();resolve({event:item.method,samples})},timeout)})},"launcher_ipc")
  add("open_launcher_section","Открыть раздел лаунчера или штатный ввод учётных данных. Не запрашивает пароль в чате.","write",{section:{...str,enum:["home","builds","accounts","settings","settings:ai","settings:themes","cloud","skins","servers","stats","logs","agent","agent:files"]}},async(_api,input)=>{getAgentHost().emit("launcher:open-section",{section:input.section});return{opened:true,section:input.section}},"launcher_ipc")
}
