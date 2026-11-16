import fs from "node:fs/promises"
import path from "node:path"
import { createHash, randomUUID } from "node:crypto"

type Family = "classic" | "numeric" | "keyboard" | "graphics" | "split"
type State = { schema: 1; active: string; family: Family }
export type OptionsTransaction = { commit(): Promise<void>; rollback(): Promise<void> }
const digest = (value: string | Buffer) => createHash("sha256").update(value).digest("hex")

export function optionsFamily(version: string): Family | null {
  const release = /^(1)\.(\d+)(?:\.\d+)?$|^(26)\.(\d+)(?:\.\d+)?$/.exec(version)
  if (!release) return null
  if (release[3]) return Number(release[4]) >= 3 ? "split" : "graphics"
  const minor = Number(release[2])
  return minor < 1 ? null : minor < 7 ? "classic" : minor < 13 ? "numeric" : minor < 16 ? "keyboard" : "graphics"
}

function fields(text: string): Map<string, string> {
  const result = new Map<string, string>()
  for (const line of text.split(/\r?\n/)) {
    const colon = line.indexOf(":")
    if (colon > 0 && !line.includes("\0")) result.set(line.slice(0, colon), line.slice(colon + 1))
  }
  return result
}

function inferFamily(text: string): Family | null {
  const values = fields(text)
  if (values.has("graphicsPreset")) return "split"
  if (values.has("graphicsMode")) return "graphics"
  if ([...values].some(([key, value]) => key.startsWith("key_") && value.startsWith("key.keyboard."))) return "keyboard"
  if (values.has("renderDistance") || values.has("soundCategory_master")) return "numeric"
  if (values.has("viewDistance") || values.has("fpsLimit")) return "classic"
  return null
}

function compatible(text: string, target: string): boolean {
  const family = optionsFamily(target), inferred = inferFamily(text)
  if (inferred && inferred !== family) return false
  if (text.includes("\0") || text.split(/\r?\n/).some(line => line.trim() && !line.includes(":"))) return false
  const values = fields(text), lang = values.get("lang")
  const modern = family !== "classic" && family !== "numeric"
  for (const [key, value] of values) {
    if (key.startsWith("key_") && binding(value, modern) !== value) return false
    if (["mouseSensitivity", "gamma", "fov"].includes(key) && (!value || !Number.isFinite(Number(value)))) return false
  }
  const ao = values.get("ao")
  const release = /^1\.(\d+)(?:\.(\d+))?/.exec(target)
  const booleanAo = family === "classic" || !release || Number(release[1]) > 19 || (Number(release[1]) === 19 && Number(release[2] ?? 0) >= 3)
  if (ao !== undefined && !(booleanAo ? ["true", "false"] : ["0", "1", "2"]).includes(ao)) return false
  if (lang && fields(projectOptions("lang:" + lang, target)).get("lang") !== lang) return false
  if (/^1\.[1-7](?:\.|$)/.test(target) && values.has("renderClouds")) return false
  return true
}

// Коды LWJGL2 из OptionsKeyLwjgl3Fix, имена после OptionsKeyTranslationFix.
const keys = new Map<number, string>([
  [0, "unknown"], [1, "escape"], [14, "backspace"], [15, "tab"], [28, "enter"],
  [29, "left.control"], [42, "left.shift"], [54, "right.shift"], [56, "left.alt"], [57, "space"],
  [157, "right.control"], [184, "right.alt"], [199, "home"], [200, "up"], [201, "page.up"],
  [203, "left"], [205, "right"], [207, "end"], [208, "down"], [209, "page.down"], [210, "insert"], [211, "delete"],
  [12, "minus"], [13, "equal"], [26, "left.bracket"], [27, "right.bracket"], [39, "semicolon"],
  [40, "apostrophe"], [41, "grave.accent"], [43, "backslash"], [51, "comma"], [52, "period"], [53, "slash"],
  [58, "caps.lock"], [69, "num.lock"], [70, "scroll.lock"], [197, "pause"], [183, "print.screen"],
  [219, "left.win"], [220, "right.win"], [82, "keypad.0"], [79, "keypad.1"], [80, "keypad.2"],
  [81, "keypad.3"], [75, "keypad.4"], [76, "keypad.5"], [77, "keypad.6"], [71, "keypad.7"],
  [72, "keypad.8"], [73, "keypad.9"], [78, "keypad.add"], [83, "keypad.decimal"],
  [181, "keypad.divide"], [156, "keypad.enter"], [141, "keypad.equal"], [55, "keypad.multiply"], [74, "keypad.subtract"],
  [100, "f13"], [101, "f14"], [102, "f15"], [103, "f16"], [104, "f17"], [105, "f18"], [113, "f19"],
])
for (const [letters, codes] of [
  ["qwertyuiop", [16,17,18,19,20,21,22,23,24,25]],
  ["asdfghjkl", [30,31,32,33,34,35,36,37,38]],
  ["zxcvbnm", [44,45,46,47,48,49,50]],
  ["1234567890", [2,3,4,5,6,7,8,9,10,11]],
] as const) [...letters].forEach((letter, i) => keys.set(codes[i], letter))
for (let i = 1; i <= 10; i++) keys.set(58 + i, "f" + i)
keys.set(87, "f11"); keys.set(88, "f12")
const keyNames = new Map([...keys].map(([code, name]) => ["key.keyboard." + name, code]))

function binding(value: string, modern: boolean): string | undefined {
  if (modern) {
    if (/^(key\.(keyboard|mouse)\.[a-z0-9.]+|scancode\.\d+)$/.test(value)) return value
    if (!/^-?\d+$/.test(value)) return undefined
    const code = Number(value)
    if (code < 0) return code >= -100 && code <= -93 ? "key.mouse." + (["left", "right", "middle"][code + 100] ?? String(code + 101)) : undefined
    const name = keys.get(code)
    return name ? "key.keyboard." + name : undefined
  }
  if (/^-?\d+$/.test(value)) return value
  if (keyNames.has(value)) return String(keyNames.get(value))
  const mouse = /^key\.mouse\.(left|right|middle|[4-8])$/.exec(value)
  return mouse ? String(({ left: -100, right: -99, middle: -98 } as Record<string, number>)[mouse[1]] ?? Number(mouse[1]) - 101) : undefined
}

/** Между версиями переносится только подтверждённое общее подмножество. */
export function projectOptions(text: string, target: string): string {
  const family = optionsFamily(target)
  if (!family) return ""
  const input = fields(text), out = new Map<string, string>()
  // Подтверждено version.json официальных клиентов; не запускать старые
  // DataFixer повторно над уже преобразованными биндами и графикой.
  const dataVersion = ({ "1.21.10": 4556, "26.3": 5023 } as Record<string, number>)[target]
  if (dataVersion) out.set("version", String(dataVersion))
  const modern = family !== "classic" && family !== "numeric"
  for (const key of ["invertYMouse", "bobView", "fullscreen", "enableVsync", "pauseOnLostFocus", "anaglyph3d", "advancedOpengl"]) {
    const value = input.get(key)
    if (value === "true" || value === "false") out.set(key, value)
  }
  for (const key of ["mouseSensitivity", "gamma", "fov"]) {
    const value = input.get(key)
    if (value && Number.isFinite(Number(value)) && Number(value) >= (key === "fov" ? -1 : 0) && Number(value) <= 1) out.set(key, value)
  }
  for (const [key, max] of [["guiScale", family === "classic" ? 3 : 4], ["particles", 2], ["difficulty", 3]] as const) {
    const value = input.get(key)
    if (value && /^\d+$/.test(value) && Number(value) <= max) out.set(key, value)
  }
  const lang = input.get("lang")
  if (lang && /^[a-z]{2,3}_[a-z]{2,3}$/i.test(lang)) {
    const legacy = /^1\.(\d+)/.exec(target)
    out.set("lang", legacy && Number(legacy[1]) < 11 ? lang.split("_")[0].toLowerCase() + "_" + lang.split("_")[1].toUpperCase() : lang.toLowerCase())
  }
  for (const [key, value] of input) if (key.startsWith("key_")) {
    const converted = binding(value, modern)
    if (converted !== undefined) out.set(key, converted)
  }
  const volume = (key: string) => { const v = input.get(key); return v !== undefined && v !== "" && Number.isFinite(Number(v)) && Number(v) >= 0 && Number(v) <= 1 ? v : undefined }
  if (family === "classic") {
    const music = volume("music") ?? volume("soundCategory_music"), sound = volume("sound") ?? volume("soundCategory_master")
    if (music !== undefined) out.set("music", music)
    if (sound !== undefined) out.set("sound", sound)
  } else {
    for (const [key] of input) if (key.startsWith("soundCategory_")) { const v = volume(key); if (v !== undefined) out.set(key, v) }
    if (!out.has("soundCategory_music") && volume("music") !== undefined) out.set("soundCategory_music", volume("music")!)
    if (!out.has("soundCategory_master") && volume("sound") !== undefined) out.set("soundCategory_master", volume("sound")!)
  }
  // Дальность и FPS разных единиц не угадываются: новая версия выберет свой пресет.
  const distanceKey = family === "classic" ? "viewDistance" : "renderDistance"
  const distance = input.get(distanceKey)
  if (distance && /^\d+$/.test(distance) && Number(distance) >= (family === "classic" ? 0 : 2) && Number(distance) <= (family === "classic" ? 3 : 32)) out.set(distanceKey, distance)
  const fpsKey = family === "classic" ? "fpsLimit" : "maxFps", fps = input.get(fpsKey)
  if (fps && /^\d+$/.test(fps) && Number(fps) <= (family === "classic" ? 2 : 260)) out.set(fpsKey, fps)
  const ao = input.get("ao")
  if (ao !== undefined && ["true", "false", "0", "1", "2"].includes(ao)) {
    const on = ao === "true" || ao === "1" || ao === "2"
    const release = /^1\.(\d+)(?:\.(\d+))?/.exec(target)
    const booleanAo = family === "classic" || !release || Number(release[1]) > 19 || (Number(release[1]) === 19 && Number(release[2] ?? 0) >= 3)
    out.set("ao", booleanAo ? String(on) : on ? "2" : "0")
  }
  const cloud = input.get("renderClouds") ?? input.get("clouds")
  if (["true", "false", "fast", "fancy"].includes(cloud ?? "")) {
    const before18 = /^1\.[1-7](?:\.|$)/.test(target)
    out.set(before18 ? "clouds" : "renderClouds", before18 ? String(cloud !== "false") : cloud === "fast" ? "fast" : String(cloud !== "false"))
  }
  const fancy = input.get("fancyGraphics"), graphics = input.get("graphicsMode")
  if (["classic", "numeric", "keyboard"].includes(family)) {
    if (fancy === "true" || fancy === "false") out.set("fancyGraphics", fancy)
    else if (["0", "1", "2"].includes(graphics ?? "")) out.set("fancyGraphics", String(graphics !== "0"))
    else if (["fast", "fancy", "fabulous"].includes(input.get("graphicsPreset") ?? "")) out.set("fancyGraphics", String(input.get("graphicsPreset") !== "fast"))
  } else if (family === "graphics") {
    if (["0", "1", "2"].includes(graphics ?? "")) out.set("graphicsMode", graphics!)
    else if (fancy === "true" || fancy === "false") out.set("graphicsMode", fancy === "true" ? "1" : "0")
    else if (["fast", "fancy", "fabulous"].includes(input.get("graphicsPreset") ?? "")) out.set("graphicsMode", String(["fast", "fancy", "fabulous"].indexOf(input.get("graphicsPreset")!)))
  } else if (family === "split") {
    const mode = ["0", "1", "2"].includes(graphics ?? "") ? Number(graphics) : fancy === "true" ? 1 : fancy === "false" ? 0 : undefined
    if (mode !== undefined) {
      out.set("graphicsPreset", "custom")
      out.set("cutoutLeaves", String(mode > 0))
      out.set("weatherRadius", mode > 0 ? "10" : "5")
      out.set("vignette", String(mode > 0))
      out.set("improvedTransparency", String(mode === 2))
    }
  }
  return [...out].map(([key, value]) => key + ":" + value).join("\n") + (out.size ? "\n" : "")
}

async function read(file: string): Promise<Buffer | null> {
  try { return await fs.readFile(file) } catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return null; throw error }
}
function validateRecord(value: unknown): asserts value is { original: string | null; state: string | null } {
  if (!value || typeof value !== "object") throw new Error("Invalid options recovery journal")
  const record = value as Record<string, unknown>
  if (!(record.original === null || typeof record.original === "string") || !(record.state === null || typeof record.state === "string")) throw new Error("Invalid options recovery journal")
  if (typeof record.original === "string" && Buffer.from(record.original, "base64").toString("base64") !== record.original) throw new Error("Invalid options recovery bytes")
}
async function atomic(file: string, bytes: Buffer | string): Promise<void> {
  const temporary = file + "." + randomUUID() + ".tmp"
  try {
    const handle = await fs.open(temporary, "wx")
    try { await handle.writeFile(bytes); await handle.sync() } finally { await handle.close() }
    await fs.rename(temporary, file)
  } finally { await fs.rm(temporary, { force: true }) }
}

/** Снимки привязаны к точному ID версии; журнал восстанавливается до следующего запуска. */
export async function prepareOptionsCompatibility(gameDir: string, version: string, eligible: boolean): Promise<OptionsTransaction> {
  const noop = { commit: async () => {}, rollback: async () => {} }, family = optionsFamily(version)
  if (!eligible || !family) return noop
  const root = path.join(gameDir, ".xneon-options"), file = path.join(gameDir, "options.txt")
  await fs.mkdir(root, { recursive: true })
  const statePath = path.join(root, "state.json"), journal = path.join(root, "pending.json")
  const profile = (id: string) => path.join(root, digest(id) + ".options")
  const restore = async (record: { original: string | null; state: string | null }) => {
    if (record.original === null) await fs.rm(file, { force: true })
    else await atomic(file, Buffer.from(record.original, "base64"))
    if (record.state === null) await fs.rm(statePath, { force: true })
    else await atomic(statePath, record.state)
    await fs.rm(journal, { force: true })
  }
  const unfinished = await read(journal)
  if (unfinished) {
    const recovered: unknown = JSON.parse(unfinished.toString())
    validateRecord(recovered)
    await restore(recovered)
  }
  const original = await read(file), stateBytes = await read(statePath)
  const state: State | null = stateBytes ? JSON.parse(stateBytes.toString()) : null
  if (state && (state.schema !== 1 || typeof state.active !== "string" || optionsFamily(state.active) !== state.family)) throw new Error("Invalid options compatibility state")
  if (original) await atomic(profile(state?.active ?? "unattributed"), original)
  const inferred = original ? inferFamily(original.toString()) : null
  if (!state && original && inferred) await atomic(profile("family:" + inferred), original)
  const saved = await read(profile(version))
  let next: Buffer | null = original
  if (state?.active !== version || (original && !compatible(original.toString(), version))) {
    if (saved !== null && state?.active !== version) next = compatible(saved.toString(), version) ? saved : Buffer.from(projectOptions(saved.toString(), version))
    else {
      const initial = await read(profile("family:" + family))
      if (initial && compatible(initial.toString(), version)) next = initial
      else if (original?.length && !compatible(original.toString(), version)) next = Buffer.from(projectOptions(original.toString("utf8"), version))
    }
  }
  const record = { original: original?.toString("base64") ?? null, state: stateBytes?.toString() ?? null }
  const unchanged = (next === null && original === null) || (next?.equals(original ?? Buffer.alloc(0)) && original !== null)
  if (original !== null) await atomic(path.join(root, "backup-" + digest(original) + ".txt"), original)
  await atomic(journal, JSON.stringify(record))
  try {
    if (!unchanged && next !== null) await atomic(file, next)
    await atomic(statePath, JSON.stringify({ schema: 1, active: version, family } satisfies State))
  } catch (error) { await restore(record); throw error }
  // Журнал остаётся до подтверждения старта JVM. Иначе падение лаунчера
  // между конвертацией и стартом оставляло бы чужой options.txt активным.
  let settled = false
  return {
    commit: async () => {
      if (settled) return
      await fs.rm(journal, { force: true })
      settled = true
    },
    rollback: async () => {
      if (settled) return
      await restore(record)
      settled = true
    },
  }
}
