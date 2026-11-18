import { describe, expect, test } from "bun:test"
import fs from "node:fs"
import path from "node:path"
import vm from "node:vm"
import { createRequire } from "node:module"
import { transformSync } from "esbuild"
import { PNG } from "pngjs"
import { equippedSkinId, initialSkinSelection } from "../../lib/skin-selection"
import { skinTextureKey, detectSkinVariant } from "../../packages/xnlc-skins/src/texture"
import { SkinProfileCache } from "../../packages/xnlc-skins/src/profile-cache"

const require = createRequire(import.meta.url)
function texture(color = 90, deflateLevel = 9) {
  const png = new PNG({ width: 64, height: 64 })
  for (let i = 0; i < png.data.length; i += 4) png.data.set([color, 50, 100, 255], i)
  return new Uint8Array(PNG.sync.write(png, { deflateLevel }))
}
const remote = (url = "https://textures.minecraft.net/texture/one", variant = "SLIM") => ({
  id: "uuid", name: "Player", skins: [{ id: "remote", state: "ACTIVE", url, variant }], capes: [],
})

function fixture(disk = new Map<string, Uint8Array>(), accountType = "microsoft") {
  let online = true
  let current: any = remote()
  const requests: { url: string; method: string; body: any }[] = []
  let capeFailure = false
  let responseBody = true
  let textureColor: number | undefined
  let expireUpload = false
  let refreshes = 0
  const files = new Map<string, Uint8Array>([["saved", texture()]])
  const rows: any[] = [{ id: "saved", accountId: "a", filePath: "saved.png", name: "Saved", variant: "classic", capeId: null, createdAt: "now" }]
  const store = {
    list: async (accountId: string) => rows.filter(s => s.accountId === accountId),
    findById: async (id: string) => rows.find(s => s.id === id) ?? null,
    findBySource: async (accountId: string, sourceId: string) => rows.find(s => s.accountId === accountId && s.sourceId === sourceId) ?? null,
    readTexture: async (id: string) => files.get(id) ?? null,
    update: async (id: string, patch: any) => Object.assign(rows.find(s => s.id === id), patch),
    remove: async (id: string) => { rows.splice(rows.findIndex(s => s.id === id), 1) },
    create: async ({ data, ...input }: any) => {
      const row = { ...input, id: `saved-${rows.length}`, filePath: `${rows.length}.png`, createdAt: "now" }
      rows.push(row); files.set(row.id, data); return row
    },
  }
  const modules = new Map<string, any>()
  function load(filename: string): any {
    filename = path.resolve(filename)
    if (modules.has(filename)) return modules.get(filename).exports
    const module = { exports: {} }
    modules.set(filename, module)
    const code = transformSync(fs.readFileSync(filename, "utf8"), { loader: "ts", format: "cjs" }).code
    vm.runInNewContext(code, {
      module, exports: module.exports, Buffer, Uint8Array, ArrayBuffer, DataView, TextEncoder, TextDecoder,
      URL, Blob, FormData, Response, AbortSignal, crypto: globalThis.crypto, console, structuredClone,
      require(name: string) {
        if (name === "@xnlc/core/retry") return { fetchWithRetry: async (url: string, init: any = {}) => {
          requests.push({ url, method: init.method ?? "GET", body: init.body })
          if (!online) throw new Error("offline")
          if (url.includes("/texture/")) return new Response(texture(textureColor ?? (url.endsWith("other") ? 120 : 90), 1))
          if (init.method === "POST" && expireUpload) { expireUpload = false; return new Response(null, { status: 401 }) }
          if (url.endsWith("/capes/active") && capeFailure) return new Response(null, { status: 403 })
          if (init.method === "POST") current = remote()
          if (init.method === "DELETE" && url.endsWith("/skins/active")) current = { ...remote(), skins: [] }
          return responseBody || !init.method ? Response.json(current) : new Response(null, { status: 204 })
        } }
        if (name.startsWith(".")) return load(path.resolve(path.dirname(filename), name.replace(/\.js$/, ".ts")))
        return require(name)
      },
    })
    return module.exports
  }
  const { createSkinSystem } = load("packages/xnlc-skins/src/index.ts")
  const accounts = { resolve: async (id = "a") => ({ id, uuid: "uuid", type: accountType, accessToken: "token", serverUrl: "https://auth.example/",
    skinUrl: accountType === "offline" ? rows[0]?.filePath : undefined }),
    refresh: async (a: any) => { refreshes++; return { ...a, accessToken: "new-token" } } }
  const system = createSkinSystem({ library: store, accounts, disk: {
    read: async (key: string) => disk.get(key) ?? null,
    write: async (key: string, value: Uint8Array) => { disk.set(key, value) },
  } })
  return { system, disk, rows, files, requests, setOnline: (v: boolean) => { online = v },
    setProfile: (p: any) => { current = p }, failCape: () => { capeFailure = true }, emptyResponse: () => { responseBody = false },
    setTextureColor: (c: number) => { textureColor = c }, expireUpload: () => { expireUpload = true }, refreshes: () => refreshes }
}

describe("состояние скинов: сервер, сохранённые и выбранный", () => {
  test("после перезапуска находит надетый PNG независимо от сжатия и исправляет модель", async () => {
    const f = fixture()
    const profile = await f.system.library.profile("a")
    expect(profile.equippedLibrarySkinId).toBe("saved")
    expect(f.rows[0].variant).toBe("slim")
    const restarted = fixture(f.disk)
    restarted.setOnline(false)
    expect((await restarted.system.library.profile("a")).equippedLibrarySkinId).toBe("saved")
  })
  test("не считает новый или посторонний скин надетым", async () => {
    const f = fixture()
    f.setProfile(remote("https://textures.minecraft.net/texture/other"))
    expect((await f.system.library.profile("a")).equippedLibrarySkinId).toBeNull()
  })
  test("параллельное чтение профиля объединяется в один запрос", async () => {
    const f = fixture()
    await Promise.all([f.system.minecraft.profile("a"), f.system.minecraft.profile("a")])
    expect(f.requests.filter(r => r.url.endsWith("/minecraft/profile"))).toHaveLength(1)
  })
  test("сохраняет внешний текущий скин перед заменой", async () => {
    const f = fixture()
    f.setProfile(remote("https://textures.minecraft.net/texture/other"))
    expect(await f.system.library.apply("saved", "a")).toBe(true)
    expect(f.rows).toHaveLength(2)
  })
  test("отправляет lowercase variant и снимает плащ у записи без плаща", async () => {
    const f = fixture()
    expect(await f.system.library.apply("saved", "a")).toBe(true)
    const upload = f.requests.find(r => r.method === "POST")!
    expect(upload.body.get("variant")).toBe("classic")
    expect(f.requests.some(r => r.url.endsWith("/capes/active") && r.method === "DELETE")).toBe(true)
  })
  test("ошибка применения плаща не выдаётся за успех", async () => {
    const f = fixture()
    f.failCape()
    expect(await f.system.library.apply("saved", "a")).toBe(false)
  })
  test("пустой ответ операции перечитывает профиль, сброс не оставляет старую отметку", async () => {
    const f = fixture()
    f.emptyResponse()
    expect(await f.system.library.apply("saved", "a")).toBe(true)
    expect((await f.system.library.profile("a")).equippedLibrarySkinId).toBe("saved")
    expect(await f.system.library.reset("a")).toBe(true)
    expect((await f.system.library.profile("a")).equippedLibrarySkinId).toBeNull()
  })
  test("не применяет чужую запись другому аккаунту", async () => {
    const f = fixture()
    expect(await f.system.library.apply("saved", "b")).toBe(false)
    expect(f.requests.some(r => r.method === "POST")).toBe(false)
  })
  test("не сохраняет обрезанный PNG и картинку неправильного размера", async () => {
    const f = fixture()
    const save = (data: Uint8Array) => f.system.library.save({ data, accountId: "a", name: "bad", variant: "classic" })
    expect(await save(new Uint8Array([137, 80, 78, 71, 0, 0, 0, 0]))).toBeNull()
    expect(await save(new Uint8Array(PNG.sync.write(new PNG({ width: 128, height: 128 }))))).toBeNull()
  })
  test("выбор для просмотра не подменяет надетый, внешний скин доступен при непустой библиотеке", () => {
    const library = fixture().rows
    expect(equippedSkinId({ ...remote(), equippedLibrarySkinId: "saved" } as any, library)).toBe("saved")
    expect(initialSkinSelection({ ...remote(), equippedLibrarySkinId: null } as any, library)).toBe("__api__")
    expect(equippedSkinId({ ...remote(), skins: [] }, library)).toBeNull()
    expect(initialSkinSelection(null, library)).toBe("saved")
  })
  test("одна текстура не размножается от разного сжатия или модели", async () => {
    const f = fixture()
    const saved = await f.system.library.save({ accountId: "a", name: "same", data: texture(90, 1), variant: "slim", capeId: null })
    expect(saved.id).toBe("saved")
    expect(f.rows).toHaveLength(1)
    expect(saved.variant).toBe("slim")
  })
  test("распознаёт slim по прозрачной полосе руки, legacy всегда classic", () => {
    const png = PNG.sync.read(Buffer.from(texture()))
    for (let y = 20; y < 32; y++) for (let x = 54; x < 56; x++) png.data[(y * 64 + x) * 4 + 3] = 0
    expect(detectSkinVariant(PNG.sync.write(png))).toBe("slim")
    expect(detectSkinVariant(texture())).toBe("classic")
    expect(detectSkinVariant(PNG.sync.write(new PNG({ width: 64, height: 32 })))).toBe("classic")
  })
  test("legacy 64x32 и его современная развёртка имеют одну идентичность", () => {
    // Одноцветная непрозрачная база и пустые внешние слои.
    const legacy = new PNG({ width: 64, height: 32 })
    legacy.data.fill(255)
    const modern = new PNG({ width: 64, height: 64 })
    modern.data.fill(255, 0, 64 * 32 * 4)
    for (let y = 0; y < 16; y++) for (let x = 32; x < 64; x++) modern.data[(y * 64 + x) * 4 + 3] = 0
    for (let y = 48; y < 64; y++) for (let x = 16; x < 48; x++) modern.data.set([255, 255, 255, 255], (y * 64 + x) * 4)
    expect(skinTextureKey(PNG.sync.write(legacy))).toBe(skinTextureKey(PNG.sync.write(modern)))
  })
  test("опоздавший запрос не возвращает старый профиль после применения", async () => {
    const cache = new SkinProfileCache()
    let resolve!: (value: any) => void
    const delayed = new Promise<any>(r => { resolve = r })
    const before = cache.get("a", () => delayed)
    cache.invalidate("a")
    const fresh = remote("https://textures.minecraft.net/texture/new") as any
    await cache.put("a", fresh)
    resolve(remote())
    expect((await before)?.skins[0].url).toBe(fresh.skins[0].url)
  })
  test("параллельное сохранение одной текстуры не создаёт дубликаты", async () => {
    const f = fixture()
    const input = { accountId: "a", name: "new", data: texture(120), variant: "classic" }
    const [a, b] = await Promise.all([f.system.library.save(input), f.system.library.save(input)])
    expect(a.id).toBe(b.id)
    expect(f.rows).toHaveLength(2)
  })
  test("после загрузки обновляет текстуру даже по прежнему изменяемому URL", async () => {
    const f = fixture()
    expect((await f.system.library.profile("a")).equippedLibrarySkinId).toBe("saved")
    f.setTextureColor(120)
    expect(await f.system.library.apply("saved", "a")).toBe(true)
    expect((await f.system.library.profile("a")).equippedLibrarySkinId).toBeNull()
  })
  test("битый дисковый PNG заменяется удачной загрузкой", async () => {
    const f = fixture()
    await f.system.library.profile("a")
    const key = [...f.disk.keys()].find(k => k.endsWith(".png"))!
    f.disk.set(key, new Uint8Array([1, 2, 3]))
    const restarted = fixture(f.disk)
    expect((await restarted.system.library.profile("a")).equippedLibrarySkinId).toBe("saved")
    expect(restarted.disk.get(key)!.byteLength).toBeGreaterThan(33)
  })
  test("ошибочный профиль не стирает последний удачный снимок", async () => {
    const f = fixture()
    await f.system.library.profile("a")
    const restarted = fixture(f.disk)
    restarted.setProfile({ error: "upstream" })
    expect((await restarted.system.library.profile("a")).equippedLibrarySkinId).toBe("saved")
  })
  test("401 обновляет токен и повторяет загрузку один раз", async () => {
    const f = fixture()
    f.expireUpload()
    expect(await f.system.library.apply("saved", "a")).toBe(true)
    expect(f.refreshes()).toBe(1)
    expect(f.requests.filter(r => r.method === "POST")).toHaveLength(2)
  })
  test("два применения сериализуют скин и плащ одного аккаунта", async () => {
    const f = fixture()
    expect(await Promise.all([f.system.library.apply("saved", "a"), f.system.library.apply("saved", "a")])).toEqual([true, true])
    expect(f.requests.filter(r => r.method !== "GET").map(r => r.method)).toEqual(["POST", "DELETE", "POST", "DELETE"])
  })
  test("Authlib принимает прямой профиль альтернативного API и восстанавливается офлайн", async () => {
    const f = fixture(undefined, "authlib-injector")
    expect((await f.system.library.profile("a")).equippedLibrarySkinId).toBe("saved")
    const restarted = fixture(f.disk, "authlib-injector")
    restarted.setOnline(false)
    expect((await restarted.system.library.profile("a")).equippedLibrarySkinId).toBe("saved")
  })
  test("локальная текстура офлайн-аккаунта не требует сетевой загрузки", async () => {
    const f = fixture(undefined, "offline")
    f.setOnline(false)
    expect((await f.system.library.profile("a")).equippedLibrarySkinId).toBe("saved")
    expect(await f.system.library.apply("saved", "a")).toBe(true)
    expect(f.requests).toHaveLength(0)
  })
})
