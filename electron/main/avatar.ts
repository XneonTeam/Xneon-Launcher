import { app, protocol, ipcMain } from "electron"
import axios from "axios"
import { PNG } from "pngjs"
import path from "path"
import fs from "fs"
import { logRuntime } from "./runtime"

const USER_AGENT = "Xneon-Launcher/1.0.7 (launcher@xneon.fun)"

const http = axios.create({
  timeout: 5000,
  headers: {
    "User-Agent": USER_AGENT,
  },
})

export interface TexturesData {
  SKIN?: { url: string }
  CAPE?: { url: string }
}

interface CacheEntry<T> {
  data: T
  expiresAt: number
}

class TtlCache<T> {
  private map = new Map<string, CacheEntry<T>>()
  constructor(private maxEntries = 500) {}

  get(key: string): T | undefined {
    const entry = this.map.get(key)
    if (!entry) return undefined
    if (Date.now() > entry.expiresAt) {
      this.map.delete(key)
      return undefined
    }
    return entry.data
  }

  set(key: string, data: T, ttlSeconds: number) {
    if (this.map.size >= this.maxEntries) {
      const firstKey = this.map.keys().next().value
      if (firstKey) this.map.delete(firstKey)
    }
    this.map.set(key, { data, expiresAt: Date.now() + ttlSeconds * 1000 })
  }

  delete(key: string): boolean {
    return this.map.delete(key)
  }

  deleteMatching(predicate: (key: string) => boolean): void {
    for (const key of this.map.keys()) {
      if (predicate(key)) {
        this.map.delete(key)
      }
    }
  }

  clear(): void {
    this.map.clear()
  }
}

// Кеширование данных текстур на 1 час (3600с), готовых голов на 10 минут (600с)
const texturesCache = new TtlCache<TexturesData | null>(500)
const headCache = new TtlCache<Buffer>(500)
const skinCache = new TtlCache<Buffer>(200)
const capeCache = new TtlCache<Buffer>(200)

let cachedSteveSkinBuffer: Buffer | null = null

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])

/**
 * Проверяет, что буфер — целый PNG: сигнатура, все чанки в границах и IEND.
 * Обрезанный файл pngjs не прочитает, а раньше именно такой (встроенный base64)
 * попадал в кэш и валил фолбэк в бесконечную рекурсию (аудит 1.0.7).
 */
function isCompletePng(buf: Buffer | null | undefined): buf is Buffer {
  if (!buf || buf.length < 24) return false
  if (!buf.subarray(0, 8).equals(PNG_SIGNATURE)) return false
  let offset = 8
  while (offset + 8 <= buf.length) {
    const length = buf.readUInt32BE(offset)
    const type = buf.toString("latin1", offset + 4, offset + 8)
    if (offset + 12 + length > buf.length) return false
    if (type === "IEND") return true
    offset += 12 + length
  }
  return false
}

/**
 * Аварийный скин 64x64, собранный программно. Нужен как последний рубеж:
 * фолбэк не должен зависеть ни от файлов рядом, ни от встроенного base64.
 */
function buildEmergencySkin(): Buffer {
  const png = new PNG({ width: 64, height: 64 })
  for (let y = 0; y < 64; y++) {
    for (let x = 0; x < 64; x++) {
      const idx = (y * 64 + x) * 4
      const inHead = x >= 8 && x < 16 && y >= 8 && y < 16
      const inOverlay = x >= 40 && x < 48 && y >= 8 && y < 16
      const hair = inHead && y < 11
      png.data[idx] = hair ? 60 : 198
      png.data[idx + 1] = hair ? 40 : 142
      png.data[idx + 2] = hair ? 28 : 90
      png.data[idx + 3] = inHead || inOverlay ? 255 : 0
    }
  }
  return PNG.sync.write(png)
}

/** Голова-заглушка, собранная программно: применятся, когда чтение скина уже провалилось. */
function buildSyntheticHead(size: number): Buffer {
  const png = new PNG({ width: size, height: size })
  const scale = size / 8
  for (let ty = 0; ty < size; ty++) {
    for (let tx = 0; tx < size; tx++) {
      const srcY = Math.floor(ty / scale)
      const idx = (ty * size + tx) * 4
      const hair = srcY < 3
      png.data[idx] = hair ? 60 : 198
      png.data[idx + 1] = hair ? 40 : 142
      png.data[idx + 2] = hair ? 28 : 90
      png.data[idx + 3] = 255
    }
  }
  return PNG.sync.write(png)
}

/** Не даёт фолбэку войти в себя повторно: иначе битый скин = бесконечная рекурсия. */
function fallbackHead(size: number, depth: number): Buffer {
  return depth > 0 ? buildSyntheticHead(size) : getFallbackSteveHead(size)
}

/** Разрешены только публичные http(s)-адреса: skin_url приходит от сторонних auth-серверов. */
function isPublicHttpUrl(raw: string): boolean {
  let parsed: URL
  try {
    parsed = new URL(raw)
  } catch {
    return false
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return false
  const host = parsed.hostname.toLowerCase().replace(/^\[|\]$/g, "")
  if (!host) return false
  if (host === "localhost" || host.endsWith(".localhost") || host === "::1" || host === "0.0.0.0") return false
  if (/^127\./.test(host) || /^10\./.test(host) || /^192\.168\./.test(host) || /^169\.254\./.test(host)) return false
  const private172 = host.match(/^172\.(\d{1,3})\./)
  if (private172 && Number(private172[1]) >= 16 && Number(private172[1]) <= 31) return false
  return true
}

function getSteveSkinBuffer(): Buffer {
  if (cachedSteveSkinBuffer) return cachedSteveSkinBuffer

  // В упакованной сборке assets/ лежит внутри app.asar, поэтому кроме cwd
  // проверяем каталог рядом с собранным main-кодом и resourcesPath.
  const roots = [
    path.join(__dirname, "../../"),
    process.cwd(),
    typeof process.resourcesPath === "string" ? process.resourcesPath : "",
  ].filter((root) => Boolean(root))

  // PNG в приоритете, затем base64-файл. Оба проверяем на целостность:
  // обрезанный файл раньше попадал в кэш и валил фолбэк в рекурсию.
  for (const root of roots) {
    const pngPath = path.join(root, "assets", "steve-skin.png")
    try {
      const buf = fs.readFileSync(pngPath)
      if (isCompletePng(buf)) {
        cachedSteveSkinBuffer = buf
        return cachedSteveSkinBuffer
      }
      logRuntime(`[Avatar] Повреждён запасной скин: ${pngPath}`)
    } catch {}
  }
  for (const root of roots) {
    const base64Path = path.join(root, "assets", "steve-skin.b64")
    try {
      const decoded = Buffer.from(fs.readFileSync(base64Path, "utf-8").trim(), "base64")
      if (isCompletePng(decoded)) {
        cachedSteveSkinBuffer = decoded
        return cachedSteveSkinBuffer
      }
      logRuntime(`[Avatar] Повреждён base64 запасного скина: ${base64Path}`)
    } catch {}
  }
  logRuntime("[Avatar] Запасной скин Steve не найден — собран аварийный")
  cachedSteveSkinBuffer = buildEmergencySkin()
  return cachedSteveSkinBuffer
}

export interface PlayerTextureOptions {
  uuid?: string | null
  type?: string | null
  randomuuid?: string | null
  skinUrl?: string | null
}

/**
 * Получить текстуры с сервера XN Skins (https://skins.xneon.org)
 */
export async function getXnSkinsTextures(username: string, uuid?: string | null): Promise<TexturesData | null> {
  const cleanName = (username || "").trim()
  let resolvedUuid = uuid ? uuid.replace(/-/g, "") : null

  if (!resolvedUuid && cleanName) {
    try {
      const res = await http.post<Array<{ id: string; name: string }>>(
        "https://skins.xneon.org/api/profiles/minecraft",
        [cleanName]
      )
      if (Array.isArray(res.data) && res.data.length > 0 && res.data[0]?.id) {
        resolvedUuid = res.data[0].id
      }
    } catch {}
  }

  if (!resolvedUuid) return null

  try {
    const res = await http.get<{
      id: string
      name: string
      properties?: Array<{ name: string; value: string }>
    }>(`https://skins.xneon.org/sessionserver/session/minecraft/profile/${resolvedUuid}`)

    const texturesProp = res.data?.properties?.find((p) => p.name === "textures")
    if (!texturesProp?.value) return null

    const decoded = JSON.parse(Buffer.from(texturesProp.value, "base64").toString("utf8")) as {
      textures?: {
        SKIN?: { url: string }
        CAPE?: { url: string }
      }
    }

    if (decoded.textures?.SKIN?.url || decoded.textures?.CAPE?.url) {
      return {
        SKIN: decoded.textures.SKIN?.url ? { url: decoded.textures.SKIN.url } : undefined,
        CAPE: decoded.textures.CAPE?.url ? { url: decoded.textures.CAPE.url } : undefined,
      }
    }
  } catch {}

  return null
}

/**
 * Получить текстуры с серверов Mojang / Microsoft (официальные скины)
 */
export async function getMojangTextures(username: string, uuid?: string | null): Promise<TexturesData | null> {
  const cleanName = (username || "").trim()
  let resolvedUuid = uuid ? uuid.replace(/-/g, "") : null

  if (!resolvedUuid && cleanName) {
    try {
      const res = await http.get<{ id: string; name: string }>(
        `https://api.mojang.com/users/profiles/minecraft/${encodeURIComponent(cleanName)}`
      )
      if (res.data?.id) {
        resolvedUuid = res.data.id
      }
    } catch {}
  }

  if (!resolvedUuid) return null

  // Официальный Mojang session server
  try {
    const res = await http.get<{
      id: string
      name: string
      properties?: Array<{ name: string; value: string }>
    }>(`https://sessionserver.mojang.com/session/minecraft/profile/${resolvedUuid}?unsigned=false`)

    const texturesProp = res.data?.properties?.find((p) => p.name === "textures")
    if (texturesProp?.value) {
      const decoded = JSON.parse(Buffer.from(texturesProp.value, "base64").toString("utf8")) as {
        textures?: {
          SKIN?: { url: string; metadata?: { model?: string } }
          CAPE?: { url: string }
        }
      }

      if (decoded.textures?.SKIN?.url || decoded.textures?.CAPE?.url) {
        return {
          SKIN: decoded.textures.SKIN?.url ? { url: decoded.textures.SKIN.url } : undefined,
          CAPE: decoded.textures.CAPE?.url ? { url: decoded.textures.CAPE.url } : undefined,
        }
      }
    }
  } catch {}

  return null
}

/**
 * Получить текстуры с Ely.by
 */
export async function getElyByTextures(username: string): Promise<TexturesData | null> {
  const cleanName = (username || "").trim()
  if (!cleanName) return null
  try {
    const res = await http.get<TexturesData>(`https://skinsystem.ely.by/textures/${encodeURIComponent(cleanName)}`)
    if (res.data && (res.data.SKIN || res.data.CAPE)) {
      return res.data
    }
  } catch {}
  return null
}

/**
 * Получить текстуры игрока с учётом типа аккаунта (xnskins / elyby / microsoft / offline)
 */
export async function getTextures(
  username: string,
  options?: PlayerTextureOptions | string | null
): Promise<TexturesData | null> {
  const cleanName = (username || "").trim()
  if (!cleanName) return null

  const opts: PlayerTextureOptions = typeof options === "string" ? { uuid: options } : options ?? {}
  const effectiveUuid = opts.uuid || opts.randomuuid || null
  const accountType = (opts.type || "").toLowerCase()
  const directSkinUrl = (opts.skinUrl || "").trim()

  const cacheKey = `textures_${cleanName.toLowerCase()}_${accountType}_${effectiveUuid || ""}_${directSkinUrl}`
  const cached = texturesCache.get(cacheKey)
  if (cached !== undefined) return cached

  if (directSkinUrl) {
    // skin_url приходит от сторонних auth-серверов, поэтому принимаем только
    // публичные http(s)-адреса: локальные пути и приватные хосты отклоняем.
    if (!isPublicHttpUrl(directSkinUrl)) {
      logRuntime(`[Avatar] Отклонён недопустимый skin_url: ${directSkinUrl.slice(0, 120)}`)
      texturesCache.set(cacheKey, null, 300)
      return null
    }
    const data: TexturesData = {
      SKIN: { url: directSkinUrl },
    }
    texturesCache.set(cacheKey, data, 3600)
    return data
  }

  let data: TexturesData | null = null

  if (accountType === "microsoft" || accountType === "mojang") {
    // Для Microsoft/Mojang ТОЛЬКО официальные серверы и кэши Mojang. Никаких фолбэков на сторонние пиратские сервисы!
    data = await getMojangTextures(cleanName, effectiveUuid)
  } else if (accountType === "xnskins" || accountType === "xneon") {
    // Для XN Skins сначала проверяем сервер XN Skins
    data = await getXnSkinsTextures(cleanName, effectiveUuid)
  } else if (accountType === "elyby") {
    // Для Ely.by опрашиваем только Ely.by
    data = await getElyByTextures(cleanName)
  } else if (accountType === "authlib-injector" || accountType === "authlib") {
    try {
      const { dbHelpers } = await import("../db/index.js")
      const accounts = await dbHelpers.loadAccounts()
      const cleanTargetUuid = (effectiveUuid || "").replace(/-/g, "").toLowerCase()
      const acc = accounts.find((a) => {
        if (a.type !== "authlib-injector") return false
        const aUuid = (a.uuid || "").replace(/-/g, "").toLowerCase()
        if (cleanTargetUuid && aUuid === cleanTargetUuid) return true
        if (cleanName && a.username.toLowerCase() === cleanName.toLowerCase()) return true
        return false
      })
      if (acc?.serverId && (acc.uuid || effectiveUuid)) {
        const targetUuid = acc.uuid || effectiveUuid
        const { getProfileTextures } = await import("./authlib/service.js")
        const profile = await getProfileTextures(acc.serverId, targetUuid!)
        if (profile?.textures?.skin?.url || profile?.textures?.cape?.url) {
          data = {
            SKIN: profile.textures.skin?.url ? { url: profile.textures.skin.url } : undefined,
            CAPE: profile.textures.cape?.url ? { url: profile.textures.cape.url } : undefined,
          }
        }
      }
    } catch {}
  } else {
    // Если тип не указан или offline — пробуем официальный Mojang, затем XN Skins
    data = await getMojangTextures(cleanName, effectiveUuid)
    if (!data) {
      data = await getXnSkinsTextures(cleanName, effectiveUuid)
    }
  }

  if (data && (data.SKIN || data.CAPE)) {
    texturesCache.set(cacheKey, data, 3600)
    return data
  }

  // Негативный кэш на 5 минут для избежания лишнего спама запросов при отсутствии скина
  texturesCache.set(cacheKey, null, 300)
  return null
}

/**
 * Извлечение 8x8 головы и наложение overlay-слоя с масштабированием nearest-neighbor
 */
export function extractHeadFromSkin(skinBuffer: Buffer, size = 64, fallbackDepth = 0): Buffer {
  const s = Math.max(8, Math.min(size, 512))
  let skin: PNG
  try {
    skin = PNG.sync.read(skinBuffer)
  } catch {
    return fallbackHead(s, fallbackDepth)
  }

  const headSize = 8
  const outPng = new PNG({ width: s, height: s })
  const scale = s / headSize

  if (skin.width < 48 || skin.height < 16) {
    return fallbackHead(s, fallbackDepth)
  }

  // 8x8 пикселей скомпонованной головы
  const composite8x8 = Buffer.alloc(headSize * headSize * 4)

  for (let y = 0; y < headSize; y++) {
    for (let x = 0; x < headSize; x++) {
      const baseIdx = ((8 + y) * skin.width + (8 + x)) * 4
      const overlayIdx = ((8 + y) * skin.width + (40 + x)) * 4

      const baseR = skin.data[baseIdx]
      const baseG = skin.data[baseIdx + 1]
      const baseB = skin.data[baseIdx + 2]
      const baseA = skin.data[baseIdx + 3]

      const overR = skin.data[overlayIdx]
      const overG = skin.data[overlayIdx + 1]
      const overB = skin.data[overlayIdx + 2]
      const overA = skin.data[overlayIdx + 3]

      let r: number, g: number, b: number, a: number
      if (overA === 0) {
        r = baseR
        g = baseG
        b = baseB
        a = baseA
      } else if (overA === 255) {
        r = overR
        g = overG
        b = overB
        a = 255
      } else {
        const alpha = overA / 255
        r = Math.round(overR * alpha + baseR * (1 - alpha))
        g = Math.round(overG * alpha + baseG * (1 - alpha))
        b = Math.round(overB * alpha + baseB * (1 - alpha))
        a = Math.round(overA + baseA * (1 - alpha))
      }

      const compIdx = (y * headSize + x) * 4
      composite8x8[compIdx] = r
      composite8x8[compIdx + 1] = g
      composite8x8[compIdx + 2] = b
      composite8x8[compIdx + 3] = a
    }
  }

  // Nearest-neighbor апскейл
  for (let targetY = 0; targetY < s; targetY++) {
    const srcY = Math.floor(targetY / scale)
    for (let targetX = 0; targetX < s; targetX++) {
      const srcX = Math.floor(targetX / scale)
      const srcIdx = (srcY * headSize + srcX) * 4
      const targetIdx = (targetY * s + targetX) * 4

      outPng.data[targetIdx] = composite8x8[srcIdx]
      outPng.data[targetIdx + 1] = composite8x8[srcIdx + 1]
      outPng.data[targetIdx + 2] = composite8x8[srcIdx + 2]
      outPng.data[targetIdx + 3] = composite8x8[srcIdx + 3]
    }
  }

  return PNG.sync.write(outPng)
}

/**
 * Получить буфер аватарки Steve по умолчанию
 */
export function getFallbackSteveHead(size = 64): Buffer {
  const s = Math.max(8, Math.min(size, 512))
  const cacheKey = `steve_head_${s}`
  const cached = headCache.get(cacheKey)
  if (cached) return cached

  const skinBuf = getSteveSkinBuffer()
  // depth = 1: если и запасной скин не читается, вернётся синтетическая голова,
  // а не повторный вход в getFallbackSteveHead (иначе бесконечная рекурсия).
  const headBuf = extractHeadFromSkin(skinBuf, s, 1)
  headCache.set(cacheKey, headBuf, 86400)
  return headBuf
}

/**
 * Получить PNG-буфер головы игрока (с кэшированием и Steve-fallback)
 */
export async function getHeadBuffer(
  username: string,
  size = 64,
  options?: PlayerTextureOptions | string | null
): Promise<Buffer> {
  const cleanName = (username || "").trim()
  const s = Math.max(8, Math.min(size, 512))
  const opts: PlayerTextureOptions = typeof options === "string" ? { uuid: options } : options ?? {}
  const effectiveUuid = opts.uuid || opts.randomuuid || ""
  const accountType = (opts.type || "").toLowerCase()
  const skinUrl = opts.skinUrl || ""

  const cacheKey = `head_${cleanName.toLowerCase()}_${accountType}_${effectiveUuid}_${skinUrl}_${s}`
  const cached = headCache.get(cacheKey)
  if (cached) return cached

  if (!cleanName || cleanName.toLowerCase() === "steve") {
    return getFallbackSteveHead(s)
  }

  const textures = await getTextures(cleanName, opts)
  if (!textures?.SKIN?.url) {
    return getFallbackSteveHead(s)
  }

  try {
    let skinBuffer: Buffer
    if (textures.SKIN.url.startsWith("http://") || textures.SKIN.url.startsWith("https://")) {
      const skinRes = await http.get<ArrayBuffer>(textures.SKIN.url, { responseType: "arraybuffer" })
      skinBuffer = Buffer.from(skinRes.data)
    } else {
      skinBuffer = await fs.promises.readFile(textures.SKIN.url)
    }
    const finalHead = extractHeadFromSkin(skinBuffer, s)
    headCache.set(cacheKey, finalHead, 600)
    return finalHead
  } catch (err) {
    logRuntime(`[Avatar] Error processing head for ${cleanName}: ${err instanceof Error ? err.message : String(err)}`)
    return getFallbackSteveHead(s)
  }
}

/**
 * Получить PNG-буфер текстуры скина
 */
export async function getSkinBuffer(
  username: string,
  options?: PlayerTextureOptions | string | null
): Promise<Buffer | null> {
  const cleanName = (username || "").trim()
  const opts: PlayerTextureOptions = typeof options === "string" ? { uuid: options } : options ?? {}
  const effectiveUuid = opts.uuid || opts.randomuuid || ""
  const accountType = (opts.type || "").toLowerCase()
  const skinUrl = opts.skinUrl || ""

  const cacheKey = `skin_${cleanName.toLowerCase()}_${accountType}_${effectiveUuid}_${skinUrl}`
  const cached = skinCache.get(cacheKey)
  if (cached) return cached

  if (!cleanName || cleanName.toLowerCase() === "steve") {
    return getSteveSkinBuffer()
  }

  const textures = await getTextures(cleanName, opts)
  if (!textures?.SKIN?.url) {
    return getSteveSkinBuffer()
  }

  // Читаем только публичные http(s)-адреса: раньше здесь открывался любой путь
  // с диска (textures.SKIN.url подставляет auth-сервер) — это давало LFI/SSRF.
  if (!isPublicHttpUrl(textures.SKIN.url)) {
    logRuntime(`[Avatar] Отклонён недопустимый адрес текстуры: ${textures.SKIN.url.slice(0, 120)}`)
    return getSteveSkinBuffer()
  }

  try {
    const skinRes = await http.get<ArrayBuffer>(textures.SKIN.url, { responseType: "arraybuffer" })
    const skinBuffer = Buffer.from(skinRes.data)
    skinCache.set(cacheKey, skinBuffer, 3600)
    return skinBuffer
  } catch {
    return getSteveSkinBuffer()
  }
}

/**
 * Получить PNG-буфер текстуры плаща
 */
export async function getCapeBuffer(
  username: string,
  options?: PlayerTextureOptions | string | null
): Promise<Buffer | null> {
  const cleanName = (username || "").trim()
  const opts: PlayerTextureOptions = typeof options === "string" ? { uuid: options } : options ?? {}
  const effectiveUuid = opts.uuid || opts.randomuuid || ""
  const accountType = (opts.type || "").toLowerCase()

  const cacheKey = `cape_${cleanName.toLowerCase()}_${accountType}_${effectiveUuid}`
  const cached = capeCache.get(cacheKey)
  if (cached) return cached

  const textures = await getTextures(cleanName, opts)
  if (!textures?.CAPE?.url) return null

  try {
    const capeRes = await http.get<ArrayBuffer>(textures.CAPE.url, { responseType: "arraybuffer" })
    const capeBuffer = Buffer.from(capeRes.data)
    capeCache.set(cacheKey, capeBuffer, 3600)
    return capeBuffer
  } catch {
    return null
  }
}

/**
 * Сбросить кэш текстур и аватарок для конкретного игрока или полностью
 */
export function invalidateAvatarCache(params?: { username?: string; uuid?: string; type?: string }): void {
  if (!params || (!params.username && !params.uuid)) {
    texturesCache.clear()
    headCache.clear()
    skinCache.clear()
    capeCache.clear()
    logRuntime("[Avatar] Full avatar cache invalidated")
    return
  }

  const cleanName = (params.username || "").trim().toLowerCase()
  const cleanUuid = (params.uuid || "").replace(/-/g, "").toLowerCase()

  const matchKey = (key: string) => {
    const k = key.toLowerCase()
    if (cleanName && k.includes(cleanName)) return true
    if (cleanUuid && k.includes(cleanUuid)) return true
    return false
  }

  texturesCache.deleteMatching(matchKey)
  headCache.deleteMatching(matchKey)
  skinCache.deleteMatching(matchKey)
  capeCache.deleteMatching(matchKey)
  logRuntime(`[Avatar] Invalidated cache for username=${cleanName} uuid=${cleanUuid}`)
}

/**
 * Регистрация схемы протокола avatar:// (должна вызываться до app.whenReady())
 */
export function registerAvatarProtocolScheme() {
  try {
    protocol.registerSchemesAsPrivileged([
      {
        scheme: "avatar",
        privileges: {
          standard: true,
          secure: true,
          supportFetchAPI: true,
          corsEnabled: true,
          bypassCSP: true,
          stream: true,
        },
      },
    ])
  } catch (err) {
    logRuntime(`[Avatar] Failed to register scheme privileged: ${String(err)}`)
  }
}

/**
 * Регистрация обработчиков протокола avatar:// и IPC-каналов
 */
export function registerAvatarHandlers() {
  app.whenReady().then(() => {
    // Обработчик протокола avatar://
    try {
      protocol.handle("avatar", async (request) => {
        try {
          const url = new URL(request.url)
          const action = (url.hostname || "").toLowerCase()
          let username = url.searchParams.get("username")
          const uuid = url.searchParams.get("uuid") || url.searchParams.get("randomuuid")
          const type = url.searchParams.get("type") || url.searchParams.get("skin_type")
          const skinUrl = url.searchParams.get("skin_url") || url.searchParams.get("skinUrl")
          const size = parseInt(url.searchParams.get("size") || "64", 10) || 64
          const opts: PlayerTextureOptions = { uuid, type, skinUrl }

          if (!username) {
            const rawPart = url.pathname.replace(/^\/+/, "").split("/")[0] || ""
            let pathPart = rawPart
            try {
              pathPart = decodeURIComponent(rawPart)
            } catch {}
            if (action === "head" || action === "skin" || action === "cape") {
              username = pathPart
            } else if (action && !["head", "skin", "cape"].includes(action)) {
              username = action
            } else if (pathPart) {
              username = pathPart
            }
          }

          if (action === "skin") {
            const skinBuf = await getSkinBuffer(username || "Steve", opts)
            if (!skinBuf) return new Response("Skin not found", { status: 404 })
            return new Response(new Uint8Array(skinBuf), {
              headers: { "Content-Type": "image/png", "Cache-Control": "public, max-age=3600" },
            })
          }

          if (action === "cape") {
            if (!username) return new Response("Missing username", { status: 400 })
            const capeBuf = await getCapeBuffer(username, opts)
            if (!capeBuf) return new Response("Cape not found", { status: 404 })
            return new Response(new Uint8Array(capeBuf), {
              headers: { "Content-Type": "image/png", "Cache-Control": "public, max-age=3600" },
            })
          }

          // По умолчанию отдаём голову (аватар)
          const headBuf = await getHeadBuffer(username || "Steve", size, opts)
          return new Response(new Uint8Array(headBuf), {
            headers: { "Content-Type": "image/png", "Cache-Control": "public, max-age=600" },
          })
        } catch {
          return new Response(new Uint8Array(getFallbackSteveHead(64)), {
            headers: { "Content-Type": "image/png" },
          })
        }
      })
      logRuntime("[Avatar] Protocol avatar:// registered")
    } catch (err) {
      logRuntime(`[Avatar] Failed to handle protocol avatar://: ${String(err)}`)
    }
  })

  // IPC-каналы
  ipcMain.handle(
    "avatar:get-textures",
    async (_event, username: string, options?: PlayerTextureOptions) => {
      return getTextures(username, options)
    }
  )

  ipcMain.handle(
    "avatar:get-head",
    async (_event, options: { username: string; size?: number; uuid?: string; randomuuid?: string; type?: string }) => {
      try {
        const buffer = await getHeadBuffer(options.username, options.size ?? 64, options)
        return {
          success: true,
          dataUrl: `data:image/png;base64,${buffer.toString("base64")}`,
        }
      } catch (err) {
        return {
          success: false,
          error: err instanceof Error ? err.message : String(err),
        }
      }
    }
  )

  ipcMain.handle(
    "avatar:get-skin",
    async (_event, username: string, options?: PlayerTextureOptions) => {
      try {
        const buffer = await getSkinBuffer(username, options)
        if (!buffer) return { success: false, error: "Skin not found" }
        return {
          success: true,
          dataUrl: `data:image/png;base64,${buffer.toString("base64")}`,
        }
      } catch (err) {
        return { success: false, error: err instanceof Error ? err.message : String(err) }
      }
    }
  )

  ipcMain.handle(
    "avatar:get-cape",
    async (_event, username: string, options?: PlayerTextureOptions) => {
      try {
        const buffer = await getCapeBuffer(username, options)
        if (!buffer) return { success: false, error: "Cape not found" }
        return {
          success: true,
          dataUrl: `data:image/png;base64,${buffer.toString("base64")}`,
        }
      } catch (err) {
        return { success: false, error: err instanceof Error ? err.message : String(err) }
      }
    }
  )

  ipcMain.handle(
    "avatar:invalidate-cache",
    async (_event, params?: { username?: string; uuid?: string; type?: string }) => {
      invalidateAvatarCache(params)
      return { success: true }
    }
  )

  logRuntime("[Avatar] Handlers and protocol registered")
}
