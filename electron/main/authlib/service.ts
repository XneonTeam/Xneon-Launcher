// ============================================================
// XNLC — Authlib-Injector: account session service
// Логин по username/password, ensure-session (validate → refresh),
// logout (invalidate), текстуры профиля. Всё работает через
// сервер, привязанный к аккаунту (serverId) — аккаунт с сервера A
// никогда не ходит на endpoint'ы сервера B.
//
// Безопасность: пароль живёт только в аргументах вызова и теле
// authenticate-запроса; accessToken/clientToken не пишутся в логи.
// ============================================================

import crypto from "node:crypto"
import type {
  AuthlibInjectorLoginResult,
  AuthlibInjectorServer,
  AuthlibLoginPhase,
  AuthlibSessionOutcome,
  DbAccount,
  YggdrasilGameProfile,
  YggdrasilProfileWithTextures,
} from "@xnlc/types" with { "resolution-mode": "import" }
import { dbHelpers } from "../../db"
import { AuthlibError, YggdrasilInvalidTokenError } from "./errors"
import { fetchMetadata } from "./server"
import { YggdrasilClient } from "./yggdrasil"

/** Debug-лог без секретов. */
function log(message: string): void {
  console.log(`[AuthlibInjector] ${message}`)
}

function getServerOrThrow(serverId: string): AuthlibInjectorServer {
  const server = dbHelpers.getAuthServer(serverId)
  if (!server) {
    throw new AuthlibError("server_not_found", "Authorization server not found — add it again")
  }
  return server
}

/** UUID профиля в формате с дефисами (для консистентности с остальными аккаунтами). */
function formatUuid(rawId: string): string {
  const clean = rawId.replace(/-/g, "").toLowerCase()
  if (!/^[0-9a-f]{32}$/.test(clean)) return rawId
  return `${clean.slice(0, 8)}-${clean.slice(8, 12)}-${clean.slice(12, 16)}-${clean.slice(16, 20)}-${clean.slice(20, 32)}`
}

/** JSON, который кладём в accounts.profiles. */
type StoredProfiles = {
  selected: YggdrasilGameProfile
  available: YggdrasilGameProfile[]
}

function parseStoredProfiles(raw?: string): StoredProfiles | null {
  if (!raw) return null
  try {
    const parsed = JSON.parse(raw) as StoredProfiles
    if (parsed?.selected?.id && parsed?.selected?.name) return parsed
  } catch {}
  return null
}

/** Общий дедлайн логина (метаданные + authenticate + профили), мс. */
export const LOGIN_DEADLINE_MS = 30_000

/**
 * Полный логин: authenticate → (возможно) выбор профиля → аккаунт.
 *
 * profileId задан → повторный вызов после выбора персонажа в UI.
 * Без profileId и с >1 профиля возвращаем requiresProfileSelection=true
 * со списком профилей (с текстурами для превью), БД не трогаем.
 */
export async function loginToServer(
  serverId: string,
  username: string,
  password: string,
  profileId?: string,
  onPhase?: (phase: AuthlibLoginPhase) => void,
): Promise<AuthlibInjectorLoginResult> {
  const server = getServerOrThrow(serverId)

  // Один дедлайн на весь логин. Раньше метаданные, authenticate и профили
  // шли последовательно по 15 с каждый — окно было заперто до ~45 с без
  // прогресса. Сигнал прокидывается в fetch, поэтому запрос реально
  // прерывается, а не просто перестаёт обновлять UI.
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), LOGIN_DEADLINE_MS)
  try {
    return await loginWithServer(server, username, password, profileId, controller.signal, onPhase)
  } finally {
    clearTimeout(timer)
  }
}

async function loginWithServer(
  server: AuthlibInjectorServer,
  username: string,
  password: string,
  profileId: string | undefined,
  signal: AbortSignal,
  onPhase?: (phase: AuthlibLoginPhase) => void,
): Promise<AuthlibInjectorLoginResult> {
  log(`Resolving server: ${server.url}`)

  // Перед логином нужны актуальные метаданные (не кэш).
  onPhase?.("metadata")
  const metadata = await fetchMetadata(server.url, { signal })
  if (metadata) {
    log(`Metadata loaded (server: ${metadata.meta?.serverName ?? server.name})`)
  } else {
    log("Metadata unavailable — proceeding with known server configuration")
  }

  onPhase?.("authenticate")
  const clientToken = crypto.randomUUID()
  const client = new YggdrasilClient(server.url, metadata, signal)
  const session = await client.authenticate({ username, password, clientToken })
  log("Authentication successful")

  const profiles = session.availableProfiles
  let selected: YggdrasilGameProfile | undefined = session.selectedProfile

  if (profileId) {
    const wanted = profileId.replace(/-/g, "").toLowerCase()
    selected = profiles.find((p) => p.id.replace(/-/g, "").toLowerCase() === wanted)
      ?? (selected && selected.id.replace(/-/g, "").toLowerCase() === wanted ? selected : undefined)
    if (!selected) {
      throw new AuthlibError("profile_required", "Selected profile is not available on this account")
    }
  }

  if (!selected && profiles.length === 1) {
    selected = profiles[0]
  }

  // Декорируем профили текстурами для UI выбора/аватарок.
  onPhase?.("profiles")
  const decorated: YggdrasilProfileWithTextures[] = await Promise.all(
    profiles.map(async (profile) => {
      try {
        const full = await client.fetchProfile(profile.id)
        return full ? { ...profile, ...(full.textures ? { textures: full.textures } : {}) } : { ...profile }
      } catch {
        return { ...profile }
      }
    }),
  )

  if (profiles.length === 0) {
    throw new AuthlibError("profile_required", "This account has no Minecraft profiles")
  }

  // Много профилей и явный выбор не задан — UI показывает список.
  // Токены возвращаем (UI их пока не сохраняет), аккаунт в БД не пишем.
  if (!selected) {
    log(`Account has ${profiles.length} profiles — selection required`)
    return {
      type: "authlib-injector",
      id: "",
      username,
      uuid: "",
      accessToken: session.accessToken,
      clientToken: session.clientToken,
      serverId: server.id,
      serverUrl: server.url,
      serverName: server.name,
      availableProfiles: decorated,
      requiresProfileSelection: true,
    }
  }

  // Если выбранного нет в available — всё равно берём его (selectedProfile
  // от сервера авторитетен), но добавляем в список для полноты.
  const available = decorated.some((p) => sameProfile(p, selected!))
    ? decorated
    : [{ ...selected }, ...decorated]

  const accountId = makeAccountId(server.id, selected.id)
  const stored: StoredProfiles = { selected, available: profiles }

  const account: DbAccount = {
    id: accountId,
    type: "authlib-injector",
    username: selected.name,
    isActive: false,
    uuid: formatUuid(selected.id),
    accessToken: session.accessToken,
    serverId: server.id,
    serverUrl: server.url,
    serverName: server.name,
    yggClientToken: session.clientToken,
    profiles: JSON.stringify(stored),
  }

  await dbHelpers.saveAccount(account)
  log(`Account saved: ${selected.name} (server: ${server.name})`)

  // Текстуры выбранного профиля — для аватарки.
  const selectedDecorated = available.find((p) => sameProfile(p, selected!))

  return {
    type: "authlib-injector",
    id: accountId,
    username: selected.name,
    uuid: account.uuid!,
    accessToken: session.accessToken,
    clientToken: session.clientToken,
    serverId: server.id,
    serverUrl: server.url,
    serverName: server.name,
    selectedProfile: selected,
    availableProfiles: available,
    requiresProfileSelection: false,
    ...(selectedDecorated?.textures?.skin?.url ? { skinUrl: selectedDecorated.textures.skin.url } : {}),
  }
}

/**
 * Ensure-session перед запуском: validate → (нет) → refresh → (нет) → expired.
 * Обновлённый токен сохраняется в БД. Сетевые ошибки НЕ роняют лаунчер:
 * статус "unreachable" с сообщением, вызывающий код решает сам.
 */
export async function ensureSession(accountId: string, signal?: AbortSignal): Promise<AuthlibSessionOutcome> {
  const account = (await dbHelpers.loadAccounts()).find((a) => a.id === accountId)
  if (!account || account.type !== "authlib-injector") return { status: "not_found" }
  if (!account.serverUrl || !account.accessToken) {
    // Токена нет (например, пользователь уже выходил) — нужен повторный вход.
    return { status: "expired", message: "Authorization token expired — sign in again" }
  }

  const client = new YggdrasilClient(account.serverUrl, undefined, signal)
  const stored = parseStoredProfiles(account.profiles)
  const clientToken = account.yggClientToken

  try {
    const valid = await client.validate({
      accessToken: account.accessToken,
      clientToken,
    })
    if (valid) return { status: "valid" }

    log(`Token invalid for ${account.username} — refreshing`)
    const session = await client.refresh({
      accessToken: account.accessToken,
      clientToken,
      selectedProfile: stored?.selected,
    })

    const updated: DbAccount = {
      ...account,
      accessToken: session.accessToken,
      yggClientToken: session.clientToken || clientToken,
      ...(session.selectedProfile
        ? { uuid: formatUuid(session.selectedProfile.id), username: session.selectedProfile.name }
        : {}),
    }
    await dbHelpers.saveAccount(updated)
    log(`Token refreshed for ${updated.username}`)
    return { status: "refreshed" }
  } catch (error) {
    if (error instanceof YggdrasilInvalidTokenError) {
      // Токен мёртв — аккаунт требует повторного входа, но НЕ удаляется.
      log(`Session expired for ${account.username} — re-login required`)
      await dbHelpers.saveAccount({ ...account, accessToken: undefined })
      return { status: "expired", message: "Authorization token expired — sign in again" }
    }
    const authError = error instanceof AuthlibError ? error : null
    if (authError && (authError.code === "timeout" || authError.code === "connection" || authError.code === "ssl")) {
      // Сервер недоступен: оставляем токен как есть.
      log(`Server unreachable for ${account.username}: ${authError.code}`)
      return { status: "unreachable", message: authError.message }
    }
    // Прочие ошибки сервера — тоже не фатальны для запуска.
    log(`Ensure-session failed for ${account.username}`)
    return {
      status: "unreachable",
      message: error instanceof Error ? error.message : "Authorization server error",
    }
  }
}

/** Logout: invalidate на сервере, токен чистится локально. Аккаунт остаётся. */
export async function invalidateSession(accountId: string): Promise<boolean> {
  const account = (await dbHelpers.loadAccounts()).find((a) => a.id === accountId)
  if (!account || account.type !== "authlib-injector") return false
  if (!account.serverUrl || !account.accessToken || !account.yggClientToken) return false

  const client = new YggdrasilClient(account.serverUrl)
  try {
    await client.invalidate({ accessToken: account.accessToken, clientToken: account.yggClientToken })
    await dbHelpers.saveAccount({ ...account, accessToken: undefined })
    log(`Token invalidated for ${account.username}`)
    return true
  } catch (error) {
    log(`Invalidate failed for ${account.username}: ${error instanceof AuthlibError ? error.code : "unknown"}`)
    return false
  }
}

/** Текстуры профиля с sessionserver (для UI/аватарок). */
export async function getProfileTextures(
  serverId: string,
  uuid: string,
): Promise<YggdrasilProfileWithTextures | null> {
  const server = getServerOrThrow(serverId)
  const client = new YggdrasilClient(server.url)
  return client.fetchProfile(uuid)
}

function sameProfile(a: YggdrasilGameProfile, b: YggdrasilGameProfile): boolean {
  return a.id.replace(/-/g, "").toLowerCase() === b.id.replace(/-/g, "").toLowerCase()
}

/** Стабильный id аккаунта: один и тот же профиль на одном сервере не дублируется. */
export function makeAccountId(serverId: string, profileId: string): string {
  const clean = profileId.replace(/-/g, "").toLowerCase()
  return `authlib:${serverId}:${clean}`
}
