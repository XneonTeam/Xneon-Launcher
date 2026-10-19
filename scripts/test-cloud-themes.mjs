import assert from "node:assert/strict"
import fs from "node:fs/promises"
import path from "node:path"
import vm from "node:vm"
import { createHash } from "node:crypto"
import { createRequire } from "node:module"
import { pathToFileURL } from "node:url"
const require = createRequire(import.meta.url)
const AdmZip = require("adm-zip")
const { createThemeBundle, restoreThemeBundle, readThemeBundlePreview } = require("../dist-electron/main/cloud/theme-bundle.js")
const root = path.resolve(import.meta.dirname, "..", ".tmp")
await fs.mkdir(root, { recursive: true })
const directory = await fs.mkdtemp(path.join(root, "cloud-themes-"))
let passed = 0
const check = async (name, callback) => { await callback(); passed++; console.log("✓ " + name) }
const media = path.join(directory, "userData/theme-media")
await fs.mkdir(media, { recursive: true })
await fs.mkdir(path.join(directory, "temp"), { recursive: true })
const bytes = Buffer.from("theme-font-fixture")
const asset = createHash("sha256").update(bytes).digest("hex") + ".woff2"
const source = "xnl-theme://asset/" + asset
await fs.writeFile(path.join(media, asset), bytes)
const theme = { id: "custom-test", name: "Моя тема", primary: "#123456", accent: "#abcdef", palette: { background: "#112233" }, font: { family: "XneonThemeFont", source, size: 17 }, background: { kind: "halo", source: "", opacity: 0 }, css: `@font-face { font-family: Test; src: url("${source}"); }`, custom: true }
let bundle
try {
  await check("Архив сохраняет настройки и локальные медиа с удалением посторонних полей", async () => {
    bundle = await createThemeBundle({ ...theme, unrelatedSecret: "not-theme-data" }, media)
    const zip = new AdmZip(bundle)
    assert.ok(zip.getEntry("assets/" + asset))
    assert.equal(JSON.parse(zip.readAsText("theme.json")).theme.unrelatedSecret, undefined)
    const restored = await restoreThemeBundle(bundle, path.join(directory, "restored"))
    assert.deepEqual(restored, theme)
    assert.deepEqual(await fs.readFile(path.join(directory, "restored", asset)), bytes)
  })
  await check("Старые локальные пути преобразуются в переносимые ссылки без изменения исходной темы", async () => {
    const file = path.join(directory, "background.png")
    await fs.writeFile(file, Buffer.from("image-fixture"))
    const original = { ...theme, background: { kind: "image", source: file, fit: "contain" }, css: `:root { --icon-image: url("${pathToFileURL(file).href}"); }` }
    const restored = await restoreThemeBundle(await createThemeBundle(original, media), path.join(directory, "legacy"))
    assert.ok(restored.background.source.startsWith("xnl-theme://asset/"))
    assert.equal(original.background.source, file)
    assert.ok(!restored.css.includes("file:"))
  })
  await check("Превью читает палитру без медиа и исполняемого CSS", async () => {
    const preview = readThemeBundlePreview(bundle)
    assert.deepEqual(preview, { id: theme.id, name: theme.name, primary: theme.primary, accent: theme.accent, palette: theme.palette })
    const zip = new AdmZip(bundle)
    zip.deleteFile("assets/" + asset)
    assert.deepEqual(readThemeBundlePreview(zip.toBuffer()), preview)
    assert.throws(() => readThemeBundlePreview(new AdmZip().toBuffer()), /manifest/)
  })
  await check("Повреждённый манифест и неподдерживаемая версия архива отклоняются", async () => {
    const zip = new AdmZip(); zip.addFile("theme.json", Buffer.from(JSON.stringify({ format: "xneon-theme", version: 99, theme })))
    await assert.rejects(restoreThemeBundle(zip.toBuffer(), media), /Unsupported/)
    await assert.rejects(restoreThemeBundle(new AdmZip().toBuffer(), media), /manifest/)
    await assert.rejects(createThemeBundle({ ...theme, primary: "invalid" }, media), /colors/)
  })
  await check("Пути вне assets и несовпадающий хеш не извлекаются", async () => {
    const zip = new AdmZip(bundle); zip.addFile("outside.txt", Buffer.from("invalid"))
    await assert.rejects(restoreThemeBundle(zip.toBuffer(), media), /path/)
    zip.deleteFile("outside.txt"); zip.updateFile("assets/" + asset, Buffer.from("changed"))
    await assert.rejects(restoreThemeBundle(zip.toBuffer(), media), /checksum/)
  })
  await check("Архив не может скрыть отсутствие используемого шрифта", async () => {
    const zip = new AdmZip(bundle); zip.deleteFile("assets/" + asset)
    await assert.rejects(restoreThemeBundle(zip.toBuffer(), media), /missing referenced/)
  })
  const handlers = new Map(), events = [], uploads = new Map()
  const settings = new Map([["customThemes", JSON.stringify([theme])]])
  let connected = true
  const provider = {
    isAuthenticated: async () => connected, ensureBaseFolder: async () => {},
    uploadFile: async (file, remote, onProgress) => { uploads.set(remote, await fs.readFile(file)); onProgress(50); return { success: true, name: remote } },
    downloadFile: async (remote, file) => { if (!uploads.has(remote)) return { success: false, error: "not found" }; await fs.writeFile(file, uploads.get(remote)); return { success: true } },
  }
  const module = { exports: {} }
  const imports = {
    electron: { ipcMain: { handle: (name, handler) => handlers.set(name, handler) }, app: { getPath: key => path.join(directory, key) } },
    "../../db": { dbHelpers: { getSetting: async key => settings.get(key), setSetting: async (key, value) => settings.set(key, value) } },
    "../runtime": { sendToRenderer: (channel, value) => events.push({ channel, value }) },
    "../errors": { opFailure: error => ({ success: false, error: error.message }) },
    "./registry": { getProvider: () => provider },
    "./theme-bundle": { createThemeBundle, restoreThemeBundle, readThemeBundlePreview },
  }
  vm.runInNewContext(await fs.readFile(new URL("../dist-electron/main/cloud/theme-handlers.js", import.meta.url), "utf8"), { module, exports: module.exports, require: id => imports[id] ?? require(id), console, Buffer })
  module.exports.registerCloudThemeHandlers()
  await check("IPC загружает только сохранённую тему и публикует реальный прогресс", async () => {
    const result = await handlers.get("cloud:upload-theme")({}, "test", theme.id, "progress-id")
    assert.equal(result.success, true)
    assert.ok([...uploads.keys()][0].startsWith("themes/"))
    assert.ok(events.some(event => event.channel === "cloud:upload-progress" && event.value.id === "progress-id" && event.value.percent === 100))
    assert.equal((await handlers.get("cloud:upload-theme")({}, "test", "missing")).success, false)
    assert.deepEqual(await fs.readdir(path.join(directory, "temp")), [])
  })
  await check("Восстановление возвращает медиа, сохраняет копию темы и обновляет интерфейс", async () => {
    await fs.unlink(path.join(media, asset))
    const result = await handlers.get("cloud:import-theme")({}, "test", [...uploads.keys()][0])
    assert.equal(result.success, true)
    assert.notEqual(result.id, theme.id)
    assert.deepEqual(await fs.readFile(path.join(media, asset)), bytes)
    assert.equal(JSON.parse(settings.get("customThemes")).length, 2)
    assert.ok(events.some(event => event.channel === "settings:updated" && event.value.key === "customThemes"))
  })
  await check("Параллельные восстановления не перезаписывают существующие темы", async () => {
    const remote = [...uploads.keys()][0]
    const results = await Promise.all([handlers.get("cloud:import-theme")({}, "test", remote), handlers.get("cloud:import-theme")({}, "test", remote)])
    assert.ok(results.every(result => result.success))
    const themes = JSON.parse(settings.get("customThemes"))
    assert.equal(themes.length, 4)
    assert.equal(new Set(themes.map(theme => theme.id)).size, 4)
  })
  await check("Ошибка облака не изменяет список тем; отключённый провайдер не загружает файл", async () => {
    const previous = settings.get("customThemes")
    assert.equal((await handlers.get("cloud:import-theme")({}, "test", "missing")).success, false)
    assert.equal(settings.get("customThemes"), previous)
    connected = false
    assert.equal((await handlers.get("cloud:upload-theme")({}, "test", theme.id)).success, false)
  })
  console.log(`Проверок облачных тем пройдено: ${passed}`)
} finally {
  if (!directory.startsWith(root + path.sep)) throw new Error("Invalid test directory")
  await fs.rm(directory, { recursive: true, force: true })
}
