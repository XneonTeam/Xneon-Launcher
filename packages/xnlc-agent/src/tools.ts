import { getAgentHost } from "./host.js"
import { registerLauncherTools } from "./launcher-tools.js"
import { registerExtendedTools } from "./extended-tools.js"
import { recommendMinecraftVersions } from "./version-recommendations.js"
import type { AgentToolSpec, DbBuild, DbBuildLight, ElectronAPI, ModContentType, ModDetails, ModLoaderFilter, ModVersion, MinecraftLaunchParams } from "@xnlc/types"
import { loadLaunchSettings, normalizeJavaPath, resolveLaunchDimensions, saveLastLaunchedPrefs } from "./host.js"

type Input = Record<string, unknown>
export type Field = { type: "string" | "number" | "boolean" | "array"; items?: { type: "string"; maxLength: number }; minItems?: number; maxItems?: number; enum?: readonly string[]; description?: string; optional?: boolean; maxLength?: number }
export interface AgentTool {
  name: string
  risk: "read" | "write" | "delete" | "sensitive"
  group?: string
  fields: Record<string, Field>
  spec: AgentToolSpec
  run: (api: ElectronAPI, input: Input) => Promise<unknown>
}
const str: Field = { type: "string", maxLength: 300 }
const bool: Field = { type: "boolean" }
const num: Field = { type: "number" }
const optional = (field: Field): Field => ({ ...field, optional: true })
const choice = (...values: string[]): Field => ({ ...str, enum: values })
const buildId = { buildId: str }
const projectFields = { source: choice("modrinth", "curseforge", "ftb"), projectId: str }
const contentType = choice("mod", "resourcepack", "shader")
const loader = choice("vanilla", "fabric", "forge", "neoforge", "quilt", "liteloader", "optifine")
const text = (input: Input, key: string) => String(input[key] ?? "")
const number = (input: Input, key: string) => Number(input[key])
const tools: AgentTool[] = []

async function destination(api: ElectronAPI, name: string, excludeBuildId?: string) {
  if (!name || name.length > 150 || /[<>:"/\\|?*\u0000-\u001f]/.test(name) || name.startsWith(".")) throw new Error("Invalid build name")
  const result = await api.agentBuildDestination(name, excludeBuildId)
  if (!result.available) throw new Error("Build directory already belongs to another build or contains existing files")
  return result.path
}

function add(name: string, description: string, risk: AgentTool["risk"], fields: Record<string, Field>, run: AgentTool["run"], group?: string) {
  const properties = Object.fromEntries(Object.entries(fields).map(([key, { optional: _, ...field }]) => [key, field]))
  tools.push({ name, risk, fields, run, group, spec: { type: "function", function: { name, description, parameters: { type: "object", properties, required: Object.keys(fields).filter(key => !fields[key].optional), additionalProperties: false } } } })
}

export function parseToolInput(tool: AgentTool, value: string): Input {
  const input: unknown = JSON.parse(value)
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new Error("Tool arguments must be an object")
  const record = input as Input
  for (const key of Object.keys(record)) if (!Object.hasOwn(tool.fields, key)) throw new Error(`Unknown argument: ${key}`)
  for (const [key, field] of Object.entries(tool.fields)) {
    const item = record[key]
    if (item === undefined && field.optional) continue
    if (field.type === "array") {
      if (!Array.isArray(item) || item.length < (field.minItems ?? 0) || item.length > (field.maxItems ?? 6) || item.some(value => typeof value !== "string" || !value.trim() || value.length > (field.items?.maxLength ?? 160)) || new Set(item).size !== item.length) throw new Error(`Invalid options: ${key}`)
      continue
    }
    if (typeof item !== field.type) throw new Error(`Invalid argument: ${key}`)
    if (typeof item === "string" && (!item.trim() && !field.optional || item.length > (field.maxLength ?? 300))) throw new Error(`Invalid string: ${key}`)
    if (typeof item === "number" && (!Number.isFinite(item) || !Number.isInteger(item))) throw new Error(`Invalid number: ${key}`)
    if (field.enum && !field.enum.includes(String(item))) throw new Error(`Invalid choice: ${key}`)
  }
  return record
}

async function build(api: ElectronAPI, input: Input): Promise<DbBuildLight> {
  const result = (await api.loadBuildsLight()).find(item => item.id === input.buildId)
  if (!result) throw new Error("Build not found; call list_builds first")
  return result
}
async function unlocked(api: ElectronAPI, input: Input) {
  const target = await build(api, input)
  if (target.locked === true || ["modrinth", "curseforge"].includes(target.source) && target.locked !== false) throw new Error(`BUILD_LOCKED: ${target.id} (${target.name}). Call unlock_build with this buildId; it will ask the user interactively. If declined, stop changing this build.`)
  return target
}
export async function getAgentProject(api: ElectronAPI, source: string, id: string): Promise<ModDetails> {
  if (source === "curseforge" && (!/^\d+$/.test(id) || Number(id) <= 0)) throw new Error("CurseForge requires a numeric project ID")
  if (source === "ftb" && (!/^\d+$/.test(id) || Number(id) <= 0)) throw new Error("FTB requires a numeric project ID")
  const project = source === "ftb" ? await api.modsFtbDetails(Number(id)) : source === "curseforge" ? await api.modsCurseforgeDetails(Number(id)) : await api.modsModrinthDetails(id)
  if (!project) throw new Error("Project not found")
  return project
}
function compatible(version: ModVersion, target: Pick<DbBuildLight, "version" | "modLoader">, kind: string) {
  const versions = version.gameVersion.split(/[,\s]+/)
  return versions.includes(target.version) && (kind !== "mod" || !version.loaders?.length || version.loaders.map(value => value.toLowerCase()).includes(target.modLoader.toLowerCase()))
}
async function syncContent(api: ElectronAPI, target: DbBuildLight) {
  const scanned = await api.scanBuildIntentContent(target.name)
  await api.updateBuildFields(target.id, scanned)
  return scanned
}
async function account(api: ElectronAPI, id?: string) {
  const accounts = await api.loadAccounts()
  const result = id ? accounts.find(item => item.id === id) : accounts.find(item => item.isActive)
  if (!result) throw new Error("Select an account in the launcher first")
  return result
}
const settingsKeys = ["language", "theme", "memoryMin", "memoryMax", "javaPath", "javaArgs", "useBmclapi", "showSnapshot", "showBeta", "showAlpha", "autoJoinServer", "server", "serverPort", "afterLaunch", "useCustomResolution", "customWidth", "customHeight", "selectedResolution", "autoGameLanguage"]

add("list_builds", "Список сборок: ID, имя, Minecraft, загрузчик, настройки и количество модов.", "read", {}, async api => (await api.loadBuildsLight()).map(({ icon, coverImage, customEnv, ...item }) => ({ ...item, locked: item.locked === true || ["modrinth", "curseforge"].includes(item.source) && item.locked !== false })))
add("get_build", "Актуальное содержимое и настройки сборки; перед изменениями вызови этот инструмент.", "read", buildId, async (api, input) => {
  const target = await build(api, input)
  return { ...target, locked: target.locked === true || ["modrinth", "curseforge"].includes(target.source) && target.locked !== false, icon: undefined, coverImage: undefined, customEnv: undefined, content: await api.scanBuildIntentContent(target.name) }
})
add("list_minecraft_versions", "Получить актуальный список доступных версий Minecraft. Проверяй его до утверждений, что версия существует или не существует. reason — необязательное пояснение цели проверки; на список не влияет.", "read", { reason: optional({ ...str, maxLength: 1000, description: "Цель проверки версий; необязательное пояснение." }) }, api => api.getMinecraftVersions())
add("recommend_minecraft_versions", "Перед вопросом о версии для новой сборки: получить актуальные стабильные Minecraft, найти поддерживаемые версии в выборке популярных модпаков Modrinth/CurseForge и проверить наличие загрузчиков. Это покрытие выборки, не точная популярность версий. query — тема модпака, loader — уже выбранный загрузчик. При нехватке данных не выдумывай варианты.", "read", { query: optional(str), loader: optional(choice("fabric", "forge", "neoforge", "quilt")) }, (api, input) => recommendMinecraftVersions(api, text(input, "query"), input.loader as ModLoaderFilter | undefined))
add("list_loader_versions", "Версии загрузчика для Minecraft.", "read", { version: str, loader }, async (api, input) => {
  const v = text(input, "version")
  switch (input.loader) {
    case "fabric": return api.getFabricVersions(v)
    case "forge": return api.getForgeVersions(v)
    case "neoforge": return api.getNeoForgeVersions(v)
    case "quilt": return api.getQuiltVersions(v)
    case "liteloader": return api.getLiteLoaderVersions(v)
    case "optifine": return api.getOptifineVersions(v)
    default: return []
  }
})
add("create_build", "Создать сборку. Сначала проверь версии Minecraft и загрузчика. Для модового загрузчика укажи loaderVersion.", "write", { name: str, version: str, loader, loaderVersion: optional(str), description: optional(str) }, async (api, input) => {
  const name = text(input, "name").trim()
  if ((await api.loadBuildsLight()).some(item => item.name.toLowerCase() === name.toLowerCase())) throw new Error("Build name already exists")
  if (!(await api.getMinecraftVersions()).some(item => item.version === input.version)) throw new Error("Unknown Minecraft version")
  if (input.loader !== "vanilla" && !input.loaderVersion) throw new Error("A loader version is required")
  if (input.loader !== "vanilla") {
    const available = await tools.find(tool => tool.name === "list_loader_versions")!.run(api, input)
    if (!Array.isArray(available) || !available.some(item => item.version === input.loaderVersion || item.filename === input.loaderVersion)) throw new Error("Unknown loader version for this Minecraft version")
  }
  const intentPath = await destination(api, name)
  await api.setBuildIntentPath(name, intentPath)
  const item: DbBuild = { id: crypto.randomUUID(), name, description: text(input, "description"), version: text(input, "version"), modLoader: text(input, "loader"), loaderVersion: text(input, "loaderVersion") || undefined, icon: "", mods: [], resourcepacks: [], shaders: [], installedMods: {}, playtime: 0, source: "local", createdAt: new Date().toISOString(), intentPath }
  await api.insertBuild(item)
  return { id: item.id, name, version: item.version, modLoader: item.modLoader }
})
add("copy_build", "Создать копию сборки со всем содержимым.", "write", { ...buildId, name: str }, async (api, input) => {
  const target = await build(api, input), name = text(input, "name").trim()
  if ((await api.loadBuildsLight()).some(item => item.name.toLowerCase() === name.toLowerCase())) throw new Error("Build name already exists")
  await destination(api, name)
  const result = await api.copyBuild(target.name, name)
  if (!result.success) throw new Error(result.error || "Copy failed")
  const item: DbBuild = { ...target, id: crypto.randomUUID(), name, mods: [], resourcepacks: [], shaders: [], playtime: 0, createdAt: new Date().toISOString(), intentPath: result.intentPath }
  await api.insertBuild(item)
  await syncContent(api, { ...item, modsCount: 0, resourcepacksCount: 0, shadersCount: 0 })
  return { id: item.id, name }
})
add("rename_build", "Переименовать сборку и её папку.", "write", { ...buildId, name: str }, async (api, input) => {
  const target = await build(api, input), name = text(input, "name").trim()
  if (name === target.name) return { success: true }
  await destination(api, name, target.id)
  const result = await api.renameBuildIntent(target.name, name)
  if (!result.success) return result
  await api.updateBuildFields(target.id, { name, intentPath: result.intentPath || await api.getBuildIntentPath(name) })
  return { success: true, id: target.id, name }
})
add("set_build_version", "Изменить Minecraft и загрузчик сборки. Сначала проверь установленные моды: они не заменяются автоматически.", "write", { ...buildId, version: str, loader, loaderVersion: optional(str) }, async (api, input) => {
  const target = await unlocked(api, input)
  if (!(await api.getMinecraftVersions()).some(item => item.version === input.version)) throw new Error("Unknown Minecraft version")
  if (input.loader !== "vanilla") {
    const available = await tools.find(tool => tool.name === "list_loader_versions")!.run(api, input)
    if (!input.loaderVersion || !Array.isArray(available) || !available.some(item => item.version === input.loaderVersion || item.filename === input.loaderVersion)) throw new Error("Unknown loader version for this Minecraft version")
  }
  await api.updateBuildFields(target.id, { version: text(input, "version"), modLoader: text(input, "loader"), loaderVersion: input.loader === "vanilla" ? "" : text(input, "loaderVersion") })
  return { success: true, profiles: await api.pruneLoaderProfiles(target.name, text(input, "loader"), text(input, "loaderVersion") || undefined), warning: "Installed mods were preserved. Check their compatibility before launching." }
})
add("trash_build", "Переместить сборку в корзину. Требует отдельного подтверждения.", "delete", buildId, async (api, input) => {
  const target = await build(api, input)
  const content = await api.loadBuildContent(target.id)
  return api.moveBuildIntentToTrash(target.name, { ...target, ...content })
})
add("set_build_memory", "Изменить RAM сборки в MiB (256–131072).", "write", { ...buildId, minMiB: num, maxMiB: num }, async (api, input) => {
  const target = await build(api, input), min = number(input, "minMiB"), max = number(input, "maxMiB")
  const total = await api.getTotalMemory()
  if (min < 256 || max < min || max > 131072 || max * 1024 * 1024 > total) throw new Error("Invalid memory range or exceeds system RAM")
  await api.updateBuildFields(target.id, { javaOverride: true, memoryMin: `${min}M`, memoryMax: `${max}M` })
  return { success: true, minMiB: min, maxMiB: max }
})
add("set_build_options", "Изменить описание, группу, JVM-аргументы или Java сборки. Не выполняет shell-команды.", "write", { ...buildId, description: optional(str), group: optional(str), javaArgs: optional({ ...str, maxLength: 4000 }), javaPath: optional(str) }, async (api, input) => {
  const target = await build(api, input)
  const fields = Object.fromEntries(Object.entries(input).filter(([key]) => key !== "buildId"))
  if (input.javaArgs !== undefined || input.javaPath !== undefined) fields.javaOverride = true
  await api.updateBuildFields(target.id, fields)
  return { success: true }
})
add("launch_build", "Запустить сборку с её настройками и выбранным аккаунтом. Можно указать мир или адрес сервера.", "write", { ...buildId, accountId: optional(str), world: optional(str), server: optional(str) }, async (api, input) => {
  const target = await build(api, input)
  const selected = await account(api, text(input, "accountId") || target.defaultAccountId)
  const settings = await loadLaunchSettings()
  const dimensions = target.windowOverride && target.windowWidth && target.windowHeight ? { width: target.windowWidth, height: target.windowHeight } : resolveLaunchDimensions(settings)
  const useJava = target.javaOverride
  const server = text(input, "server") || (target.serverOverride ? target.server : settings.savedAutoJoinServer === "true" ? settings.savedServer : "")
  const usesSkinInjector = selected.type === "elyby" || selected.type === "xnskins"
  const result = await api.launchMinecraft({
    version: target.version, modLoader: target.modLoader as MinecraftLaunchParams["modLoader"], loaderVersion: target.loaderVersion,
    account: { type: selected.type, username: selected.username, uuid: selected.uuid, serverId: selected.serverId },
    memory: { min: useJava && target.memoryMin ? target.memoryMin : settings.savedMemoryMin || "512M", max: useJava && target.memoryMax ? target.memoryMax : settings.savedMemoryMax || "4G" },
    javaPath: normalizeJavaPath(useJava && target.javaPath ? target.javaPath : await api.getSetting("javaPath")), javaArgs: useJava ? target.javaArgs : settings.savedJavaArgs,
    ...dimensions, buildName: target.name, buildId: target.id, gameDirectory: await api.getBuildIntentPath(target.name),
    authlibInjectorEnabled: usesSkinInjector && settings.authlibEnabled !== "false", retroauthInjectorEnabled: usesSkinInjector,
    ...(input.world ? { quickPlaySingleplayer: text(input, "world") } : server ? { quickPlayMultiplayer: server.includes(":") ? server : `${server}:${target.serverOverride ? target.serverPort || "25565" : settings.savedServerPort || "25565"}` } : {}),
    preLaunchCommand: target.preLaunchCommand, postLaunchCommand: target.postLaunchCommand, wrapperCommand: target.wrapperCommand,
    customEnv: Object.fromEntries((target.customEnv || "").split(/\r?\n/).filter(line => line.includes("=") && !line.startsWith("#")).map(line => [line.slice(0, line.indexOf("=")).trim(), line.slice(line.indexOf("=") + 1)])),
  })
  if (result.success) saveLastLaunchedPrefs(target.name, "instance")
  getAgentHost().emit("launcher:agent-launch", { success: result.success })
  return result
})
add("stop_game", "Остановить Minecraft.", "write", {}, api => api.stopMinecraft().then(() => ({ success: true })))
add("game_status", "Запущен ли Minecraft.", "read", {}, async api => ({ running: await api.isMinecraftRunning() }))
add("search_projects", "Поиск в Modrinth, CurseForge или FTB. FTB содержит только модпаки: укажи type=modpack. Фильтруй по Minecraft и загрузчику.", "read", { source: choice("modrinth", "curseforge", "ftb"), query: str, type: choice("mod", "modpack", "resourcepack", "shader", "datapack", "plugin", "world"), version: optional(str), loader: optional(choice("vanilla", "fabric", "forge", "neoforge", "quilt")), page: optional(num) }, async (api, input) => {
  if (input.source === "ftb") { if (input.type !== "modpack") throw new Error("FTB only supports modpacks"); const result = await api.modsFtbSearch(text(input, "query"), Math.max(0, Math.min(100, number(input, "page") || 0)), { gameVersion: text(input,"version") || undefined, loader: text(input,"loader") || undefined }); return { ...result, results: result.results.slice(0,10).map(project => ({ ...project, source: "ftb", contentType: "modpack" })) } }
  const args = [text(input, "query"), input.type as ModContentType, text(input, "version") || undefined, (text(input, "loader") || undefined) as ModLoaderFilter | undefined, "relevance" as const, Math.max(0, Math.min(100, number(input, "page") || 0))] as const
  const result = input.source === "curseforge" ? await api.modsCurseforgeSearch(...args) : await api.modsModrinthSearch(...args)
  return { ...result, results: result.results.slice(0, 10).map(project => ({ ...project, contentType: input.type })) }
})
add("get_project", "Карточка проекта и его версии. projectId — slug/ID Modrinth или числовой ID CurseForge/FTB.", "read", projectFields, async (api, input) => {
  const result = await getAgentProject(api, text(input, "source"), text(input, "projectId"))
  return { ...result, contentType: input.source === "ftb" ? "modpack" : undefined, description: result.description.slice(0, 8000), body: undefined, gallery: [], versions: result.versions.slice(0, 10).map(({ changelog, ...version }) => version) }
})
add("get_project_versions", "Совместимые версии проекта. Для существующей сборки передай buildId. ДО создания сборки передай version (Minecraft) и loader: так проверяй ключевые моды при выборе версии. ID проекта сначала получи из каталога.", "read", { ...projectFields, buildId: optional(str), version: optional(str), loader: optional(loader), type: contentType }, async (api, input) => {
  if (!input.buildId && (!input.version || !input.loader)) throw new Error("Provide buildId or both version and loader")
  if (!input.buildId && !(await api.getMinecraftVersions()).some(item => item.version === input.version)) throw new Error("Unknown Minecraft version")
  const target = input.buildId ? await build(api, input) : { version: text(input, "version"), modLoader: text(input, "loader") }
  const project = await getAgentProject(api, text(input, "source"), text(input, "projectId"))
  const versions = input.source === "modrinth" ? await api.modsModrinthVersions(project.id) : project.versions
  return versions.filter(version => compatible(version, target, text(input, "type"))).slice(0, 30)
})
add("install_content", "Установить или обновить выбранную совместимую версию проекта в сборке. URL берётся только из каталога. Обязательные зависимости возвращаются для последующей установки.", "write", { ...projectFields, ...buildId, versionId: str, type: contentType }, async (api, input) => {
  if (input.source === "ftb") throw new Error("Use install_modpack for FTB projects")
  const target = await unlocked(api, input), source = input.source as "modrinth" | "curseforge"
  const project = await getAgentProject(api, source, text(input, "projectId"))
  const versions = source === "modrinth" ? await api.modsModrinthVersions(project.id) : project.versions
  const selected = versions.find(version => version.id === input.versionId)
  if (!selected || !compatible(selected, target, text(input, "type"))) throw new Error("Version is not compatible with this build")
  const dependencies = await api.modsResolveDependencies(selected, source)
  const url = source === "curseforge" ? await api.modsCurseforgeDownloadUrl(Number(selected.id), Number(project.id)) : selected.files?.[0]?.url || selected.downloadUrl
  if (!url) throw new Error("The provider does not permit downloading this file")
  const fileName = selected.files?.[0]?.filename || selected.fileName
  if (!fileName || /[/\\:]/.test(fileName)) throw new Error("Invalid catalog filename")
  const previous = await api.scanBuildIntentContent(target.name)
  const key = input.type === "mod" ? "mods" : input.type === "shader" ? "shaders" : "resourcepacks"
  const oldFiles = previous[key].filter(item => item.source === source && (item.projectId === project.id || item.modId === Number(project.id)))
  const saved = await api.saveContentToIntent(target.name, input.type as "mod" | "resourcepack" | "shader", url, fileName)
  if (!saved) throw new Error("Download failed")
  // Старую версию удаляем только после удачной загрузки новой.
  for (const old of oldFiles) if (old.slug !== fileName) {
    const removed = await api.deleteContentFromIntent(target.name, input.type as "mod" | "resourcepack" | "shader", old.slug)
    if (!removed.success) throw new Error(removed.error || "New file installed, but the old version could not be removed")
  }
  const scanned = await syncContent(api, target)
  const entry = { id: crypto.randomUUID(), slug: fileName, name: project.name, description: project.summary, icon_url: project.iconUrl, source, projectId: project.id, modId: source === "curseforge" ? Number(project.id) : undefined, version: selected.versionNumber || selected.name, enabled: true }
  await api.updateBuildFields(target.id, { [key]: [...scanned[key].filter(item => item.slug !== fileName), entry] })
  return { success: true, fileName, requiredDependencies: dependencies.filter(item => item.dependencyType === "required"), instruction: "Install missing required dependencies before launching." }
})
add("remove_content", "Удалить файл мода, ресурспака или шейдера. Требует подтверждения.", "delete", { ...buildId, type: contentType, fileName: str }, async (api, input) => {
  const target = await unlocked(api, input)
  const result = await api.deleteContentFromIntent(target.name, input.type as "mod" | "resourcepack" | "shader", text(input, "fileName"))
  if (result.success) await syncContent(api, target)
  return result
})
add("toggle_content", "Включить или отключить установленный мод, ресурс или шейдер.", "write", { ...buildId, type: contentType, fileName: str, enabled: bool }, async (api, input) => {
  const target = await unlocked(api, input)
  const result = await api.setContentEnabled(target.name, input.type as "mod" | "resourcepack" | "shader", text(input, "fileName"), input.enabled === true)
  if (result.success) await syncContent(api, target)
  return result
})
add("check_updates", "Проверить обновления модов, ресурсов и шейдеров сборки.", "read", buildId, async (api, input) => api.checkBuildContentUpdates((await build(api, input)).id))
add("check_loader_requirements", "Проверить требования установленных модов к загрузчику.", "read", buildId, async (api, input) => { const target = await build(api, input); return api.checkBuildLoaderRequirements(target.name, target.modLoader, target.loaderVersion) })
add("install_modpack", "Установить модпак отдельной новой сборкой. ID проекта и версии сначала получи из каталога.", "write", { ...projectFields, name: str, versionId: str }, async (api, input) => {
  const name = text(input, "name").trim()
  const project = await getAgentProject(api, text(input, "source"), text(input, "projectId"))
  await destination(api, name)
  const result = input.source === "ftb" ? await api.importFtbModpack(name, Number(input.projectId), Number(String(input.versionId).replace(/^ftb-/, ""))) : input.source === "modrinth" ? await api.importModrinthModpack(name, text(input, "projectId"), text(input, "versionId")) : await api.importCurseforgeModpack(name, Number(input.projectId), Number(input.versionId))
  if (!result.success || !result.version) return result
  const item: DbBuild = { id: crypto.randomUUID(), name, description: project.summary, version: result.version, modLoader: result.modLoader || "vanilla", loaderVersion: result.loaderVersion, icon: project.iconUrl, mods: [], resourcepacks: [], shaders: [], createdAt: new Date().toISOString(), source: input.source as "modrinth" | "curseforge" | "ftb", projectSlug: project.slug, modId: input.source !== "modrinth" ? Number(project.id) : undefined, fileId: input.source !== "modrinth" ? Number(String(input.versionId).replace(/^ftb-/, "")) : undefined, modpackVersion: result.modpackVersion, modpackVersionId: result.modpackVersionId || text(input, "versionId"), locked: true, intentPath: await api.getBuildIntentPath(name), installedMods: result.installedMods || {}, playtime: 0 }
  await api.insertBuild(item)
  await syncContent(api, { ...item, modsCount: 0, resourcepacksCount: 0, shadersCount: 0 })
  return { success: true, id: item.id, name, version: item.version, loader: item.modLoader }
})
add("list_worlds", "Миры сборки.", "read", buildId, async (api, input) => (await api.listWorlds((await build(api, input)).name)).map(({ iconDataUrl, ...item }) => item))
add("copy_world", "Создать резервную копию мира в сборке.", "write", { ...buildId, folder: str, name: str }, async (api, input) => api.copyWorld((await build(api, input)).name, text(input, "folder"), text(input, "name")))
add("rename_world", "Изменить название мира.", "write", { ...buildId, folder: str, name: str }, async (api, input) => api.renameWorld((await build(api, input)).name, text(input, "folder"), text(input, "name")))
add("delete_world", "Удалить мир. Требует отдельного подтверждения.", "delete", { ...buildId, folder: str }, async (api, input) => api.deleteWorld((await build(api, input)).name, text(input, "folder")))
add("read_build_file", "Прочитать текст конфигурации, options.txt, лог или crash-report сборки (до 128 КБ с конца).", "read", { ...buildId, path: str }, (api, input) => api.agentBuildFile({ buildId: text(input, "buildId"), path: text(input, "path"), operation: "read" }))
add("list_build_files", "Список файлов в config/, logs/ или crash-reports/ сборки.", "read", { ...buildId, path: str }, (api, input) => api.agentBuildFile({ buildId: text(input, "buildId"), path: text(input, "path"), operation: "list" }))
add("write_build_config", "Заменить текст конфигурации в config/ или options.txt. Сначала прочитай файл. Перед записью сохраняется резервная копия.", "write", { ...buildId, path: str, content: { ...str, maxLength: 128000 } }, async (api, input) => { await unlocked(api, input); return api.agentBuildFile({ buildId: text(input, "buildId"), path: text(input, "path"), operation: "write", content: text(input, "content") }) })
add("read_settings", "Настройки лаунчера без ключей, токенов и паролей.", "read", {}, async api => Object.fromEntries(await Promise.all(settingsKeys.map(async key => [key, await api.getSetting(key)]))))
add("set_setting", "Изменить настройку лаунчера из разрешённого списка.", "write", { key: choice(...settingsKeys), value: { ...str, maxLength: 4000, optional: true } }, async (api, input) => {
  const key = text(input, "key"), value = text(input, "value")
  if (!settingsKeys.includes(key)) throw new Error("Setting is not accessible to the agent")
  if (["memoryMin", "memoryMax"].includes(key)) {
    if (!/^\d+[MG]$/i.test(value)) throw new Error("Memory must be specified as 512M or 4G")
    const toMiB = (item: string) => parseInt(item, 10) * (/G$/i.test(item) ? 1024 : 1)
    const size = toMiB(value), other = await api.getSetting(key === "memoryMin" ? "memoryMax" : "memoryMin")
    if (size < 256 || size * 1024**2 > await api.getTotalMemory() || other && (key === "memoryMin" ? size > toMiB(other) : size < toMiB(other))) throw new Error("Invalid memory range")
  }
  if (["useBmclapi", "showSnapshot", "showBeta", "showAlpha", "autoJoinServer", "useCustomResolution", "autoGameLanguage"].includes(key) && !["true", "false"].includes(value)) throw new Error("Expected true or false")
  if (key === "language" && !["ru", "en", "uk", "de", "es"].includes(value)) throw new Error("Unsupported language")
  if (key === "afterLaunch" && !["nothing", "minimize", "close"].includes(value)) throw new Error("Invalid afterLaunch action")
  if (["customWidth", "customHeight", "serverPort"].includes(key) && (!/^\d+$/.test(value) || Number(value) < 1 || Number(value) > (key === "serverPort" ? 65535 : 16384))) throw new Error("Invalid numeric setting")
  if (key === "theme") {
    if (!value) throw new Error("Select a theme ID")
    await tools.find(tool => tool.name === "get_theme")!.run(api, { themeId: value })
  }
  if (key === "selectedResolution") {
    const match = /^(\d{3,5})x(\d{3,5})(?: \([^\n]{1,50}\))?$/.exec(value)
    if (!match || Number(match[1]) > 16384 || Number(match[2]) > 16384) throw new Error("Invalid resolution")
  }
  if (key === "javaPath" && value && !/(?:^|[\\/])java(?:w)?(?:\.exe)?$/i.test(value)) throw new Error("Select a Java executable")
  await api.setSetting(key, value)
  return { success: true }
})
add("system_info", "Полные характеристики ПК (CPU, GPU, RAM, ОС, экраны, диск), найденные Java и состояние игры. Перед настройкой получи эти данные.", "read", {}, async api => ({ hardware: await api.agentHardware(), totalMemoryBytes: await api.getTotalMemory(), java: await api.detectJavaInstallations(), running: await api.isMinecraftRunning() }))
add("storage_usage", "Использование диска сборками, серверами и кэшем.", "read", {}, api => api.scanStorage())
add("list_accounts", "ID, имена и типы аккаунтов. Секреты не возвращаются.", "read", {}, async api => (await api.loadAccounts()).map(({ id, username, type, isActive }) => ({ id, username, type, isActive })))
add("list_servers", "Локальные серверы лаунчера.", "read", {}, async api => (await api.mcServerList()).map(({ id, name, gameVersion, modloader, port }) => ({ id, name, gameVersion, modloader, port })))
add("server_status", "Состояние локального сервера.", "read", { serverId: str }, (api, input) => api.mcServerStatus(text(input, "serverId")))
add("server_logs", "Последние 500 строк консоли локального сервера.", "read", { serverId: str }, async (api, input) => (await api.mcServerLogs(text(input, "serverId"))).slice(-500))
add("start_server", "Запустить локальный сервер.", "write", { serverId: str }, async (api, input) => { await api.mcServerStart(text(input, "serverId")); return { success: true } })
add("stop_server", "Остановить локальный сервер.", "write", { serverId: str }, async (api, input) => { await api.mcServerStop(text(input, "serverId")); return { success: true } })
add("server_command", "Отправить команду в консоль сервера. Всегда требует отдельного подтверждения.", "sensitive", { serverId: str, command: str }, async (api, input) => { await api.mcServerSendCommand(text(input, "serverId"), text(input, "command")); return { success: true } })
add("create_server", "Создать локальный сервер Minecraft.", "write", { name: str, version: str, loader: optional(str), loaderVersion: optional(str), port: optional(num) }, (api, input) => api.mcServerCreate({ name: text(input, "name"), gameVersion: text(input, "version"), modloader: text(input, "loader") || undefined, modloaderVersion: text(input, "loaderVersion") || undefined, port: number(input, "port") || 25565 }))
add("read_server_properties", "Прочитать server.properties локального сервера.", "read", { serverId: str }, (api, input) => api.mcServerReadProperties(text(input, "serverId")))
add("set_server_property", "Изменить одно свойство server.properties.", "write", { serverId: str, key: str, value: str }, async (api, input) => {
  const properties = await api.mcServerReadProperties(text(input, "serverId"))
  if (!properties) throw new Error("Server properties not found")
  await api.mcServerWriteProperties(text(input, "serverId"), { ...properties, [text(input, "key")]: text(input, "value") })
  return { success: true }
})
add("list_skins", "Избранные скины аккаунта.", "read", { accountId: optional(str) }, async (api, input) => api.skinsListLibrary((await account(api, text(input, "accountId") || undefined)).id))
add("find_player_skins", "Скины игрока Laby по точному нику.", "read", { username: str }, (api, input) => api.labyPlayer(text(input, "username")))
add("apply_skin", "Надеть скин из избранного.", "write", { skinId: str, accountId: optional(str) }, async (api, input) => ({ success: await api.skinsApplyLibrarySkin(text(input, "skinId"), (await account(api, text(input, "accountId") || undefined)).id) }))
add("apply_laby_skin", "Надеть скин Laby по hash из результата поиска.", "write", { hash: str, accountId: optional(str), slim: optional(bool) }, async (api, input) => api.labyApply(text(input, "hash"), (await account(api, text(input, "accountId") || undefined)).id, undefined, input.slim === true))
add("skin_catalog", "Каталог скинов Laby. Страницы с 0. Фильтр по тексту локальный, ник ищи через find_player_skins.", "read", { query: optional(str), page: optional(num) }, (api, input) => api.labyCatalog(Math.max(0, number(input, "page") || 0), 20, "trending_24h", undefined, text(input, "query") || undefined))
add("list_game_servers", "Сохранённые адреса серверов в servers.dat сборки.", "read", buildId, async (api, input) => api.listServers((await build(api, input)).name))
add("add_game_server", "Добавить адрес сервера в servers.dat сборки, сохранив остальные адреса.", "write", { ...buildId, name: str, address: str }, async (api, input) => {
  const target = await build(api, input), servers = await api.listServers(target.name)
  const address = text(input, "address").trim()
  if (/\s|[\/\\]/.test(address)) throw new Error("Invalid Minecraft server address")
  if (servers.some(server => server.ip.toLowerCase() === address.toLowerCase())) return { success: true, alreadyExists: true }
  return api.writeServersDat(target.name, [...servers, { name: text(input, "name"), ip: address }])
})
add("list_cloud_storage", "Подключённые облачные хранилища и свободное место. Ключи подключения не возвращаются.", "read", {}, async api => {
  const providers = await api.cloudListProviders()
  return Promise.all(providers.map(async provider => {
    const connected = await api.cloudIsConnected(provider.id)
    return { ...provider, connected, quota: connected ? await api.cloudGetQuota(provider.id) : null }
  }))
})
add("list_cloud_files", "Список файлов подключённого облачного хранилища.", "read", { providerId: str, folder: optional(str) }, (api, input) => api.cloudListFiles(text(input, "providerId"), text(input, "folder") || undefined))
add("upload_build_backup", "Загрузить резервную копию сборки в подключённое облако. Всегда требует подтверждения передачи файлов. includeWorlds добавляет миры.", "sensitive", { ...buildId, providerId: str, includeWorlds: optional(bool) }, async (api, input) => {
  const target = await build(api, input)
  if (!await api.cloudIsConnected(text(input, "providerId"))) throw new Error("Connect the cloud provider in the launcher first")
  return api.cloudUploadBuild(text(input, "providerId"), target.name, undefined, ["mods", "resourcepacks", "shaderpacks", "data", ...(input.includeWorlds ? ["saves" as const] : [])])
})
add("get_statistics", "Статистика запусков, времени игры, сборок и серверов.", "read", {}, api => api.getStatsOverview())

add("update_plan", "Создать или обновить видимый пользователю план сложной задачи. Передай полный список этапов steps по порядку и число уже завершённых начальных этапов completedSteps (0 для нового плана, длина steps для завершённого). Следующий этап считается текущим. Обновляй после фактического выполнения этапа; при изменении состава плана поясни причину в explanation. Инструмент только показывает план, действий со сборкой не выполняет.", "read", {
  steps: { type: "array", items: { type: "string", maxLength: 200 }, minItems: 1, maxItems: 16 },
  completedSteps: num,
  explanation: optional({ ...str, maxLength: 1000 }),
}, async (_api, input) => {
  const steps = input.steps as string[]
  const completedSteps = number(input, "completedSteps")
  if (completedSteps < 0 || completedSteps > steps.length) throw new Error("Completed steps must be between zero and the plan length")
  return { steps, completedSteps, explanation: text(input, "explanation") }
})
add("ask_user", "Задать пользователю интерактивный уточняющий вопрос и дождаться ответа. Используй для выбора сборки, версии Minecraft, загрузчика, предпочтений и недостающих данных. options — от 2 до 6 коротких вариантов; пользователь всегда может написать свой ответ. Без options — свободный ввод. Не используй для подтверждения действий: подтверждения обрабатываются отдельно.", "read", { question: { type: "string", maxLength: 1200 }, options: { type: "array", items: { type: "string", maxLength: 160 }, minItems: 2, maxItems: 6, optional: true } }, async () => { throw new Error("ask_user must be handled by the interactive agent runtime") })

registerExtendedTools(add, { build, unlocked, call: (name, api, input) => {
  const tool = tools.find(item => item.name === name)
  if (!tool) throw new Error("Unknown tool")
  return tool.run(api, parseToolInput(tool, JSON.stringify(input)))
} })
registerLauncherTools(add)
const toolGroups: Record<string, string> = {
  builds: "Создание, копирование, запуск, параметры и блокировка сборок",
  versions: "Версии Minecraft, рекомендации версии и доступные загрузчики",
  content: "Поиск проектов, совместимые файлы, установка модов и модпаков, зависимости и обновления",
  build_files: "Чтение логов, списка файлов и изменение конфигураций сборки",
  skins: "Каталог скинов, поиск по игроку и надевание скина",
  multiplayer: "Список игровых серверов сборки и добавление адреса",
  accounts: "Список аккаунтов без секретов",
  cloud: "Облачные файлы и резервное копирование сборок",
  statistics: "Статистика игры и запусков",
  news: "Новости Minecraft и лаунчера",
  launcher: "Прочие действия лаунчера",
  ftb: "Каталог FTB, все версии модпаков и списки изменений",
  launcher_ipc: "Полный мост лаунчера: вызовы всех IPC-функций, события, системные диалоги, окна, обновления и интеграции",
  hardware: "Диагностика CPU, GPU, RAM, ОС, экранов, диска и Java",
  settings: "Точные параметры лаунчера: RAM, Java, язык игры, загрузки, версии, разрешение и автоподключение",
  themes: "Создание, копирование, оформление, свечение, шрифт и назначение тем сборкам",
  theme_colors: "Все 20 цветов темы: поверхности, текст, акценты, границы и боковая панель",
  build_options: "Индивидуальные параметры сборки: окно, Java, группа, сервер, аккаунт",
  server_settings: "Настройки server.properties: сложность, режим, лимиты игроков, дальность, PvP и другие",
  servers: "Локальные серверы: подробности, копии, корзина, белый список и блокировки игроков",
  worlds: "Миры, датапаки, скриншоты и история быстрой игры",
  storage: "Расположение сборок и объём облачного хранилища",
}
// На старте передаём только навигацию, уточнение и план. Доменные схемы подключаются по запросу.
const startupTools = new Set(["update_plan", "ask_user"])
const coreGroups: Record<string, string[]> = {
  builds: ["list_builds", "get_build", "create_build", "copy_build", "rename_build", "set_build_version", "trash_build", "set_build_memory", "set_build_options", "launch_build", "stop_game", "game_status", "unlock_build", "lock_build"],
  launcher_ipc: ["list_launcher_capabilities", "get_launcher_capability"],
  versions: ["list_minecraft_versions", "recommend_minecraft_versions", "list_loader_versions"],
  content: ["search_projects", "get_project", "get_project_versions", "install_content", "remove_content", "toggle_content", "check_updates", "check_loader_requirements", "install_modpack"],
  build_files: ["read_build_file", "list_build_files", "write_build_config"],
  worlds: ["list_worlds", "copy_world", "rename_world", "delete_world"],
  settings: ["read_settings", "set_setting", "list_languages", "set_language", "recommend_launcher_settings"],
  themes: ["list_themes", "set_theme"],
  hardware: ["system_info", "get_hardware"],
  storage: ["storage_usage"],
  accounts: ["list_accounts"],
  servers: ["list_servers", "server_status", "server_logs", "start_server", "stop_server", "server_command", "create_server"],
  server_settings: ["read_server_properties", "set_server_property"],
  skins: ["list_skins", "find_player_skins", "apply_skin", "apply_laby_skin", "skin_catalog"],
  multiplayer: ["list_game_servers", "add_game_server"],
  cloud: ["list_cloud_storage", "list_cloud_files", "upload_build_backup"],
  statistics: ["get_statistics"],
  news: ["get_launcher_news", "get_minecraft_news"],
}
for (const tool of tools) {
  if (!tool.group && !startupTools.has(tool.name)) tool.group = Object.entries(coreGroups).find(([, names]) => names.includes(tool.name))?.[0] || "launcher"
}
add("list_tool_groups", "Каталог дополнительных инструментов. Вызови перед сложной задачей, затем подключи нужный раздел enable_tool_group.", "read", {}, async () => Object.entries(toolGroups).map(([id, description]) => ({ id, description, count: tools.filter(tool => tool.group === id).length })))
add("enable_tool_group", "Подключить раздел для следующих запросов. Старые группы могут вытесняться бюджетом; при необходимости подключи повторно.", "read", { group: choice(...Object.keys(toolGroups)) }, async (_api, input) => ({ success: true, enabledGroup: input.group, tools: tools.filter(tool => tool.group === input.group).map(tool => tool.name) }))

export function getEnabledToolGroups(messages: import("@xnlc/types").AgentWireMessage[], preserved: string[] = []): string[] {
  const calls = new Map<string, string>()
  const groups: string[] = [...new Set(preserved.filter(group => Object.hasOwn(toolGroups, group)))]
  for (const message of messages) {
    for (const call of message.tool_calls || []) if (call.function.name === "enable_tool_group") {
      try { const input = JSON.parse(call.function.arguments); if (Object.hasOwn(toolGroups, input.group)) calls.set(call.id, input.group) } catch { /* Некорректный вызов не подключает инструменты. */ }
    }
    if (message.role === "tool" && calls.has(message.tool_call_id || "")) {
      try { const result = JSON.parse(message.content || "{}"); const group = calls.get(message.tool_call_id!)!; if (result.success === true && result.enabledGroup === group) { const old = groups.indexOf(group); if (old >= 0) groups.splice(old, 1); groups.push(group) } } catch { /* Ошибка инструмента не подключает раздел. */ }
    }
  }
  return groups
}
export function getAgentTurnTools(messages: import("@xnlc/types").AgentWireMessage[], preserved: string[] = []): AgentTool[] {
  const selected = tools.filter(tool => !tool.group)
  let characters = JSON.stringify(selected.map(tool => tool.spec)).length
  for (const group of getEnabledToolGroups(messages, preserved).reverse()) {
    const extra = tools.filter(tool => tool.group === group)
    const size = JSON.stringify(extra.map(tool => tool.spec)).length
    if (selected.length + extra.length <= 128 && characters + size <= 24_000) { selected.push(...extra); characters += size }
  }
  // Порядок деклараций стабилен: подключение группы не переставляет прежний префикс без причины.
  const enabled = new Set(selected)
  return tools.filter(tool => enabled.has(tool))
}
export const AGENT_TOOLS: readonly AgentTool[] = tools
