import type { DbBuildLight, ElectronAPI } from "@xnlc/types"
import type { AgentTool, Field } from "./tools.js"
import { getAgentHost } from "./host.js"
import { THEME_COLOR_KEYS, createCustomTheme, duplicateTheme, parseThemes, serializeThemes, sanitizeTheme, normalizeHex, themePreviewColors } from "./host.js"
import type { Theme } from "@xnlc/types"

type Input = Record<string, unknown>
type Register = (name: string, description: string, risk: AgentTool["risk"], fields: Record<string, Field>, run: AgentTool["run"], group?: string) => void
const str: Field = { type: "string", maxLength: 300 }
const num: Field = { type: "number" }
const bool: Field = { type: "boolean" }
const choice = (...values: string[]): Field => ({ ...str, enum: values })
const text = (input: Input, key: string) => String(input[key] ?? "")
function bounded(value: unknown, min: number, max: number) { if (typeof value !== "number" || !Number.isInteger(value) || value < min || value > max) throw new Error(`Expected integer between ${min} and ${max}`); return value }
function safeMap(value: string | undefined): Record<string, string> { try { const input = JSON.parse(value || "{}"); return Object.fromEntries(Object.entries(input).filter(([key, item]) => !["__proto__", "constructor", "prototype"].includes(key) && typeof item === "string")) as Record<string,string> } catch { return {} } }
async function themes(api: ElectronAPI) { return [...getAgentHost().themes.presets, ...parseThemes(await api.getSetting("customThemes"))] }
async function theme(api: ElectronAPI, input: Input) { const id = text(input, "themeId") || await api.getSetting("theme") || "orange"; const found = (await themes(api)).find(item => item.id === id); if (!found) throw new Error("Theme not found; call list_themes first"); return found }
async function editTheme(api: ElectronAPI, input: Input, change: (value: Theme) => Theme) {
  const all = await themes(api), current = await theme(api,input)
  const editable = current.custom ? structuredClone(current) : duplicateTheme(current, current.name, all.map(item => item.id))
  const next = sanitizeTheme({ ...change(editable), updatedAt: Date.now() })
  if (!next) throw new Error("Invalid theme")
  await api.setSetting("customThemes", serializeThemes([...all.filter(item => item.custom && item.id !== next.id), next]))
  if ((await api.getSetting("theme") || "orange") === current.id) await api.setSetting("theme", next.id)
  return { success: true, themeId: next.id, theme: next }
}
const themeId = { themeId: { ...str, optional: true } }

export function registerExtendedTools(add: Register, deps: { build: (api: ElectronAPI,input:Input)=>Promise<DbBuildLight>; unlocked: (api: ElectronAPI,input:Input)=>Promise<DbBuildLight>; call: (name:string,api:ElectronAPI,input:Input)=>Promise<unknown> }) {
  add("get_hardware", "Характеристики ПК: CPU, видеокарты, ОЗУ, ОС, экраны и свободное место. Используй перед настройкой лаунчера.", "read", {}, api => api.agentHardware())
  add("unlock_build", "Разблокировать сборку для изменения модов и настроек. Среда выполнения ОБЯЗАТЕЛЬНО задаст интерактивный вопрос пользователю, в том числе в авторежиме. После согласия продолжи исходную задачу.", "write", { buildId: str }, async (api,input) => { const target=await deps.build(api,input); await api.updateBuildFields(target.id,{locked:false}); return { success:true,buildId:target.id,locked:false } })
  add("lock_build", "Защитить сборку модпака от изменения содержимого.", "write", { buildId:str }, async(api,input)=>{const target=await deps.build(api,input);if(!["modrinth","curseforge"].includes(target.source))throw new Error("Only linked modpacks can be locked");await api.updateBuildFields(target.id,{locked:true});return{success:true,locked:true}})
  add("list_languages", "Доступные языки интерфейса.", "read", {}, async()=>[{id:"ru",name:"Русский"},{id:"en",name:"English"},{id:"uk",name:"Українська"},{id:"de",name:"Deutsch"},{id:"es",name:"Español"}])
  add("set_language", "Сменить язык интерфейса немедленно, без перезапуска.", "write", { language:choice("ru","en","uk","de","es") },(api,input)=>deps.call("set_setting",api,{key:"language",value:input.language}))
  add("list_themes", "Все реальные темы лаунчера: встроенные и пользовательские. Перед сменой темы узнай её ID.", "read", {},async api=>(await themes(api)).map(({id,name,custom})=>({id,name,custom:!!custom})))
  add("set_theme", "Применить существующую тему по её ID немедленно, без перезапуска.", "write", {themeId:str},async(api,input)=>{const selected=await theme(api,input);await api.setSetting("theme",selected.id);return{success:true,id:selected.id,name:selected.name}})
  add("recommend_launcher_settings", "Получить характеристики ПК, текущие настройки и консервативный план настройки RAM и Java. Ничего не меняет. Сначала уточни цель (производительность, модпак, шейдеры).", "read", {},async api=>{const hardware=await api.agentHardware();const maxMiB=Math.max(512,Math.min(8192,Math.floor(hardware.memory.totalBytes/1024**2/2/512)*512));return{hardware,current:await deps.call("read_settings",api,{}),recommended:{memoryMin:"512M",memoryMax:`${maxMiB}M`,javaPath:"",useBmclapi:false},instruction:"Explain the plan, then apply only relevant settings with set_setting or specialized tools. Do not allocate all system RAM or change JVM flags, authentication, resolution or language without a reason."}})
  for (const part of ["cpu","gpu","memory","os","displays","storage","launcherVersion"] as const) add(`get_hardware_${part.replace(/[A-Z]/g,c=>"_"+c.toLowerCase())}`,`Характеристики ПК: ${part}.`,"read",{},async api=>(await api.agentHardware())[part],"hardware")
  add("detect_java", "Найти установленные Java: версии, пути, архитектуры.","read",{},api=>api.detectJavaInstallations(),"hardware")
  add("get_running_game", "Состояние запущенного Minecraft.","read",{},api=>api.isMinecraftRunning(),"hardware")

  const settings: Array<[string,string,Field]> = [
    ["memoryMin","минимальная RAM",str],["memoryMax","максимальная RAM",str],["javaPath","путь Java (пусто — автоматически)",{...str,optional:true}],["javaArgs","JVM-аргументы",{...str,maxLength:4000,optional:true}],
    ["useBmclapi","зеркало загрузки",bool],["showSnapshot","показывать снапшоты",bool],["showBeta","показывать бета-версии",bool],["showAlpha","показывать альфа-версии",bool],
    ["autoJoinServer","автовход на сервер",bool],["server","адрес сервера",{...str,optional:true}],["serverPort","порт сервера",num],["afterLaunch","действие после запуска",choice("nothing","minimize","close")],
    ["useCustomResolution","своё разрешение",bool],["customWidth","ширина окна",num],["customHeight","высота окна",num],["selectedResolution","пресет разрешения",str],["autoGameLanguage","автоматический язык игры",bool],
  ]
  for(const [key,label,field]of settings){
    const suffix=key.replace(/[A-Z]/g,c=>"_"+c.toLowerCase())
    add(`get_launcher_${suffix}`,`Прочитать настройку лаунчера: ${label}.`,"read",{},api=>api.getSetting(key),"settings")
    add(`set_launcher_${suffix}`,`Изменить настройку лаунчера: ${label}.`,"write",{value:field},(api,input)=>deps.call("set_setting",api,{key,value:String(input.value??"")}),"settings")
  }
  add("get_theme", "Полные параметры выбранной темы.","read",themeId,theme,"themes")
  add("create_theme", "Создать собственную тему на основе существующей. Возвращает ID; применять отдельно set_theme.","write",{name:str,baseThemeId:{...str,optional:true}},async(api,input)=>{const all=await themes(api),base=input.baseThemeId?await theme(api,{themeId:input.baseThemeId}):undefined;const created=createCustomTheme(text(input,"name"),base,all.map(item=>item.id));await api.setSetting("customThemes",serializeThemes([...all.filter(item=>item.custom),created]));return created},"themes")
  add("duplicate_theme", "Скопировать тему в пользовательскую.","write",{...themeId,name:str},async(api,input)=>{const all=await themes(api);const copy=duplicateTheme(await theme(api,input),text(input,"name"),all.map(item=>item.id));await api.setSetting("customThemes",serializeThemes([...all.filter(item=>item.custom),copy]));return copy},"themes")
  add("rename_theme", "Переименовать пользовательскую тему; пресет сначала копируется.","write",{...themeId,name:str},(api,input)=>editTheme(api,input,value=>({...value,name:text(input,"name")})),"themes")
  add("delete_theme", "Удалить пользовательскую тему. Всегда требует подтверждения.","delete",{themeId:str},async(api,input)=>{const all=await themes(api),selected=await theme(api,input);if(!selected.custom)throw new Error("Cannot delete a preset");if(await api.getSetting("theme")===selected.id)await api.setSetting("theme","orange");await api.setSetting("customThemes",serializeThemes(all.filter(item=>item.custom&&item.id!==selected.id)));return{success:true}},"themes")
  for(const key of THEME_COLOR_KEYS){
    const suffix=key.replace(/[A-Z]/g,c=>"_"+c.toLowerCase())
    add(`get_theme_${suffix}`,`Цвет темы: ${key}.`,"read",themeId,async(api,input)=>themePreviewColors(await theme(api,input))[key],"theme_colors")
    add(`set_theme_${suffix}`,`Задать цвет ${key} в HEX. Пресет копируется в собственную тему. Вернувшийся themeId используй для следующих правок.`,"write",{...themeId,color:str},async(api,input)=>{const color=normalizeHex(input.color);if(!color)throw new Error("Expected HEX color");return editTheme(api,input,value=>({...value,palette:{...value.palette,[key]:color},...(key==="primary"||key==="accent"?{[key]:color}:{})}))},"theme_colors")
  }
  add("set_theme_color_mode", "Светлый, тёмный или системный режим темы.","write",{...themeId,mode:choice("light","dark","system")},(api,input)=>editTheme(api,input,value=>({...value,appearance:{...value.appearance,colorMode:input.mode as "light"|"dark"|"system"}})),"themes")
  add("set_theme_radius", "Радиус скругления интерфейса темы (0–40 px).","write",{...themeId,radius:num},(api,input)=>editTheme(api,input,value=>({...value,appearance:{...value.appearance,radius:bounded(input.radius,0,40)}})),"themes")
  add("set_theme_font_size", "Размер шрифта темы (10–24 px).","write",{...themeId,size:num},(api,input)=>editTheme(api,input,value=>({...value,font:{...value.font,size:bounded(input.size,10,24)}})),"themes")
  add("set_theme_font_family", "Семейство шрифта пользовательской темы.","write",{...themeId,family:str},(api,input)=>editTheme(api,input,value=>({...value,font:{...value.font,family:text(input,"family")}})),"themes")
  add("set_theme_glow", "Цвет и прозрачность свечения темы; alphaPercent 0–100.","write",{...themeId,target:choice("primary","accent"),color:str,alphaPercent:num},async(api,input)=>{const color=normalizeHex(input.color);if(!color)throw new Error("Expected HEX color");return editTheme(api,input,value=>({...value,glow:{...value.glow,[text(input,"target")]:{color,alpha:bounded(input.alphaPercent,0,100)/100}}}))},"themes")
  add("get_build_theme", "Тема, назначенная сборке.","read",{buildId:str},async(api,input)=>{await deps.build(api,input);return safeMap(await api.getSetting("buildThemes"))[text(input,"buildId")]||null},"themes")
  add("set_build_theme", "Назначить существующую тему сборке.","write",{buildId:str,themeId:str},async(api,input)=>{await deps.build(api,input);const selected=await theme(api,input);await api.setSetting("buildThemes",JSON.stringify({...safeMap(await api.getSetting("buildThemes")),[text(input,"buildId")]:selected.id}));return{success:true}},"themes")
  add("clear_build_theme", "Убрать отдельную тему сборки и использовать общую.","write",{buildId:str},async(api,input)=>{await deps.build(api,input);const map=safeMap(await api.getSetting("buildThemes"));delete map[text(input,"buildId")];await api.setSetting("buildThemes",JSON.stringify(map));return{success:true}},"themes")

  const fields:Array<[string,Field,number?,number?]>=[["description",{...str,optional:true}],["group",{...str,optional:true}],["windowOverride",bool],["windowWidth",num,320,16384],["windowHeight",num,240,16384],["serverOverride",bool],["server",{...str,optional:true}],["serverPort",num,1,65535],["javaOverride",bool],["defaultAccountId",{...str,optional:true}]]
  for(const [key,field,min,max]of fields){const suffix=key.replace(/[A-Z]/g,c=>"_"+c.toLowerCase());add(`get_build_${suffix}`,`Прочитать параметр сборки ${key}.`,"read",{buildId:str},async(api,input)=>(await deps.build(api,input))[key as keyof DbBuildLight],"build_options");add(`set_build_${suffix}`,`Изменить параметр сборки ${key}.`,"write",{buildId:str,value:field},async(api,input)=>{const target=await deps.unlocked(api,input);let value=input.value??"";if(min!==undefined)value=bounded(value,min,max!);if(key==="serverPort")value=String(value);if(key==="defaultAccountId"&&value&&!(await api.loadAccounts()).some(item=>item.id===value))throw new Error("Account not found");await api.updateBuildFields(target.id,{[key]:value});return{success:true}},"build_options")}

  const serverId={serverId:str}
  const properties:Array<[string,Field,number?,number?]>=[["difficulty",choice("peaceful","easy","normal","hard")],["gamemode",choice("survival","creative","adventure","spectator")],["max-players",num,1,10000],["view-distance",num,2,32],["simulation-distance",num,2,32],["pvp",bool],["allow-flight",bool],["spawn-protection",num,0,1000],["white-list",bool],["enforce-whitelist",bool],["spawn-monsters",bool],["spawn-animals",bool],["generate-structures",bool],["hardcore",bool],["motd",str]]
  for(const[key,field,min,max]of properties){const suffix=key.replaceAll("-","_");add(`get_server_${suffix}`,`Прочитать server.properties: ${key}.`,"read",serverId,async(api,input)=>(await api.mcServerReadProperties(text(input,"serverId")))?.[key]??null,"server_settings");add(`set_server_${suffix}`,`Изменить server.properties: ${key}. Может требовать перезапуска сервера; автоматически не перезапускает.`,"write",{...serverId,value:field},async(api,input)=>{if(!await api.mcServerGet(text(input,"serverId")))throw new Error("Server not found");const value=min===undefined?input.value:bounded(input.value,min,max!);const old=await api.mcServerReadProperties(text(input,"serverId"));if(!old)throw new Error("server.properties not found");await api.mcServerWriteProperties(text(input,"serverId"),{...old,[key]:String(value)});return{success:true,restartMayBeRequired:true}},"server_settings")}
  add("get_server_details", "Параметры локального сервера без секретов и переменных окружения.","read",serverId,async(api,input)=>{const value=await api.mcServerGet(text(input,"serverId"));if(!value)throw new Error("Server not found");return Object.fromEntries(Object.entries(value).filter(([key])=>["id","name","gameVersion","modloader","modloaderVersion","port","xmx","xms","maxPlayers","onlineMode","createdAt"].includes(key)))},"servers")
  add("duplicate_server", "Копировать локальный сервер.","write",serverId,async(api,input)=>{const value=await api.mcServerDuplicate(text(input,"serverId"));return value?{id:value.id,name:value.name,success:true}:{success:false}},"servers")
  add("trash_server", "Переместить локальный сервер в корзину.","delete",serverId,async(api,input)=>{await api.mcServerDelete(text(input,"serverId"));return{success:true}},"servers")
  add("restore_server", "Восстановить локальный сервер из корзины.","write",serverId,async(api,input)=>{await api.mcServerRestore(text(input,"serverId"));return{success:true}},"servers")
  add("list_server_trash", "Список удалённых серверов без секретов.","read",{},async api=>(await api.mcServerListTrash()).map(({id,name,gameVersion})=>({id,name,gameVersion})),"servers")
  add("get_server_installation", "Текущий прогресс установки локального сервера.","read",serverId,(api,input)=>api.mcServerInstallState(text(input,"serverId")),"servers")
  add("get_server_addresses", "Локальный и внешний адреса выбранного игрового сервера.","read",serverId,(api,input)=>api.mcServerGetAddresses(text(input,"serverId")),"servers")
  add("list_server_whitelist", "Белый список игроков сервера.","read",serverId,(api,input)=>api.mcServerGetWhitelist(text(input,"serverId")),"servers")
  add("add_server_whitelist", "Добавить игрока в белый список.","write",{...serverId,username:str},async(api,input)=>{await api.mcServerAddWhitelist(text(input,"serverId"),text(input,"username"));return{success:true}},"servers")
  add("remove_server_whitelist", "Убрать игрока из белого списка.","delete",{...serverId,uuid:str},async(api,input)=>{await api.mcServerRemoveWhitelist(text(input,"serverId"),text(input,"uuid"));return{success:true}},"servers")
  add("list_server_bans", "Список заблокированных игроков сервера.","read",serverId,(api,input)=>api.mcServerGetBanned(text(input,"serverId")),"servers")
  add("ban_server_player", "Заблокировать игрока на сервере. Требует подтверждения.","sensitive",{...serverId,username:str},async(api,input)=>{await api.mcServerBanPlayer(text(input,"serverId"),text(input,"username"));return{success:true}},"servers")
  add("unban_server_player", "Снять блокировку игрока сервера.","write",{...serverId,uuid:str},async(api,input)=>{await api.mcServerUnbanPlayer(text(input,"serverId"),text(input,"uuid"));return{success:true}},"servers")
  add("list_server_operators", "Операторы сервера.","read",serverId,(api,input)=>api.mcServerGetOps(text(input,"serverId")),"servers")

  add("list_screenshots", "Скриншоты выбранной сборки без передачи изображений провайдеру.","read",{buildId:str},async(api,input)=>(await api.listScreenshots((await deps.build(api,input)).name)).map(({dataUrl,...item}:Record<string,unknown>)=>item),"worlds")
  add("rename_screenshot", "Переименовать скриншот.","write",{buildId:str,fileName:str,newName:str},async(api,input)=>api.renameScreenshot((await deps.build(api,input)).name,text(input,"fileName"),text(input,"newName")),"worlds")
  add("delete_screenshot", "Удалить скриншот с подтверждением.","delete",{buildId:str,fileName:str},async(api,input)=>api.deleteScreenshot((await deps.build(api,input)).name,text(input,"fileName")),"worlds")
  add("list_world_datapacks", "Датапаки выбранного мира.","read",{buildId:str,folder:str},async(api,input)=>api.listWorldDatapacks((await deps.build(api,input)).name,text(input,"folder")),"worlds")
  add("remove_world_datapack", "Удалить датапак мира с подтверждением.","delete",{buildId:str,folder:str,fileName:str},async(api,input)=>api.deleteWorldDatapack((await deps.unlocked(api,input)).name,text(input,"folder"),text(input,"fileName")),"worlds")
  add("reset_world_icon", "Сбросить значок мира.","write",{buildId:str,folder:str},async(api,input)=>api.resetWorldIcon((await deps.build(api,input)).name,text(input,"folder")),"worlds")
  add("get_quick_play", "Недавние миры и серверы сборки.","read",{buildId:str},async(api,input)=>api.quickPlayList((await deps.build(api,input)).name),"worlds")
  add("clear_quick_play", "Очистить историю быстрой игры сборки, не удаляя миры.","delete",{buildId:str},async(api,input)=>{await api.quickPlayClear((await deps.build(api,input)).name);return{success:true}},"worlds")
  add("get_cloud_quota", "Занятое и доступное место подключённого облака.","read",{providerId:str},(api,input)=>api.cloudGetQuota(text(input,"providerId")),"storage")
  add("get_instances_location", "Текущее расположение папки сборок.","read",{},api=>api.getInstancesRoot(),"storage")
}
