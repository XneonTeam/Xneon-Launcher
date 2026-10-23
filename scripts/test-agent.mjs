/** Проверки протокола, инструментов и агентного цикла без сети и Electron. */
import assert from "node:assert/strict"
import fs from "node:fs/promises"
import { stripTypeScriptTypes, createRequire } from "node:module"
const require = createRequire(import.meta.url)
const { readAgentStream, redactAgentText } = require("../dist-electron/main/agent-protocol.js")
let passed = 0
async function check(name, run) { await run(); passed++; console.log(`✓ ${name}`) }
function stream(parts) { const encoder = new TextEncoder(); return new ReadableStream({ start(controller) { for (const part of parts) controller.enqueue(typeof part === "string" ? encoder.encode(part) : part); controller.close() } }) }
const { providerRequest, providerResult, providerHeaders, validateProviderKey } = require("../dist-electron/main/ai-providers.js")
const { validateModelConfigs, readModelConfigs } = require("../dist-electron/main/ai-model-config.js")
await check("Пакет агента: ESM и CommonJS работают без Electron и React", async () => {
  const esm = await import("@xnlc/agent")
  const cjs = require("@xnlc/agent")
  assert.equal(esm.AGENT_TOOLS.length, cjs.AGENT_TOOLS.length)
  assert.ok(esm.AGENT_TOOLS.length >= 247)
  assert.deepEqual(esm.providerHeaders({apiKey:"test",protocol:"openai"}),cjs.providerHeaders({apiKey:"test",protocol:"openai"}))
  for (const file of await fs.readdir(new URL("../packages/xnlc-agent/src/",import.meta.url))) {
    const source = await fs.readFile(new URL("../packages/xnlc-agent/src/"+file,import.meta.url),"utf8")
    assert.doesNotMatch(source, /from ["'](?:electron|react|react-i18next|@\/|\.\.\/)/,file)
  }
})
await check("Настройки моделей: 256K по умолчанию, миграция и строгая валидация", () => {
  assert.deepEqual(readModelConfigs(undefined, "custom"), [{ id: "custom", contextWindow: 256000, supportsImages: false }])
  const models = [{ id: "custom", contextWindow: 128000, supportsImages: true }, { id: "other", contextWindow: 256000, supportsImages: false }]
  assert.deepEqual(readModelConfigs(JSON.stringify(models), "custom"), models)
  for (const invalid of [[], [...models, models[0]], [{ ...models[0], contextWindow: 0 }], [{ ...models[0], contextWindow: 8192.5 }], [{ ...models[0], supportsImages: "yes" }]]) assert.throws(() => validateModelConfigs(invalid))
})
const toolSpec = { type: "function", function: { name: "get_project", description: "Project", parameters: { type: "object", properties: { id: { type: "string" } } } } }
const image = "data:image/png;base64,aGVsbG8="
const history = [{ role: "user", content: "What is this?", images: [image] }, { role: "assistant", content: null, tool_calls: [{ id: "call1", type: "function", function: { name: "get_project", arguments: '{"id":"sodium"}' } }, { id: "call2", type: "function", function: { name: "get_project", arguments: '{"id":"iris"}' } }] }, { role: "tool", content: '{"name":"Sodium"}', tool_call_id: "call1" }, { role: "tool", content: '{"name":"Iris"}', tool_call_id: "call2" }]
await check("OpenAI-совместимый API: изображения, инструменты и usage в потоке", () => {
  const config = { protocol: "openai", apiKey: "test", baseUrl: "https://proxy.example/v1", modelId: "custom" }
  const request = providerRequest(config, "System", history, [toolSpec])
  assert.equal(request.url, "https://proxy.example/v1/chat/completions")
  assert.equal(request.body.messages[1].content[1].image_url.url, image)
  assert.equal(request.body.messages[2].tool_calls[0].function.arguments, '{"id":"sodium"}')
  assert.equal(request.body.stream_options.include_usage, true)
  assert.equal(providerHeaders(config).Authorization, "Bearer test")
})
await check("Anthropic: native Messages, изображения и связанные результаты нескольких инструментов", () => {
  const config = { protocol: "anthropic", apiKey: "test", baseUrl: "https://api.anthropic.com/v1", modelId: "claude" }
  const request = providerRequest(config, "System", history, [toolSpec])
  assert.equal(request.url, "https://api.anthropic.com/v1/messages")
  assert.equal(providerHeaders(config)["x-api-key"], "test")
  assert.equal(request.body.messages[0].content[1].source.media_type, "image/png")
  assert.deepEqual(request.body.messages[2].content.map(item => item.tool_use_id), ["call1", "call2"])
  const result = providerResult("anthropic", { content: [{ type: "text", text: "Inspect" }, { type: "tool_use", id: "c1", name: "get_project", input: { id: "sodium" } }], usage: { input_tokens: 100, output_tokens: 20 } })
  assert.equal(result.calls[0].function.arguments, '{"id":"sodium"}')
  assert.equal(result.usage.prompt_tokens, 100)
  assert.throws(() => providerResult("anthropic", { stop_reason: "max_tokens" }), /output limit/)
})
await check("Anthropic кэширует повторяемый префикс, одноразовая сводка не создаёт кэш", () => {
  const config = { protocol: "anthropic", apiKey: "test", baseUrl: "https://api.anthropic.com/v1", modelId: "claude" }
  const normal = providerRequest(config, "System", history, [toolSpec]).body
  assert.equal(normal.system[0].cache_control.type, "ephemeral")
  assert.equal(normal.tools.at(-1).cache_control.type, "ephemeral")
  assert.equal(normal.messages.at(-1).content.at(-1).cache_control.type, "ephemeral")
  const summary = providerRequest(config, "Summarize", [{ role: "user", content: "History" }], [], { cache: false }).body
  assert.equal(summary.system, "Summarize")
  assert.equal(summary.messages[0].content[0].cache_control, undefined)
  const result = providerResult("anthropic", { content: [{ type: "text", text: "Done" }], usage: { input_tokens: 100, cache_read_input_tokens: 200, cache_creation_input_tokens: 300, output_tokens: 20 } })
  assert.equal(result.usage.prompt_tokens, 600)
})
await check("Лимит ответа согласуется с резервом маленького окна во всех протоколах", () => {
  for (const protocol of ["openai", "anthropic", "gemini", "ollama"]) {
    const body = providerRequest({ protocol, apiKey: "test", baseUrl: "https://test.example/v1", modelId: "test" }, "System", [{ role: "user", content: "Hi" }], [], { maxOutputTokens: 2048 }).body
    assert.equal(protocol === "gemini" ? body.generationConfig.maxOutputTokens : protocol === "ollama" ? body.options.num_predict : body.max_tokens, 2048)
  }
})
await check("Gemini: native generateContent, изображения и сохранение thoughtSignature для инструментов", () => {
  const config = { protocol: "gemini", apiKey: "test", baseUrl: "https://generativelanguage.googleapis.com/v1beta", modelId: "models/gemini" }
  const parts = [{ functionCall: { id: "gc1", name: "get_project", args: { id: "sodium" } }, thoughtSignature: "opaque-signature" }]
  const result = providerResult("gemini", { candidates: [{ finishReason: "STOP", content: { parts } }], usageMetadata: { promptTokenCount: 120, candidatesTokenCount: 30 } })
  assert.equal(result.usage.prompt_tokens, 120)
  const request = providerRequest(config, "System", [history[0], { role: "assistant", content: null, tool_calls: result.calls, providerParts: result.providerParts }, { role: "tool", tool_call_id: "gc1", content: "{}" }], [toolSpec])
  assert.equal(request.url, "https://generativelanguage.googleapis.com/v1beta/models/gemini:generateContent")
  assert.equal(request.body.contents[0].parts[1].inlineData.mimeType, "image/png")
  assert.equal(request.body.contents[1].parts[0].thoughtSignature, "opaque-signature")
  assert.equal(request.body.contents[2].parts[0].functionResponse.id, "gc1")
  assert.equal(providerHeaders(config)["x-goog-api-key"], "test")
})
await check("Ollama: native /api/chat без ключа, изображения и имена инструментов", () => {
  const config = { protocol: "ollama", apiKey: "", baseUrl: "http://localhost:11434", modelId: "local" }
  const request = providerRequest(config, "System", history, [toolSpec])
  assert.equal(request.url, "http://localhost:11434/api/chat")
  assert.equal(providerHeaders(config).Authorization, undefined)
  assert.equal(request.body.messages[1].images[0], "aGVsbG8=")
  assert.equal(request.body.messages[3].tool_name, "get_project")
  assert.deepEqual(request.body.messages[2].tool_calls[0].function.arguments, { id: "sodium" })
  const result = providerResult("ollama", { message: { content: "OK", tool_calls: [{ function: { name: "get_project", arguments: { id: "sodium" } } }] }, prompt_eval_count: 200, eval_count: 10 })
  assert.ok(result.calls[0].id)
  assert.equal(result.usage.prompt_tokens, 200)
})
const cardsSource = await fs.readFile(new URL("../packages/xnlc-agent/src/project-cards.ts", import.meta.url), "utf8")
const detailSource = await fs.readFile(new URL("../packages/xnlc-agent/src/project-details.ts", import.meta.url), "utf8")
const { loadAgentProjectDetails } = await import("data:text/javascript;base64," + Buffer.from(stripTypeScriptTypes(detailSource)).toString("base64"))
await check("Подробности из агента загружают полное описание, галерею и версии Modrinth", async () => {
  const details = { id: "actual-id", name: "Forge Config API Port", body: "# Full description", gallery: [{ url: "https://example.test/image.png" }], versions: [] }
  const versions = [{ id: "v1", changelog: "Changelog" }]
  const calls = []
  const result = await loadAgentProjectDetails({ modsModrinthDetails: async id => { calls.push(["details", id]); return details }, modsModrinthVersions: async id => { calls.push(["versions", id]); return versions } }, { source: "modrinth", projectId: "project-id", name: details.name, summary: "Short summary" })
  assert.equal(result.details, details)
  assert.equal(result.details.body, "# Full description")
  assert.equal(result.details.gallery.length, 1)
  assert.equal(result.versions, versions)
  assert.deepEqual(calls, [["details", "project-id"], ["versions", "project-id"]])
})
await check("Подробности CurseForge используют числовой ID и версии из существующего API", async () => {
  const details = { name: "Project", body: "Full description", versions: [{ id: "file-1" }] }
  const result = await loadAgentProjectDetails({ modsCurseforgeDetails: async id => { assert.equal(id, 123); return details } }, { source: "curseforge", modId: 123, id: "slug" })
  assert.equal(result.details, details)
  assert.equal(result.versions, details.versions)
  await assert.rejects(loadAgentProjectDetails({}, { source: "curseforge", id: "invalid" }), /Invalid CurseForge/)
  await assert.rejects(loadAgentProjectDetails({ modsModrinthDetails: async () => null, modsModrinthVersions: async () => [] }, { source: "modrinth", id: "missing" }), /not found/)
})
const cards = await import("data:text/javascript;base64," + Buffer.from(stripTypeScriptTypes(cardsSource)).toString("base64"))
await check("Карточка прикреплённого мода без вызовов инструментов", () => {
  const attachment = { id: "content:mod:build:xaero.jar", kind: "project", name: "Xaero's Minimap", content: JSON.stringify({ version: "26.6.1", source: "local", icon_url: "data:image/png;base64,AA", buildName: "My build" }) }
  const [card] = cards.attachedProjectCards([attachment])
  assert.equal(card.name, attachment.name)
  assert.equal(card.iconUrl, "data:image/png;base64,AA")
  assert.equal(card.version, "26.6.1")
  assert.equal(card.contentType, "mod")
  const timeline = [{ kind: "user", attachments: [attachment] }, { kind: "assistant", text: "" }, { kind: "assistant", text: "Описание" }, { kind: "assistant", text: "Продолжение" }]
  assert.deepEqual(cards.assistantProjectContext(timeline, 2), [attachment])
  assert.deepEqual(cards.assistantProjectContext(timeline, 3), [])
  assert.deepEqual(cards.attachedProjectCards([{ ...attachment, kind: "file" }]), [])
})
await check("Карточка выдерживает повреждённые метаданные и сохраняет ID каталога", () => {
  const [broken] = cards.attachedProjectCards([{ id: "x", kind: "project", name: "Local", content: "null" }])
  assert.equal(broken.name, "Local")
  const [remote] = cards.attachedProjectCards([{ id: "modrinth:sodium", kind: "project", name: "Sodium", source: "modrinth", projectId: "sodium", content: "{}" }])
  assert.equal(remote.projectId, "sodium")
  assert.equal(remote.source, "modrinth")
})

await check("Главная карточка поиска отображается у ответа при свёрнутом инструменте", () => {
  const sodium = { id: "sodium", name: "Sodium", source: "modrinth", iconUrl: "https://cdn.modrinth.com/sodium.png" }
  const extra = { id: "extra", name: "Sodium Extra", source: "modrinth" }
  const timeline = [{ kind: "user", text: "Что такое содиум?" }, { kind: "assistant", text: "" }, { kind: "tool", toolName: "search_projects", status: "done", output: JSON.stringify({ results: [extra, sodium] }) }, { kind: "assistant", text: "Sodium — мод для оптимизации." }]
  assert.deepEqual(cards.assistantResultCards(timeline, 3), [sodium])
  timeline.push({ kind: "user", text: "Спасибо" }, { kind: "assistant", text: "Пожалуйста" })
  assert.deepEqual(cards.assistantResultCards(timeline, 5), [])
  timeline[2].output = "invalid json"
  assert.deepEqual(cards.assistantResultCards(timeline, 3), [])
})
await check("Несколько карточек собираются из всех поисков хода и идут в порядке описания", () => {
  const jei = { id: "jei", name: "Just Enough Items (JEI)", source: "curseforge" }
  const fabric = { id: "fabric", name: "Fabric API", source: "modrinth" }
  const sodium = { id: "sodium", name: "Sodium", source: "modrinth" }
  const unrelated = { id: "unrelated", name: "Other project", source: "modrinth" }
  const timeline = [
    { kind: "user", text: "Популярные моды" },
    { kind: "tool", toolName: "search_projects", status: "done", output: JSON.stringify({ results: [jei, unrelated] }) },
    { kind: "tool", toolName: "get_project", status: "done", output: JSON.stringify(sodium) },
    { kind: "tool", toolName: "search_projects", status: "done", output: JSON.stringify({ results: [fabric, sodium] }) },
    { kind: "assistant", text: "Just Enough Items (JEI)\n" + "Описание. ".repeat(100) + "\nFabric API\nSodium" },
  ]
  assert.deepEqual(cards.assistantResultCards(timeline, 4), [jei, fabric, sodium])
  timeline.push({ kind: "user", text: "Следующий вопрос" }, { kind: "assistant", text: "Sodium" })
  assert.deepEqual(cards.assistantResultCards(timeline, 6), [])
})
await check("Несколько явно полученных проектов показываются без повторения названий в ответе", () => {
  const first = { id: "one", name: "One", source: "modrinth" }
  const second = { id: "two", name: "Two", source: "curseforge" }
  const timeline = [{ kind: "user", text: "Сравни" }, ...[first, second].map(project => ({ kind: "tool", toolName: "get_project", status: "done", output: JSON.stringify(project) })), { kind: "assistant", text: "Первый быстрее второго." }]
  assert.deepEqual(new Set(cards.assistantResultCards(timeline, 3)), new Set([first, second]))
})
await check("Карточки чередуются с описаниями, вступление остаётся перед ними", () => {
  const jei = { name: "Just Enough Items (JEI)", id: "jei" }
  const fabric = { name: "Fabric API", id: "fabric" }
  const sodium = { name: "Sodium", id: "sodium" }
  const text = "Популярные моды: Sodium и Fabric API.\n\n1. Just Enough Items (JEI)\n\nПросмотр рецептов.\n\n2. Fabric API\n\nБиблиотека.\n\n### **3. Sodium**\n\nОптимизация."
  const sections = cards.projectAnswerSections(text, [sodium, jei, fabric])
  assert.equal(sections[0].project, undefined)
  assert.equal(sections[0].text.trim(), "Популярные моды: Sodium и Fabric API.")
  assert.deepEqual(sections.slice(1).map(section => section.project.id), ["jei", "fabric", "sodium"])
  assert.deepEqual(sections.slice(1).map(section => section.text.trim()), ["Просмотр рецептов.", "Библиотека.", "Оптимизация."])
})
await check("Разделение карточек сохраняет код и Markdown описания", () => {
  const sodium = { name: "Sodium", id: "sodium" }
  const iris = { name: "Iris", id: "iris" }
  const text = "```md\n# Iris\n```\n\n## Sodium\n\n**Описание**\n\n- Пункт\n\n## Iris\n\n| A | B |\n| - | - |\n| 1 | 2 |"
  const sections = cards.projectAnswerSections(text, [sodium, iris])
  assert.equal(sections[0].text.trim(), "```md\n# Iris\n```")
  assert.equal(sections[1].project, sodium)
  assert.equal(sections[1].text.trim(), "**Описание**\n\n- Пункт")
  assert.equal(sections[2].project, iris)
  assert.ok(sections[2].text.includes("| 1 | 2 |"))
  assert.equal(cards.projectAnswerSections("Описание без названия", [sodium])[0].text, "Описание без названия")
  assert.deepEqual(cards.projectAnswerSections("Без карточек", []), [{ text: "Без карточек" }])
})
await check("Под карточкой нет повторного заголовка и подписи логотипа", () => {
  assert.equal(cards.projectAnswerText("## Sodium\n\n![Sodium](https://example.com/icon.png)\n\n**Sodium** — мод.\n\n## Что делает Sodium?", ["Sodium"]), "**Sodium** — мод.\n\n## Что делает Sodium?")
  assert.equal(cards.projectAnswerText("Sodium\nИконка Sodium\nОписание", ["Sodium"]), "Описание")
  assert.equal(cards.projectAnswerText("Sodium — это популярный мод.\nПродолжение", ["Sodium"]), "это популярный мод.\nПродолжение")
  assert.equal(cards.projectAnswerText("## Sodium\nТекст", []), "## Sodium\nТекст")
})
const event = value => `data: ${JSON.stringify(value)}\r\n\r\n`

await check("SSE: текст и фрагменты аргументов на произвольных границах пакетов", async () => {
  const raw = event({ choices:[{ delta:{ content:"Привет!", tool_calls:[{ index:0,id:"call_1",function:{name:"list_builds",arguments:"{"} }] } }] }) + event({ choices:[{ delta:{ tool_calls:[{index:0,function:{arguments:"}"}}] },finish_reason:"tool_calls" }], usage:{total_tokens:10} }) + "data: [DONE]"
  const bytes = new TextEncoder().encode(raw)
  const parts = Array.from({ length:bytes.length },(_, i) => bytes.slice(i,i+1))
  let text = ""
  const result = await readAgentStream(stream(parts), delta => text += delta)
  assert.equal(text,"Привет!")
  assert.equal(result.calls[0].function.arguments,"{}")
  assert.equal(result.calls[0].function.name,"list_builds")
  assert.equal(result.usage.total_tokens,10)
})
await check("SSE: обрыв потока не считается успешным ответом", async () => {
  await assert.rejects(readAgentStream(stream([event({ choices:[{delta:{content:"partial"}}] })]),()=>{}), /before completion/)
})
await check("SSE: ошибки провайдера и усечённые ответы", async () => {
  await assert.rejects(readAgentStream(stream([event({error:{message:"provider unavailable"}})]),()=>{}),/provider unavailable/)
  await assert.rejects(readAgentStream(stream([event({choices:[{finish_reason:"length",delta:{content:"x"}}]}),"data: [DONE]\n"]),()=>{}),/output limit/)
})
await check("SSE: несколько инструментов сохраняют порядок", async () => {
  const result = await readAgentStream(stream([event({choices:[{delta:{tool_calls:[{index:1,id:"b",function:{name:"B",arguments:"{}"}},{index:0,id:"a",function:{name:"A",arguments:"{}"}}]},finish_reason:"tool_calls"}]}),"data: [DONE]\n"]),()=>{})
  assert.deepEqual(result.calls.map(item=>item.id),["a","b"])
})
await check("Секреты и домашние пути удаляются перед отправкой", () => {
  const redacted = redactAgentText('Authorization: Bearer secret.jwt.token\n{"accessToken":"abc123", "password":"private"}\n--accessToken mc-token\nC:\\Users\\Alice\\.minecraft\\logs\\latest.log\n/home/bob/game')
  for (const secret of ["secret.jwt.token","abc123","private","mc-token","Alice","bob"]) assert.ok(!redacted.includes(secret),secret)
})

// Загружаем исходные TS-модули. Подменяется только UI-хук запуска, а сами
// инструменты и цикл выполняются без изменения кода.
const moduleUrl = source => "data:text/javascript;base64," + Buffer.from(stripTypeScriptTypes(source)).toString("base64")
const themeModelUrl = moduleUrl(await fs.readFile(new URL("../components/launcher/settings/theme-model.ts", import.meta.url), "utf8"))
const themeDataUrl = moduleUrl((await fs.readFile(new URL("../components/launcher/settings/data.ts", import.meta.url), "utf8")).replace(/^export \{ applyTheme \}.*$/m, ""))
const themeModel = await import(themeModelUrl)
const themeData = await import(themeDataUrl)
const { configureAgentHost } = await import("@xnlc/agent/host")
configureAgentHost({
  api: () => window.electronAPI,
  translate: key => key,
  language: () => "ru",
  emit: (name,detail) => window.dispatchEvent(new CustomEvent(name,{detail})),
  launch: { loadLaunchSettings: async()=>({}), normalizeJavaPath: x=>x, resolveLaunchDimensions: ()=>({width:1280,height:720}), saveLastLaunchedPrefs: ()=>{} },
  themes: {...themeModel, presets:themeData.presetThemes},
})
const { invokeLauncherCapability, redactLauncherValue } = await import("@xnlc/agent/launcher-tools")
const { LAUNCHER_CAPABILITIES, IPC_CHANNELS, UNBRIDGED_IPC_CHANNELS } = await import("@xnlc/agent/launcher-ipc-catalog")
const { AGENT_TOOLS, parseToolInput, getAgentTurnTools } = await import("@xnlc/agent/tools")
if (process.argv.includes("--list-tools")) { console.log("AGENT_CATALOG:" + JSON.stringify(AGENT_TOOLS.map(tool => ({ name: tool.name, description: tool.spec.function.description, group: tool.group })))); process.exit(0) }
const tool = name => { const result = AGENT_TOOLS.find(item=>item.name===name); assert.ok(result,name); return result }
const target = { id:"build",name:"Example",version:"1.21.1",modLoader:"fabric",modsCount:0,resourcepacksCount:0,shadersCount:0,source:"local" }
const version = {id:"v1",name:"1.0",fileName:"example.jar",gameVersion:"1.21.1",loaders:["fabric"],files:[{url:"https://cdn.modrinth.com/example.jar",filename:"example.jar"}]}
const project = {id:"project",name:"Example",summary:"Description",source:"modrinth",versions:[version],description:""}
const content = {mods:[],resourcepacks:[],shaders:[],installedMods:{}}
function mockApi() {
  const calls=[]
  return { calls,loadBuildsLight:async()=>[target],getBuildIntentPath:async name=>`C:/intents/${name}`,async agentBuildDestination(name,exclude) {const path=await this.getBuildIntentPath(name);const builds=await this.loadBuildsLight();const paths=await Promise.all(builds.filter(build=>build.id!==exclude).map(build=>this.getBuildIntentPath(build.name)));return {path,available:!paths.includes(path)}},scanBuildIntentContent:async()=>content,updateBuildFields:async(...args)=>{calls.push(["update",...args])},modsModrinthDetails:async()=>project,modsModrinthVersions:async()=>[version],modsResolveDependencies:async()=>[{projectId:"dep",dependencyType:"required"}],saveContentToIntent:async(...args)=>{calls.push(["download",...args]);return "path"},deleteContentFromIntent:async(...args)=>{calls.push(["delete",...args]);return {success:true}},insertBuild:async item=>calls.push(["insert",item]),getTotalMemory:async()=>16*1024**3 }
}
await check("Каталог инструментов: уникальные имена, схемы, безопасные режимы", () => {
  assert.equal(new Set(AGENT_TOOLS.map(item=>item.name)).size,AGENT_TOOLS.length)
  for(const item of AGENT_TOOLS) { assert.equal(item.spec.function.name,item.name); assert.equal(item.spec.function.parameters.additionalProperties,false) }
  for(const name of ["trash_build","remove_content","delete_world"]) assert.equal(tool(name).risk,"delete")
  for(const name of ["server_command","upload_build_backup"]) assert.equal(tool(name).risk,"sensitive")
})
await check("Полный IPC-каталог покрывает все каналы без пропусков", () => {
  assert.equal(UNBRIDGED_IPC_CHANNELS.length,0)
  assert.ok(LAUNCHER_CAPABILITIES.length>=295)
  assert.ok(IPC_CHANNELS.length>=290)
  assert.equal(new Set(LAUNCHER_CAPABILITIES.map(x=>x.method)).size,LAUNCHER_CAPABILITIES.length)
  for(const channel of IPC_CHANNELS) assert.ok(LAUNCHER_CAPABILITIES.some(x=>x.channels.includes(channel)),channel)
})
await check("IPC: вызов чтения, маршрутизация доменных записей и маскирование секретов",async()=>{
  assert.deepEqual(await invokeLauncherCapability({fetchLauncherNews:async()=>[{title:"News"}]} ,"fetchLauncherNews","[]","read"),[{title:"News"}])
  await assert.rejects(invokeLauncherCapability({},"unknown","[]","read"),/Unknown/)
  await assert.rejects(invokeLauncherCapability({},"getSetting","[123]","read"),/Invalid argument/)
  const routed=await invokeLauncherCapability({setSetting:()=>assert.fail("bypass")},"setSetting",'[]',"action")
  assert.ok(routed.useTools.includes("set_setting"))
  assert.deepEqual(redactLauncherValue({accessToken:"secret",nested:{password:"secret"},key:"apiKey",value:"secret"}),{accessToken:"[REDACTED]",nested:{password:"[REDACTED]"},key:"apiKey",value:"[REDACTED]"})
})
await check("IPC: действия, штатный вход и события с очисткой подписки",async()=>{
  const previous=globalThis.window;globalThis.window=new EventTarget();try {
    let opened;window.addEventListener("launcher:open-section",event=>opened=event.detail.section)
    const route=await invokeLauncherCapability({loginMicrosoft:()=>assert.fail("credentials")},"loginMicrosoft","[]","action");assert.equal(route.awaitingUserInput,true);assert.equal(opened,"accounts")
    let deleted;await invokeLauncherCapability({deleteTrashItem:async id=>{deleted=id;return{success:true}}},"deleteTrashItem",'["trash-id"]',"action");assert.equal(deleted,"trash-id")
    await assert.rejects(invokeLauncherCapability({},"deleteTrashItem",'["id"]',"read"),/matching/)
    let unsubscribed=false;const result=await tool("watch_launcher_event").run({onImportProgress:callback=>{callback({progress:50,accessToken:"secret"});return()=>{unsubscribed=true}}},{method:"onImportProgress",timeoutMs:100});assert.equal(unsubscribed,true);assert.equal(result.samples[0].progress,50);assert.equal(result.samples[0].accessToken,"[REDACTED]")
  }finally{globalThis.window=previous}
})
await check("Новости используют обе штатные ленты",async()=>{
  assert.equal(await tool("get_launcher_news").run({fetchLauncherNews:async()=>"launcher"},{}),"launcher")
  assert.equal(await tool("get_minecraft_news").run({fetchMinecraftNews:async()=>"minecraft"},{}),"minecraft")
})
await check("FTB: поиск, подробности и установка версии с префиксом ftb-",async()=>{
  const api=mockApi();api.modsFtbSearch=async()=>({results:[{id:"123",name:"Pack"}]});api.modsFtbDetails=async()=>({id:"123",name:"Pack",summary:"Pack",description:"Full",versions:[{id:"ftb-456"}]});
  const search=await tool("search_projects").run(api,{source:"ftb",query:"pack",type:"modpack"});assert.equal(search.results[0].source,"ftb");assert.equal(search.results[0].contentType,"modpack")
  const detail=await loadAgentProjectDetails(api,{source:"ftb",projectId:"123"});assert.equal(detail.versions[0].id,"ftb-456")
  api.importFtbModpack=async(name,id,version)=>{assert.equal(id,123);assert.equal(version,456);return{success:true,version:"1.21.1",modLoader:"forge"}}
  const result=await tool("install_modpack").run(api,{source:"ftb",projectId:"123",versionId:"ftb-456",name:"FTB Pack"});assert.equal(result.success,true);const inserted=api.calls.find(x=>x[0]==="insert")[1];assert.equal(inserted.source,"ftb");assert.equal(inserted.fileId,456);assert.equal(inserted.locked,true)
})
await check("Названия всех инструментов переведены на русский и английский", async () => {
  for(const locale of ["ru","en"]) {
    const strings=JSON.parse(await fs.readFile(new URL(`../src/i18n/locales/${locale}/translation.json`,import.meta.url),"utf8"))
    for(const item of AGENT_TOOLS) assert.ok(strings[`agent.tools.${item.name}`],`${locale}: ${item.name}`)
  }
})
await check("Валидация: неизвестные поля, enum, типы и prototype pollution", () => {
  const item = tool("get_project")
  assert.throws(()=>parseToolInput(item,'{"source":"other","projectId":"x"}'))
  assert.throws(()=>parseToolInput(item,'{"source":"modrinth","projectId":123}'))
  assert.throws(()=>parseToolInput(item,'{"source":"modrinth","projectId":"x","__proto__":{}}'))
  assert.throws(()=>parseToolInput(tool("list_builds"),'[]'))
  assert.deepEqual(parseToolInput(item,'{"source":"modrinth","projectId":"sodium"}'),{source:"modrinth",projectId:"sodium"})
})
await check("Несовместимая версия не скачивается", async () => {
  const api=mockApi();api.modsModrinthVersions=async()=>[{...version,gameVersion:"1.20.1"}]
  await assert.rejects(tool("install_content").run(api,{buildId:"build",source:"modrinth",projectId:"project",versionId:"v1",type:"mod"}),/not compatible/)
  assert.equal(api.calls.length,0)
})
await check("Заблокированный модпак нельзя изменить инструментом", async () => {
  const api=mockApi();api.loadBuildsLight=async()=>[{...target,locked:true}]
  await assert.rejects(tool("install_content").run(api,{buildId:"build"}),/BUILD_LOCKED/)
  assert.equal(api.calls.length,0)
})
await check("Установка берёт URL из каталога и возвращает обязательные зависимости", async () => {
  const api=mockApi()
  const result=await tool("install_content").run(api,{buildId:"build",source:"modrinth",projectId:"project",versionId:"v1",type:"mod"})
  assert.equal(result.success,true);assert.equal(result.requiredDependencies[0].projectId,"dep")
  assert.equal(api.calls[0][0],"download");assert.equal(api.calls[0][3],version.files[0].url)
  assert.equal(api.calls.at(-1)[2].mods[0].projectId,"project")
})
await check("Сбой загрузки сохраняет старую версию мода", async () => {
  const api=mockApi();api.saveContentToIntent=async()=>null
  api.scanBuildIntentContent=async()=>({...content,mods:[{slug:"old.jar",source:"modrinth",projectId:"project"}]})
  await assert.rejects(tool("install_content").run(api,{buildId:"build",source:"modrinth",projectId:"project",versionId:"v1",type:"mod"}),/Download failed/)
  assert.equal(api.calls.filter(call=>call[0]==="delete").length,0)
})
await check("Копирование не перезаписывает сборку с совпадающей нормализованной папкой", async () => {
  const api=mockApi();api.getBuildIntentPath=async()=>"C:/same"
  await assert.rejects(tool("copy_build").run(api,{buildId:"build",name:"Different name"}),/directory already/)
})
await check("Переименование не перемещает папку поверх другой сборки", async () => {
  const api=mockApi();api.loadBuildsLight=async()=>[target,{...target,id:"other",name:"Other"}]
  await assert.rejects(tool("rename_build").run(api,{buildId:"build",name:"Other"}),/directory already/)
  assert.equal(api.calls.length,0)
})
await check("Смена версии требует существующей версии Minecraft", async () => {
  const api=mockApi();api.getMinecraftVersions=async()=>[{version:"1.21.1"}]
  await assert.rejects(tool("set_build_version").run(api,{buildId:"build",version:"fake-version",loader:"vanilla"}),/Unknown Minecraft version/)
  assert.equal(api.calls.length,0)
})
await check("Имя новой сборки не может быть абсолютным путём", async () => {
  const api=mockApi()
  await assert.rejects(tool("copy_build").run(api,{buildId:"build",name:"C:/Windows"}),/Invalid build name/)
  assert.equal(api.calls.length,0)
})
await check("Установка модпака регистрирует его в библиотеке", async () => {
  const api=mockApi();api.importModrinthModpack=async()=>({success:true,version:"1.21.1",modLoader:"fabric"})
  const result=await tool("install_modpack").run(api,{source:"modrinth",projectId:"project",versionId:"pack-v1",name:"New pack"})
  assert.equal(result.success,true)
  const item=api.calls.find(call=>call[0]==="insert")[1]
  assert.equal(item.name,"New pack");assert.equal(item.locked,true);assert.equal(item.modpackVersionId,"pack-v1")
})
await check("Память проверяется относительно физической RAM", async () => {
  const api=mockApi()
  await assert.rejects(tool("set_build_memory").run(api,{buildId:"build",minMiB:512,maxMiB:32768}),/Invalid memory/)
  await tool("set_build_memory").run(api,{buildId:"build",minMiB:512,maxMiB:4096})
  assert.equal(api.calls[0][2].memoryMax,"4096M")
})
await check("Аккаунты выдаются без токенов", async () => {
  const result=await tool("list_accounts").run({loadAccounts:async()=>[{id:"a",username:"Player",type:"offline",isActive:true,accessToken:"secret",refreshToken:"secret"}]},{})
  assert.ok(!JSON.stringify(result).includes("secret"))
})
await check("Настройки: отклоняются секреты, неверные значения и диапазоны", async () => {
  const api=mockApi();api.getSetting=async key=>key==="memoryMax"?"4G":"512M";api.setSetting=async()=>{throw new Error("Unexpected mutation")}
  for(const input of [{key:"aiApiKey",value:"secret"},{key:"memoryMax",value:"0M"},{key:"showSnapshot",value:"yes"},{key:"language",value:"invalid"},{key:"serverPort",value:"70000"}]) await assert.rejects(tool("set_setting").run(api,input),error=>!error.message.includes("Unexpected mutation"))
})

const chats = new Map()
let onDelta
let memoryWrites = 0
let complete = async request => {
  const last=request.messages.at(-1)
  if(last.role==="tool") return {text:"Готово",calls:[]}
  return {text:"",calls:[{id:"c1",type:"function",function:{name:"set_build_memory",arguments:JSON.stringify({buildId:"build",minMiB:512,maxMiB:4096})}}]}
}
const runtimeApi = {...mockApi(),agentListChats:async()=>[],agentGetChat:async id=>chats.get(id),agentSaveChat:async chat=>chats.set(chat.id,structuredClone(chat)),agentDeleteChat:async id=>chats.delete(id),agentSetArchived:async(id,archived)=>{const chat=chats.get(id);if(!chat)throw new Error("Chat not found");chats.set(id,{...chat,archived})},onAgentDelta:fn=>{onDelta=fn;return()=>{onDelta=undefined}},agentComplete:request=>complete(request),agentCancel:async()=>{},updateBuildFields:async()=>{memoryWrites++}}
globalThis.window = new EventTarget()
window.electronAPI = runtimeApi
const store = await import("@xnlc/agent/runtime")
await check("Короткое ядро и предметные инструкции выбираются по активным инструментам", async () => {
  const { agentSystemPrompt, agentCompactionPrompt, AGENT_SYSTEM_PROMPT } = await import("@xnlc/agent/prompt")
  const basic = agentSystemPrompt("ru", getAgentTurnTools([]).map(tool => tool.name))
  assert.ok(basic.length < 2500)
  assert.ok(basic.includes("untrusted data"))
  assert.ok(basic.includes("Respond in this language"))
  assert.ok(basic.includes("Russian (ru)"))
  assert.ok(!/[А-Яа-яЁё]/.test(AGENT_SYSTEM_PROMPT + basic + agentCompactionPrompt("ru")))
  assert.ok(!basic.includes("requiredDependencies"))
  assert.ok(basic.includes("retrieve catalog data before answering"))
  assert.ok(basic.includes("never invent a card, ID or icon"))
  assert.ok(agentSystemPrompt("ru", ["get_project"]).includes("requiredDependencies"))
  const server = agentSystemPrompt("ru", ["create_server", "server_status"])
  assert.ok(server.includes("Do not search for or suggest extra plugins"))
  assert.ok(agentSystemPrompt("ru", ["skin_catalog"]).includes("Skins:"))
  assert.ok(agentSystemPrompt("ru", ["list_worlds"]).includes("Worlds:"))
  assert.ok(agentSystemPrompt("ru", ["read_build_file"]).includes("Diagnostics:"))
  assert.equal(server, agentSystemPrompt("ru", ["server_status", "create_server"]))
  const usage = store.agentContextUsage([], "привет")
  assert.ok(usage.tokens < 2000)
})
await check("Рабочий контекст сокращает описания без потери версий, зависимостей и ошибок", () => {
  const value = { id: "project", versionId: "v1", success: false, error: "Check dependencies", description: "x".repeat(18000), requiredDependencies: [{ projectId: "fabric-api", versionId: "required-v2" }], gallery: Array.from({ length: 20 }, (_, i) => ({ url: `https://test.example/${i}.png` })) }
  const compact = store.toolResult(value, true)
  const parsed = JSON.parse(compact)
  assert.ok(compact.length < 4000)
  assert.equal(parsed.id, value.id)
  assert.equal(parsed.versionId, "v1")
  assert.deepEqual(parsed.requiredDependencies, value.requiredDependencies)
  assert.equal(parsed.success, false)
  assert.equal(parsed.error, value.error)
  assert.ok(parsed.contextTruncated.includes("description"))
  assert.equal(value.description.length, 18000)
})
await check("Карточки проектов сохраняются при обрезке большого ответа", () => {
  const project = { id: "sodium", source: "modrinth", name: "Sodium", iconUrl: "https://cdn.modrinth.com/icon.png", downloads: 100, description: "x".repeat(50000) }
  const result = JSON.parse(store.toolResult(project))
  assert.equal(result.name, "Sodium")
  assert.equal(result.source, "modrinth")
  assert.equal(result.truncated, true)
  const search = JSON.parse(store.toolResult({ results: [project, { ...project, id: "iris", name: "Iris" }] }))
  assert.deepEqual(search.results.map(item => item.name), ["Sodium", "Iris"])
  assert.ok(JSON.stringify(search).length < 24000)
})
await store.initializeAgent()
await check("Прогресс модпака: общий процент, текущий файл и очистка подписок", () => {
  let importProgress, contentProgress, stopped = 0
  runtimeApi.onImportProgress = callback => { importProgress = callback; return () => stopped++ }
  runtimeApi.onContentDownloadProgress = callback => { contentProgress = callback; return () => stopped++ }
  const stop = store.trackAgentInstallation("install_modpack", "pack-progress")
  assert.equal(store.getAgentState().progress.percent, null)
  importProgress({ current: 25, total: 100, message: "Installing mods", itemName: "sodium.jar" })
  assert.equal(store.getAgentState().progress.percent, 25)
  assert.equal(store.getAgentState().progress.fileName, "sodium.jar")
  contentProgress({ current: 99, total: 100, fileName: "iris.jar" })
  assert.equal(store.getAgentState().progress.percent, 25)
  assert.equal(store.getAgentState().progress.fileName, "iris.jar")
  stop()
  assert.equal(stopped, 2)
  assert.equal(store.getAgentState().progress, undefined)
  importProgress({ current: 99, total: 100, message: "Late event" })
  assert.equal(store.getAgentState().progress, undefined)
  delete runtimeApi.onImportProgress
  delete runtimeApi.onContentDownloadProgress
})
await check("Прогресс отдельного контента использует байты и выдерживает неизвестный размер", () => {
  let progress
  runtimeApi.onContentDownloadProgress = callback => { progress = callback; return () => {} }
  const stop = store.trackAgentInstallation("install_content", "content-progress")
  progress({ current: 512, total: 1024, fileName: "mod.jar" })
  assert.equal(store.getAgentState().progress.percent, 50)
  assert.equal(store.getAgentState().progress.bytes, true)
  progress({ current: 2048, total: 1024, fileName: "mod.jar" })
  assert.equal(store.getAgentState().progress.percent, 100)
  progress({ current: 2048, total: 0, fileName: "mod.jar" })
  assert.equal(store.getAgentState().progress.percent, null)
  stop()
  assert.equal(store.getAgentState().progress, undefined)
  delete runtimeApi.onContentDownloadProgress
})
async function until(predicate) { for(let i=0;i<200;i++) { if(predicate())return;await new Promise(resolve=>setTimeout(resolve,5)) }throw new Error("Timed out waiting for agent") }
await check("Режим подтверждения: изменение ждёт разрешения", async () => {
  store.setAgentDraft("Изменить память")
  const run=store.sendAgentMessage()
  await until(()=>store.getAgentState().pendingId)
  assert.equal(memoryWrites,0)
  store.answerAgentApproval(true)
  await run
  assert.equal(memoryWrites,1)
  assert.equal(store.getAgentState().chat.timeline.at(-1).text,"Готово")
})
await check("Отклонённое действие не выполняется, результат отказа идёт модели", async () => {
  await store.newAgentChat();store.setAgentDraft("Не менять память")
  const run=store.sendAgentMessage();await until(()=>store.getAgentState().pendingId)
  store.answerAgentApproval(false);await run
  assert.equal(memoryWrites,1)
  assert.ok(store.getAgentState().chat.messages.some(item=>item.role==="tool"&&item.content.includes("declined")))
})
await check("Автоматический режим выполняет изменения без ожидания", async () => {
  await store.newAgentChat();store.setAgentMode("auto");store.setAgentDraft("Изменить память")
  await store.sendAgentMessage();assert.equal(memoryWrites,2)
})
await check("Удаление требует подтверждения и в автоматическом режиме", async () => {
  complete=async request=>request.messages.at(-1).role==="tool"?{text:"Отклонено",calls:[]}:{text:"",calls:[{id:"delete",type:"function",function:{name:"trash_build",arguments:'{"buildId":"build"}'}}]}
  store.setAgentDraft("Удалить сборку");const run=store.sendAgentMessage();await until(()=>store.getAgentState().pendingId)
  store.answerAgentApproval(false);await run
  assert.equal(memoryWrites,2)
})
await check("Передача файлов в облако требует подтверждения в автоматическом режиме", async () => {
  complete=async request=>request.messages.at(-1).role==="tool"?{text:"Отклонено",calls:[]}:{text:"",calls:[{id:"upload",type:"function",function:{name:"upload_build_backup",arguments:'{"buildId":"build","providerId":"drive"}'}}]}
  store.setAgentDraft("Сделать копию в облаке");const run=store.sendAgentMessage();await until(()=>store.getAgentState().pendingId)
  store.answerAgentApproval(false);await run
  assert.equal(memoryWrites,2)
})
await check("Остановка на подтверждении завершает цикл и сохраняет чат", async () => {
  store.setAgentDraft("Удалить сборку");const run=store.sendAgentMessage();await until(()=>store.getAgentState().pendingId)
  await store.stopAgent();await run
  assert.equal(store.getAgentState().running,false)
  assert.equal(store.getAgentState().chat.timeline.at(-1).kind,"stopped")
  assert.equal(chats.get(store.getAgentState().chat.id).timeline.at(-1).kind,"stopped")
})
await check("Обрезка контекста не разрывает вызов инструмента и его результат", () => {
  const old={role:"user",content:"x".repeat(300)}
  const messages=[old,{role:"assistant",content:null,tool_calls:[{id:"c"}]},{role:"tool",content:"result",tool_call_id:"c"},{role:"user",content:"Next"}]
  assert.deepEqual(store.agentContext(messages,50),[messages.at(-1)])
})
await check("Контекст модели по умолчанию 256K, учитывает инструкции, инструменты и вложения", () => {
  const empty = store.agentContextUsage([])
  assert.equal(empty.contextWindow, 256_000)
  assert.equal(empty.tokens, 0)
  assert.equal(empty.percent, 0)
  assert.ok(empty.breakdown.every(part => part.tokens === 0))
  assert.equal(store.agentContextUsage([], "  \n ", [], 8192, { model: "old", tokens: 16000, estimatedTokens: 0 }).tokens, 0)
  const plain = store.agentContextUsage([], "Проверь лог")
  assert.ok(plain.tokens > 0 && plain.tokens < 3000)
  assert.equal(store.agentContextUsage([], "Проверь лог").breakdown.find(part => part.key === "messages").tokens, 0)
  const attachment = { id: "log", kind: "file", name: "latest.log", content: "x".repeat(300_000) }
  const attached = store.agentContextUsage([], "Проверь лог", [attachment])
  assert.ok(store.agentContextUsage([], "", [attachment]).tokens > 0)
  assert.ok(attached.tokens > plain.tokens)
  assert.ok(attached.tokens - plain.tokens < 8000)
  assert.equal(attached.full, false)
  assert.equal(store.agentContextUsage([], "x".repeat(8000), [], 32_000).contextWindow, 32_000)
})
await check("Индикатор использует токены провайдера и индивидуальное окно модели", () => {
  const messages = [{ role: "user", content: "Test" }]
  const measured = store.measureAgentContext(messages, 16_000)
  const usage = store.agentContextUsage(messages, "", [], 32_000, measured)
  assert.equal(usage.tokens, 16_000)
  assert.equal(usage.percent, 50)
  assert.ok(store.agentContextUsage(messages, "new draft", [], 32_000, measured).tokens > 16_000)
})
await check("Разбивка контекста отделяет сообщения, инструменты, вложения и черновик", () => {
  const messages = [
    { role: "user", content: 'Question\n\n<attachment name="log" kind="file">\n' + "x".repeat(2000) + '\n</attachment>', images: [image] },
    { role: "assistant", content: null, tool_calls: [{ id: "tool", type: "function", function: { name: "get_project", arguments: "{}" } }] },
    { role: "tool", content: "result", tool_call_id: "tool" },
    { role: "assistant", content: "Answer" },
  ]
  const usage = store.agentContextUsage(messages, "Draft")
  const parts = Object.fromEntries(usage.breakdown.map(part => [part.key, part.tokens]))
  for (const key of ["instructions", "tools", "messages", "attachments", "draft"]) assert.ok(parts[key] > 0, key)
  assert.equal(Object.values(parts).reduce((sum, value) => sum + value, 0), usage.tokens)
  const measured = store.measureAgentContext(messages, 12345)
  const calibrated = store.agentContextUsage(messages, "", [], 256000, measured)
  assert.equal(calibrated.breakdown.reduce((sum, part) => sum + part.tokens, 0), 12345)
  assert.equal(calibrated.breakdown.find(part => part.key === "draft").tokens, 0)
  const empty = store.agentContextUsage([])
  assert.equal(empty.breakdown.find(part => part.key === "messages").tokens, 0)
  assert.equal(empty.breakdown.find(part => part.key === "attachments").tokens, 0)
})
await check("Контекст обрезается по токенам выбранной модели", () => {
  const old = { role: "user", content: "x".repeat(130_000) }
  assert.equal(store.agentContextUsage([old]).trimmed, false)
  const trimmed = store.agentContextUsage([old], "Next", [], 24_000)
  assert.equal(trimmed.trimmed, true)
  assert.equal(trimmed.full, false)
  const full = store.agentContextUsage([old], "", [], 24_000)
  assert.equal(full.full, true)
  assert.equal(full.percent, 100)
})
await check("Замер контекста привязан к истории и провайдеру, новый хвост оценивается отдельно", () => {
  const messages = [{ role: "user", content: "Question" }, { role: "assistant", content: "Answer" }]
  const config = { model: "same-model", endpoint: "https://one.example/v1", protocol: "openai" }
  const measured = store.measureAgentContext(messages, 8000, config)
  const exact = store.agentContextUsage(messages, "", [], 256000, measured, config)
  assert.equal(exact.tokens, 8000)
  assert.equal(exact.approximate, false)
  const suffix = { role: "tool", content: "x".repeat(2000), tool_call_id: "c" }
  const next = store.agentContextUsage([...messages, suffix], "", [], 256000, measured, config)
  assert.equal(next.tokens, 8000 + store.estimateContextTokens([suffix]))
  assert.equal(next.approximate, true)
  for (const changed of [{ ...config, endpoint: "https://two.example/v1" }, { ...config, model: "other-model" }, { ...config, protocol: "anthropic" }]) {
    assert.equal(store.agentContextUsage(messages, "", [], 256000, measured, changed).tokens, store.agentContextUsage(messages, "", [], 256000, undefined, changed).tokens)
  }
  for (const replaced of [messages.slice(1), [{ ...messages[0], content: "Changed!" }, messages[1]]]) {
    assert.equal(store.agentContextUsage(replaced, "", [], 256000, measured, config).tokens, store.agentContextUsage(replaced, "", [], 256000, undefined, config).tokens)
  }
  const legacy = { model: config.model, tokens: 999999, estimatedTokens: 0 }
  assert.equal(store.agentContextUsage(messages, "", [], 256000, legacy, config).tokens, store.agentContextUsage(messages, "", [], 256000, undefined, config).tokens)
})
await check("Смена языка инструкций сбрасывает прежний замер контекста", async () => {
  const host = (await import("@xnlc/agent/host")).getAgentHost()
  const previous = host.language
  const messages = [{ role: "user", content: "Question" }]
  const measured = store.measureAgentContext(messages, 8000)
  try {
    host.language = () => "de"
    const actual = store.agentContextUsage(messages, "", [], 256000, measured)
    assert.equal(actual.approximate, true)
    assert.equal(actual.tokens, store.agentContextUsage(messages).tokens)
  } finally { host.language = previous }
})
await check("Переполнение не скрывается будущей обрезкой и учитывает замер провайдера", () => {
  const messages = [{ role: "user", content: "Small local text" }]
  const measured = store.measureAgentContext(messages, 30000)
  const overflow = store.agentContextUsage(messages, "", [], 24000, measured)
  assert.equal(overflow.tokens, 30000)
  assert.equal(overflow.full, true)
  const trimmed = store.agentContextUsage(messages, "Next", [], 24000, measured)
  assert.equal(trimmed.trimmed, true)
  assert.equal(trimmed.percent, 100)
  assert.ok(trimmed.tokens > 30000)
})
await check("Gemini не считает текст и вызовы дважды вместе с providerParts", () => {
  const parts = [{ text: "x".repeat(4000) }, { functionCall: { name: "get_project", args: { id: "test" } } }]
  const native = { role: "assistant", content: null, providerParts: parts }
  const duplicate = { ...native, content: parts[0].text, tool_calls: [{ id: "c", type: "function", function: { name: "get_project", arguments: '{"id":"test"}' } }] }
  assert.equal(store.estimateContextTokens([native], "gemini"), store.estimateContextTokens([duplicate], "gemini"))
  assert.equal(store.estimateContextTokens([{ ...duplicate, providerParts: undefined }], "openai"), store.estimateContextTokens([duplicate], "openai"))
})
await check("Подключённые схемы инструментов меняют оценку поверх последнего замера", () => {
  const messages = [{ role: "user", content: "Inspect server" }]
  const measured = store.measureAgentContext(messages, 20000)
  const next = [...messages,
    { role: "assistant", content: null, tool_calls: [{ id: "enable", type: "function", function: { name: "enable_tool_group", arguments: '{"group":"servers"}' } }] },
    { role: "tool", tool_call_id: "enable", content: '{"success":true,"enabledGroup":"servers"}' },
  ]
  const before = store.agentContextUsage(messages).tokens
  const after = store.agentContextUsage(next).tokens
  assert.ok(after - before > store.estimateContextTokens(next.slice(messages.length)))
  assert.equal(store.agentContextUsage(next, "", [], 256000, measured).tokens, 20000 + after - before)
})
await check("Отправка сохраняет сводку, недавний wire-контекст и новый замер", async () => {
  const previous = complete
  try {
    await store.newAgentChat()
    const chat = structuredClone(store.getAgentState().chat)
    chat.id = "compact-fixture"
    chat.messages = [{ role: "user", content: "x".repeat(1100000) }, { role: "assistant", content: "Old answer" }]
    chats.set(chat.id, chat)
    await store.selectAgentChat(chat.id)
    let outbound
    complete = async request => { if (request.purpose === "compact") return { text: "Цель: продолжить задачу. Ограничения пользователя сохранены.", calls: [] }; outbound = request; return { text: "Done", calls: [], usage: { prompt_tokens: 14000, completion_tokens: 20 } } }
    store.setAgentDraft("Continue")
    await store.sendAgentMessage()
    assert.ok(outbound.messages[0].content.includes("Сводка прежней беседы"))
    assert.equal(outbound.messages.at(-1).content, "Continue")
    const saved = store.getAgentState().chat
    assert.equal(saved.messages.length, outbound.messages.length + 1)
    assert.equal(saved.contextUsage.tokens, 14020)
    assert.equal(store.agentContextUsage(saved.messages, "", [], 256000, saved.contextUsage).tokens, 14020)
  } finally { complete = previous }
})
await check("Без выходного usage ответ оценивается отдельно от замеренного входа", async () => {
  const previous = complete
  try {
    await store.newAgentChat()
    complete = async () => ({ text: "x".repeat(4000), calls: [], usage: { prompt_tokens: 14000 } })
    store.setAgentDraft("Inspect")
    await store.sendAgentMessage()
    const chat = store.getAgentState().chat
    assert.equal(chat.contextUsage.messageCount, 1)
    const usage = store.agentContextUsage(chat.messages, "", [], 256000, chat.contextUsage)
    assert.equal(usage.tokens, 14000 + store.estimateContextTokens(chat.messages.slice(1)))
    assert.equal(usage.approximate, true)
  } finally { complete = previous }
})
await check("Сжатие не разрывает пакет из нескольких вызовов и не переносит base64 в сводку", () => {
  const messages = [
    { role: "user", content: "Keep version 1.21.1 and build:stable", images: [image] },
    { role: "assistant", content: null, tool_calls: ["a", "b"].map(id => ({ id, type: "function", function: { name: "get_project", arguments: "{}" } })) },
    { role: "tool", tool_call_id: "a", content: "x".repeat(12000) },
    { role: "tool", tool_call_id: "b", content: "y".repeat(12000) },
    { role: "assistant", content: "Done" }, { role: "user", content: "Continue" },
  ]
  const plan = store.prepareAgentCompaction(messages, 16000, store.estimateContextTokens)
  assert.ok(plan)
  assert.notEqual(plan.kept[0].role, "tool")
  assert.ok(!plan.transcript.includes("data:image"))
  assert.ok(plan.transcript.includes("1.21.1"))
  const pending = new Set()
  for (const msg of plan.kept) {
    for (const call of msg.tool_calls || []) pending.add(call.id)
    if (msg.role === "tool") { assert.ok(pending.has(msg.tool_call_id)); pending.delete(msg.tool_call_id) }
  }
  assert.equal(pending.size, 0)
})
await check("Ошибка сжатия сохраняет исходную историю и не отправляет неполный обычный запрос", async () => {
  const previous = complete
  try {
    await store.newAgentChat()
    const chat = structuredClone(store.getAgentState().chat)
    chat.id = "compact-failure"
    chat.messages = [{ role: "user", content: "x".repeat(1100000) }, { role: "assistant", content: "Old answer" }]
    chats.set(chat.id, chat); await store.selectAgentChat(chat.id)
    let normal = 0
    complete = async request => { if (request.purpose === "compact") throw new Error("Summary failed"); normal++; return { text: "Unexpected", calls: [] } }
    store.setAgentDraft("Continue"); await store.sendAgentMessage()
    assert.equal(normal, 0)
    assert.equal(store.getAgentState().chat.messages[0].content, chat.messages[0].content)
    assert.equal(store.getAgentState().chat.messages.at(-1).content, "Continue")
    assert.ok(store.getAgentState().error.includes("Summary failed"))
  } finally { complete = previous }
})
await check("После сводки сохраняются подключённые группы инструментов", async () => {
  const previous = complete
  try {
    await store.newAgentChat()
    const chat = structuredClone(store.getAgentState().chat)
    chat.id = "compact-groups"; chat.toolGroups = ["content"]
    chat.messages = [{ role: "user", content: "x".repeat(1100000) }, { role: "assistant", content: "Old answer" }]
    chats.set(chat.id, chat); await store.selectAgentChat(chat.id)
    let outbound
    complete = async request => { if (request.purpose === "compact") { assert.equal(request.tools.length, 0); return { text: "Цель и ограничения прежней задачи.", calls: [] } }; outbound = request; return { text: "Done", calls: [] } }
    store.setAgentDraft("Continue"); await store.sendAgentMessage()
    assert.ok(outbound.tools.some(tool => tool.function.name === "get_project"))
    assert.ok(store.getAgentState().chat.toolGroups.includes("content"))
  } finally { complete = previous }
})
await check("Переполнение провайдера вызывает только одно сжатие и повтор без повторных действий", async () => {
  const previous = complete
  try {
    await store.newAgentChat()
    const chat = structuredClone(store.getAgentState().chat)
    chat.id = "overflow-retry"
    chat.messages = [{ role: "user", content: "x".repeat(20000) }, { role: "assistant", content: "Old answer" }]
    chats.set(chat.id, chat); await store.selectAgentChat(chat.id)
    let normal = 0, summaries = 0
    complete = async request => { if (request.purpose === "compact") { summaries++; return { text: "Цель и ограничения прежней задачи.", calls: [] } }; normal++; throw new Error("maximum context length exceeded") }
    store.setAgentDraft("Continue"); await store.sendAgentMessage()
    assert.equal(summaries, 1)
    assert.equal(normal, 2)
    assert.ok(store.getAgentState().error.includes("maximum context"))
  } finally { complete = previous }
})
await check("Остановка во время сжатия не заменяет исходную историю поздним ответом", async () => {
  const previous = complete
  try {
    await store.newAgentChat()
    const chat = structuredClone(store.getAgentState().chat)
    chat.id = "compact-cancel"
    chat.messages = [{ role: "user", content: "x".repeat(1100000) }, { role: "assistant", content: "Old answer" }]
    chats.set(chat.id, chat); await store.selectAgentChat(chat.id)
    let release
    complete = request => { assert.equal(request.purpose, "compact"); return new Promise(resolve => { release = resolve }) }
    store.setAgentDraft("Continue")
    const run = store.sendAgentMessage()
    await until(() => typeof release === "function")
    await store.stopAgent()
    release({ text: "Late summary", calls: [] })
    await run
    assert.equal(store.getAgentState().chat.messages[0].content, chat.messages[0].content)
    assert.equal(store.getAgentState().chat.messages.at(-1).content, "Continue")
    assert.ok(store.getAgentState().chat.timeline.some(item => item.toolName === "compact_context" && item.status === "denied"))
  } finally { complete = previous }
})
await check("Восстановление незавершённого инструмента не запускает его повторно", async () => {
  const chat=structuredClone(store.getAgentState().chat)
  chat.id="recover-chat"
  chat.messages=[{role:"user",content:"Change memory"},{role:"assistant",content:null,tool_calls:[{id:"pending-call",type:"function",function:{name:"set_build_memory",arguments:"{}"}}]}]
  chat.timeline=[{id:"pending-item",kind:"tool",toolName:"set_build_memory",text:"",status:"approval"}]
  chats.set(chat.id,chat)
  await store.selectAgentChat(chat.id)
  const restored=store.getAgentState().chat
  assert.equal(restored.timeline[0].status,"denied")
  assert.equal(restored.messages.at(-1).tool_call_id,"pending-call")
  assert.equal(memoryWrites,2)
})
await check("Большие вложения ограничены в контексте, оригиналы сохранены в чате", async () => {
  let outbound
  complete=async request=>{outbound=request;return {text:"Прочитано",calls:[]}}
  await store.newAgentChat()
  for(let i=0;i<8;i++)store.attachToAgent({id:`file-${i}`,kind:"file",name:`file-${i}.log`,content:"x".repeat(40000)})
  store.setAgentDraft("Изучи файлы")
  await store.sendAgentMessage()
  assert.ok(outbound.messages.at(-1).content.length<90000)
  assert.equal(store.getAgentState().chat.timeline[0].attachments[0].content.length,40000)
})
await check("Интерактивный вопрос: проверка вариантов и свободного ввода", () => {
  const ask = tool("ask_user")
  assert.deepEqual(parseToolInput(ask, JSON.stringify({ question: "Какой загрузчик?", options: ["Fabric", "Forge"] })).options, ["Fabric", "Forge"])
  assert.equal(parseToolInput(ask, JSON.stringify({ question: "Название сборки?" })).question, "Название сборки?")
  for (const options of [["Fabric"], ["Fabric", "Fabric"], ["Fabric", 12], ["Fabric", ""], Array.from({ length: 7 }, (_, index) => String(index))]) assert.throws(() => parseToolInput(ask, JSON.stringify({ question: "Выбор?", options })), /Invalid options/)
})
const beforeQuestionComplete = complete
await check("Вопрос ждёт ответа даже в авторежиме и передаёт результат модели", async () => {
  await store.newAgentChat(); store.setAgentMode("auto")
  let requests = 0
  complete = async request => {
    requests++
    if (request.messages.at(-1).role === "tool") {
      assert.equal(JSON.parse(request.messages.at(-1).content).answer, "Fabric")
      return { text: "Выбран Fabric", calls: [] }
    }
    return { text: "", calls: [{ id: "question-call", type: "function", function: { name: "ask_user", arguments: JSON.stringify({ question: "Какой загрузчик?", options: ["Fabric", "Forge"] }) } }] }
  }
  store.setAgentDraft("Какой загрузчик выбрать?")
  const run = store.sendAgentMessage()
  await until(() => store.getAgentState().questionId)
  const questionId = store.getAgentState().questionId
  assert.equal(requests, 1)
  store.answerAgentQuestion("old-question", "Forge")
  store.answerAgentQuestion(questionId, " ")
  assert.equal(store.getAgentState().questionId, questionId)
  store.answerAgentQuestion(questionId, "Fabric")
  await run
  assert.equal(requests, 2)
  assert.equal(store.getAgentState().questionId, null)
  const item = store.getAgentState().chat.timeline.find(item => item.id === questionId)
  assert.equal(item.status, "done")
  assert.equal(JSON.parse(item.output).answer, "Fabric")
})
await check("Остановка интерактивного вопроса не выбирает ответ за пользователя", async () => {
  await store.newAgentChat()
  let requests = 0
  complete = async () => { requests++; return { text: "", calls: [{ id: "free-question", type: "function", function: { name: "ask_user", arguments: JSON.stringify({ question: "Как назвать сборку?" }) } }] } }
  store.setAgentDraft("Подскажи название сборки")
  const run = store.sendAgentMessage()
  await until(() => store.getAgentState().questionId)
  await store.stopAgent(); await run
  assert.equal(requests, 1)
  assert.equal(store.getAgentState().running, false)
  assert.equal(store.getAgentState().questionId, null)
  const item = store.getAgentState().chat.timeline.find(item => item.toolName === "ask_user")
  assert.equal(item.status, "denied")
  assert.ok(!JSON.parse(item.output).answer)
})
complete = beforeQuestionComplete
await check("Архив сохраняет черновик, вложения и не оживает от debounce", async () => {
  await store.newAgentChat()
  store.setAgentDraft("Незавершённый вопрос")
  store.attachToAgent({ id: "keep-file", kind: "file", name: "latest.log", content: "Log content" })
  const chatId = store.getAgentState().chat.id
  await store.archiveAgentChat(chatId, true)
  assert.notEqual(store.getAgentState().chat.id, chatId)
  await new Promise(resolve => setTimeout(resolve, 400))
  assert.equal(chats.get(chatId).archived, true)
  assert.equal(chats.get(chatId).draft, "Незавершённый вопрос")
  assert.equal(chats.get(chatId).attachments[0].content, "Log content")
  await store.selectAgentChat(chatId)
  assert.equal(store.getAgentState().chat.archived, true)
  const messageCount = store.getAgentState().chat.messages.length
  await store.sendAgentMessage()
  assert.equal(store.getAgentState().chat.messages.length, messageCount)
  await store.archiveAgentChat(chatId, false)
  assert.equal(store.getAgentState().chat.archived, false)
  assert.equal(chats.get(chatId).archived, false)
  assert.equal(store.getAgentState().chat.draft, "Незавершённый вопрос")
})

const vm = await import("node:vm")
const archiveDb = new (require("better-sqlite3"))(":memory:")
archiveDb.exec("CREATE TABLE agent_chats (id TEXT PRIMARY KEY, title TEXT NOT NULL, updatedAt INTEGER NOT NULL, data TEXT NOT NULL); PRAGMA user_version = 7")
let databaseAvailable = true
const dbCore = { queryAll: (sql, params = []) => archiveDb.prepare(sql).all(...params), run: (sql, params = []) => archiveDb.prepare(sql).run(...params), transaction: fn => archiveDb.transaction(fn)(), setUserVersion: value => archiveDb.pragma(`user_version = ${value}`), DB_FORMAT_VERSION: 1, isDbAvailable: () => databaseAvailable }
const migrationModule = { exports: {} }
vm.runInNewContext(await fs.readFile(new URL("../dist-electron/db/migrations.js", import.meta.url), "utf8"), { exports: migrationModule.exports, require: name => { assert.equal(name, "./core"); return dbCore }, console })
await check("Миграция существующей БД добавляет архив и повышает версию схемы", () => {
  migrationModule.exports.initializeSchema()
  assert.ok(archiveDb.pragma("table_info(agent_chats)").some(column => column.name === "archived"))
  assert.equal(archiveDb.pragma("user_version", { simple: true }), migrationModule.exports.SCHEMA_VERSION)
})
async function archiveHandlers() {
  const handlers = new Map()
  const workspaceModule = { exports: {} }
  const imports = { electron: { ipcMain: { handle: (name, handler) => handlers.set(name, handler) } }, "../db/core": dbCore, "../db": { dbHelpers: {} }, "./builds/helpers": {}, "./agent-protocol": {}, "./ai-providers": {} }
  vm.runInNewContext(await fs.readFile(new URL("../dist-electron/main/agent-workspace.js", import.meta.url), "utf8"), { exports: workspaceModule.exports, require: name => name in imports ? imports[name] : require(name), Buffer, structuredClone, console })
  workspaceModule.exports.registerAgentWorkspace(async () => null)
  return handlers
}
await check("Архив SQLite и fallback: сохранение, перезагрузка, восстановление", async () => {
  for (const available of [true, false]) {
    databaseAvailable = available
    let handlers = await archiveHandlers()
    const chat = { id: "archived-chat", title: "Archive", updatedAt: 42, draft: "Keep draft", attachments: [], timeline: [{ id: "m", kind: "user", text: "Keep history" }], messages: [{ role: "user", content: "Keep history" }], mode: "confirm" }
    handlers.get("agent:save-chat")(null, chat)
    handlers.get("agent:set-archived")(null, chat.id, true)
    if (available) handlers = await archiveHandlers()
    assert.equal(handlers.get("agent:list-chats")()[0].archived, true)
    const archived = handlers.get("agent:get-chat")(null, chat.id)
    assert.equal(archived.archived, true)
    assert.equal(archived.timeline[0].text, "Keep history")
    handlers.get("agent:save-chat")(null, archived)
    assert.equal(handlers.get("agent:list-chats")()[0].archived, true)
    handlers.get("agent:set-archived")(null, chat.id, false)
    assert.equal(handlers.get("agent:get-chat")(null, chat.id).archived, false)
    assert.equal(handlers.get("agent:get-chat")(null, chat.id).draft, "Keep draft")
    assert.throws(() => handlers.get("agent:set-archived")(null, chat.id, "true"), /Invalid archived/)
    assert.throws(() => handlers.get("agent:set-archived")(null, "missing", true), /Chat not found/)
  }
})
archiveDb.close()
await check("Страница агента инициализируется с непустой историей и архивом", async () => {
  const page = await fs.readFile(new URL("../components/launcher/agent/agent-page.tsx", import.meta.url), "utf8")
  const start = page.indexOf("export function AgentPage() {")
  const end = page.indexOf("  useEffect(() =>", start)
  const initializer = page.slice(start, end).replace("export function AgentPage()", "function initializePage()") + "return { visibleChats, archivedCount, showArchive }; }"
  const initializePage = new Function("useTranslation", "useAgentState", "useState", "useRef", "useContentEnter", stripTypeScriptTypes(initializer) + "; return initializePage;")(
    () => ({ t: value => value, i18n: { language: "ru" } }),
    () => ({ chats: [{ id: "active", archived: false }, { id: "archived", archived: true }], chat: null, running: false }),
    value => [value, () => {}], value => ({ current: value }),
    () => "",
  )
  const result = initializePage()
  assert.deepEqual(result.visibleChats.map(chat => chat.id), ["active"])
  assert.equal(result.archivedCount, 1)
  assert.equal(result.showArchive, false)
})
await check("IPC настроек сохраняет выбранные модели, контекст и изображения", async () => {
  const settings = new Map(), handlers = new Map(), module = { exports: {} }
  const imports = { electron: { ipcMain: { handle: (name, handler) => handlers.set(name, handler) }, safeStorage: { isEncryptionAvailable: () => true, encryptString: value => Buffer.from(value), decryptString: value => value.toString() } }, "../db": { dbHelpers: { getSetting: async key => settings.get(key), setSetting: async (key,value) => settings.set(key,value) } }, "./runtime": {}, "./agent-workspace": { registerAgentWorkspace: () => {} }, "./ai-providers": { providerHeaders, providerRequest, providerResult, validateProviderKey }, "./ai-model-config": { readModelConfigs, validateModelConfigs } }
  let responsePayload = {}, fetched = []
  vm.runInNewContext(await fs.readFile(new URL("../dist-electron/main/ai-agent.js", import.meta.url), "utf8"), { exports: module.exports, require: name => name in imports ? imports[name] : require(name), Buffer, URL, AbortSignal, console, fetch: async (url, init) => { fetched.push({ url: String(url), headers: init.headers }); const payload = typeof responsePayload === "function" ? responsePayload(new URL(url)) : responsePayload; return { ok: true, json: async () => payload } } })
  module.exports.registerAiAgent()
  const original = await handlers.get("ai:get-config")()
  assert.equal(original.models[0].contextWindow, 256000)
  const config = { apiKey: "secret-test", endpoint: "https://provider.example/v1", protocol: "anthropic", model: "custom", models: [{ id: "custom", contextWindow: 128000, supportsImages: true }, { id: "other", contextWindow: 256000, supportsImages: false }] }
  await handlers.get("ai:save-config")(null, config)
  const restored = await handlers.get("ai:get-config")()
  assert.deepEqual(JSON.parse(JSON.stringify(restored)), config)
  assert.notEqual(settings.get("aiApiKey"), "secret-test")
  await assert.rejects(handlers.get("ai:save-config")(null, { ...config, model: "disabled" }), /enabled model/)
  responsePayload = url => url.searchParams.get("after_id") ? { data: [{ id: "second" }], has_more: false } : { data: [{ id: "first" }], has_more: true, last_id: "first" }
  const discovered = await handlers.get("ai:list-models")(null, { ...config })
  assert.deepEqual(Array.from(discovered.models), ["first", "second"])
  assert.equal(fetched[0].headers["x-api-key"], "secret-test")
  assert.ok(fetched[1].url.includes("after_id=first"))
  responsePayload = url => url.searchParams.get("pageToken") ? { models: [{ name: "models/second" }] } : { models: [{ name: "models/first" }], nextPageToken: "next" }
  fetched = []
  const gemini = await handlers.get("ai:list-models")(null, { apiKey: "gemini-key", endpoint: "https://gemini.example/v1beta", protocol: "gemini" })
  assert.equal(gemini.models.length, 2)
  assert.equal(fetched[0].headers["x-goog-api-key"], "gemini-key")
  assert.ok(fetched[1].url.includes("pageToken=next"))
  responsePayload = { models: [{ name: "local-model" }] }; fetched = []
  const ollama = await handlers.get("ai:list-models")(null, { apiKey: "", endpoint: "http://localhost:11434", protocol: "ollama" })
  assert.equal(ollama.models[0], "local-model")
  assert.ok(fetched[0].url.endsWith("/api/tags"))
  assert.equal(fetched[0].headers.Authorization, undefined)
})
await check("Изображения отправляются только модели с включённой поддержкой", async () => {
  runtimeApi.getAiConfig = async () => ({ apiKey: "test", endpoint: "https://test.example/v1", protocol: "openai", model: "vision", models: [{ id: "vision", contextWindow: 256000, supportsImages: false }] })
  await store.newAgentChat()
  store.attachToAgent({ id: "img", kind: "file", name: "test.png", content: "Image", imageUrl: image })
  store.setAgentDraft("Inspect")
  let outbound
  complete = async request => { outbound = request; return { text: "Image received", calls: [], usage: { prompt_tokens: 1000, completion_tokens: 20 } } }
  await store.sendAgentMessage()
  assert.equal(outbound, undefined)
  assert.equal(store.getAgentState().chat.attachments.length, 1)
  const getConfig = runtimeApi.getAiConfig
  runtimeApi.getAiConfig = async () => { const config = await getConfig(); config.models[0].supportsImages = true; return config }
  await store.sendAgentMessage()
  assert.equal(outbound.messages.at(-1).images[0], image)
  assert.equal(store.getAgentState().chat.contextUsage.tokens, 1020)
  assert.equal(store.getAgentState().chat.contextUsage.model, "vision")
  delete runtimeApi.getAiConfig
})
await check("Расширенный каталог больше втрое и подключает группы в пределах лимита провайдера", async () => {
  assert.ok(AGENT_TOOLS.length >= 168)
  const base = getAgentTurnTools([])
  assert.equal(base.length, 4)
  assert.ok(base.some(tool => tool.name === "update_plan"))
  assert.ok(base.some(tool => tool.name === "enable_tool_group"))
  assert.ok(!base.some(tool => tool.name === "get_hardware"))
  assert.ok(!base.some(tool => tool.name === "unlock_build"))
  assert.ok(!base.some(tool => tool.name === "set_theme_background"))
  for (const group of new Set(AGENT_TOOLS.map(tool => tool.group).filter(Boolean))) {
    assert.ok(getAgentTurnTools([], [group]).some(tool => tool.group === group), group)
  }
  const messages = []
  for (const group of ["builds", "versions", "content", "hardware", "settings", "themes", "theme_colors", "server_settings"]) {
    const id = "enable-" + group
    messages.push({ role: "assistant", content: null, tool_calls: [{ id, function: { name: "enable_tool_group", arguments: JSON.stringify({ group }) } }] })
    messages.push({ role: "tool", tool_call_id: id, content: JSON.stringify(await tool("enable_tool_group").run({}, { group })) })
    assert.ok(getAgentTurnTools(messages).length <= 128)
    assert.ok(JSON.stringify(getAgentTurnTools(messages).map(tool => tool.spec)).length <= 24000)
    assert.ok(getAgentTurnTools(messages).some(tool => tool.group === group))
  }
  assert.equal(getAgentTurnTools([{ role: "tool", tool_call_id: "fake", content: '{"success":true,"enabledGroup":"themes"}' }]).length, base.length)
})
await check("Смена языка и темы использует реальные настройки и проверяет ID темы", async () => {
  const settings = new Map(), api = { getSetting: async key => settings.get(key), setSetting: async(key,value) => settings.set(key,value) }
  const available = await tool("list_themes").run(api,{})
  assert.ok(available.some(theme => theme.id === "rose"))
  await tool("set_theme").run(api,{themeId:"rose"})
  assert.equal(settings.get("theme"),"rose")
  await tool("set_language").run(api,{language:"en"})
  assert.equal(settings.get("language"),"en")
  await assert.rejects(tool("set_theme").run(api,{themeId:"missing-theme"}),/Theme not found/)
  await assert.rejects(tool("set_language").run(api,{language:"missing-language"}))
  assert.equal(settings.get("language"),"en")
})
await check("Редактирование пресета создаёт собственную тему и сохраняет все правки", async () => {
  const settings = new Map(), api = { getSetting: async key => settings.get(key), setSetting: async(key,value) => settings.set(key,value) }
  const first = await tool("set_theme_background").run(api,{color:"#112233"})
  assert.notEqual(first.themeId,"orange")
  assert.equal(settings.get("theme"),first.themeId)
  await tool("set_theme_foreground").run(api,{themeId:first.themeId,color:"#eeeeee"})
  const theme = await tool("get_theme").run(api,{themeId:first.themeId})
  assert.equal(theme.palette.background,"#112233")
  assert.equal(theme.palette.foreground,"#eeeeee")
  await assert.rejects(tool("set_theme_radius").run(api,{radius:999}))
  await assert.rejects(tool("set_theme_background").run(api,{color:"url(secret)"}))
})
await check("Рекомендации используют реальное железо и не изменяют настройки", async () => {
  const hardware = { memory:{totalBytes:16*1024**3},cpu:{model:"CPU",logicalCores:8},gpu:[{name:"GPU"}] }
  const api = { agentHardware: async()=>hardware,getSetting: async()=>undefined }
  const result = await tool("recommend_launcher_settings").run(api,{})
  assert.equal(result.hardware,hardware)
  assert.equal(result.recommended.memoryMax,"8192M")
  assert.equal(result.recommended.memoryMin,"512M")
})
await check("Настройки сервера сохраняют посторонние параметры, проверяют диапазоны и не раскрывают пароли", async () => {
  let written
  const api = { mcServerGet:async()=>({id:"srv",name:"Server",rconPassword:"secret"}),mcServerReadProperties:async()=>({"rcon.password":"secret","difficulty":"normal"}),mcServerWriteProperties:async(_id,value)=>{written=value} }
  await tool("set_server_difficulty").run(api,{serverId:"srv",value:"hard"})
  assert.equal(written.difficulty,"hard")
  assert.equal(written["rcon.password"],"secret")
  const details = await tool("get_server_details").run(api,{serverId:"srv"})
  assert.ok(!JSON.stringify(details).includes("secret"))
  await assert.rejects(tool("set_server_view_distance").run(api,{serverId:"srv",value:1000}))
})
await check("У связанного модпака без явного locked:false изменения тоже заблокированы", async () => {
  const api=mockApi();api.loadBuildsLight=async()=>[{...target,source:"modrinth"}]
  await assert.rejects(tool("toggle_content").run(api,{buildId:"build",type:"mod",fileName:"mod.jar",enabled:false}),/BUILD_LOCKED/)
  await assert.rejects(tool("write_build_config").run(api,{buildId:"build",path:"options.txt",content:"x"}),/BUILD_LOCKED/)
  assert.equal(api.calls.length,0)
})
await check("Разблокировка в авторежиме ждёт интерактивного согласия и затем продолжает задачу", async () => {
  const oldList=runtimeApi.loadBuildsLight,oldUpdate=runtimeApi.updateBuildFields
  let build={...target,source:"modrinth",locked:true},writes=[]
  runtimeApi.loadBuildsLight=async()=>[build]
  runtimeApi.updateBuildFields=async(_id,patch)=>{writes.push(patch);build={...build,...patch}}
  await store.newAgentChat();store.setAgentMode("auto");store.setAgentDraft("Измени сборку")
  complete=async request=>{
    const last=request.messages.at(-1)
    if(last.role==="user")return{text:"",calls:[{id:"unlock",type:"function",function:{name:"unlock_build",arguments:'{"buildId":"build"}'}}]}
    if(last.tool_call_id==="unlock")return{text:"",calls:[{id:"modify",type:"function",function:{name:"set_build_group",arguments:'{"buildId":"build","value":"Optimized"}'}}]}
    return{text:"Готово",calls:[]}
  }
  const run=store.sendAgentMessage()
  await until(()=>store.getAgentState().questionId)
  assert.equal(writes.length,0)
  store.answerAgentQuestion(store.getAgentState().questionId,"да")
  await run
  assert.equal(build.locked,false)
  assert.equal(build.group,"Optimized")
  assert.equal(writes.length,2)
  runtimeApi.loadBuildsLight=oldList;runtimeApi.updateBuildFields=oldUpdate
})
await check("Отказ от разблокировки не меняет сборку и не вызывает повторный вопрос", async () => {
  const oldList=runtimeApi.loadBuildsLight,oldUpdate=runtimeApi.updateBuildFields
  let writes=0,turn=0
  runtimeApi.loadBuildsLight=async()=>[{...target,source:"modrinth",locked:true}]
  runtimeApi.updateBuildFields=async()=>{writes++}
  await store.newAgentChat();store.setAgentMode("auto");store.setAgentDraft("Измени сборку")
  complete=async()=>++turn<=2?{text:"",calls:[{id:"unlock-"+turn,type:"function",function:{name:"unlock_build",arguments:'{"buildId":"build"}'}}]}:{text:"Оставляю заблокированной",calls:[]}
  const run=store.sendAgentMessage()
  await until(()=>store.getAgentState().questionId)
  store.answerAgentQuestion(store.getAgentState().questionId,"нет")
  await run
  assert.equal(writes,0)
  assert.equal(store.getAgentState().chat.timeline.filter(item=>item.toolName==="ask_user").length,1)
  assert.equal(store.getAgentState().chat.timeline.filter(item=>item.toolName==="unlock_build"&&item.status==="denied").length,2)
  runtimeApi.loadBuildsLight=oldList;runtimeApi.updateBuildFields=oldUpdate
})
await check("Прямое изменение заблокированной сборки автоматически спрашивает и продолжает после согласия", async () => {
  const oldList=runtimeApi.loadBuildsLight,oldUpdate=runtimeApi.updateBuildFields
  let build={...target,source:"modrinth",locked:true},writes=[]
  runtimeApi.loadBuildsLight=async()=>[build]
  runtimeApi.updateBuildFields=async(_id,patch)=>{writes.push(patch);build={...build,...patch}}
  await store.newAgentChat();store.setAgentMode("auto");store.setAgentDraft("Настрой окно сборки")
  complete=async request=>request.messages.at(-1).role==="user"?{text:"",calls:[{id:"modify-direct",type:"function",function:{name:"set_build_window_width",arguments:'{"buildId":"build","value":1280}'}}]}:{text:"Готово",calls:[]}
  const run=store.sendAgentMessage()
  await until(()=>store.getAgentState().questionId)
  assert.equal(writes.length,0)
  store.answerAgentQuestion(store.getAgentState().questionId,"да")
  await run
  assert.equal(build.locked,false)
  assert.equal(build.windowWidth,1280)
  assert.equal(writes.length,2)
  runtimeApi.loadBuildsLight=oldList;runtimeApi.updateBuildFields=oldUpdate
})
console.log(`\nПроверок пройдено: ${passed}`)
