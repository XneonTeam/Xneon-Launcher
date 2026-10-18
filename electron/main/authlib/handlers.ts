// ============================================================
// XNLC — Authlib-Injector: IPC handlers
// Регистрация каналов authlib:* + асинхронный refresh метаданных
// сохранённых серверов при старте (не блокирует UI).
// ============================================================

import { ipcMain } from "electron"
import type {
  AuthlibAddServerOutcome,
  AuthlibInjectorServer,
  AuthlibInjectorServerSummary,
  AuthlibInjectorErrorOutcome,
  AuthlibLoginOutcome,
  AuthlibProbeOutcome,
  AuthlibSessionOutcome,
} from "@xnlc/types" with { "resolution-mode": "import" }
import { dbHelpers, authServerToSummary } from "../../db"
import { AuthlibError, toAuthlibError } from "./errors"
import { resolveAuthlibInjectorServer, refreshServer } from "./server"
import {
  ensureSession,
  getProfileTextures,
  invalidateSession,
  loginToServer,
} from "./service"

function log(message: string): void {
  console.log(`[AuthlibInjector] ${message}`)
}

/**
 * Хост для лога. Строку URL в лог не пишем: в ней может быть userinfo
 * (https://user:pass@host/), а логи доступны пользователю и агенту.
 */
function hostForLog(input: unknown): string {
  try {
    const parsed = new URL(String(input ?? "").trim())
    return parsed.host || "(no host)"
  } catch {
    return "(unparsed)"
  }
}

function errorOutcome(error: unknown): AuthlibInjectorErrorOutcome {
  const authError = error instanceof AuthlibError ? error : toAuthlibError(error)
  return {
    ok: false,
    error: {
      code: authError.code,
      // Сообщения уже обезличены (см. errors.ts/yggdrasil.ts) — пароли/токены
      // сюда не попадают.
      message: authError.message,
    },
  }
}

export function registerAuthlibHandlers(): void {
  // Список сохранённых серверов.
  ipcMain.handle("authlib:list-servers", async (): Promise<AuthlibInjectorServerSummary[]> => {
    return dbHelpers.loadAuthServers().map(authServerToSummary)
  })

  // Проверка URL перед добавлением: нормализация → GET → header → metadata.
  // Ничего не сохраняет.
  ipcMain.handle("authlib:probe-server", async (_event, url: string): Promise<AuthlibProbeOutcome> => {
    try {
      log(`Resolving server: ${hostForLog(url)}`)
      const server = await resolveAuthlibInjectorServer(url)
      log(`Resolved API endpoint: ${server.url}`)
      log(`Server name: ${server.name}`)
      return { ok: true, server }
    } catch (error) {
      return errorOutcome(error)
    }
  })

  // Сохранение проверенного сервера (объект приходит из probe-server).
  // Типизированный исход, а не rejection: раньше ошибка resolve улетала
  // отклонённым промисом, и UI оставался на шаге подтверждения без сообщения.
  ipcMain.handle("authlib:add-server", async (_event, server: AuthlibInjectorServer): Promise<AuthlibAddServerOutcome> => {
    try {
      // Двойная проверка: не доверяем объекту из renderer, прогоняем resolve заново.
      const resolved = await resolveAuthlibInjectorServer(server.url)
      dbHelpers.saveAuthServer(resolved)
      log(`Server added: ${resolved.name} (${resolved.url})`)
      return { ok: true, server: authServerToSummary(resolved) }
    } catch (error) {
      return errorOutcome(error)
    }
  })

  // Удаление сервера. Связанные аккаунты НЕ удаляются молча — renderer
  // сам запрашивает подтверждение, получая removedAccounts.
  ipcMain.handle("authlib:remove-server", async (_event, id: string): Promise<{ removedAccounts: number }> => {
    const linked = dbHelpers.findAccountsByServer(id)
    dbHelpers.deleteAuthServer(id)
    log(`Server removed: ${id} (linked accounts: ${linked.length})`)
    return { removedAccounts: linked.length }
  })

  // Асинхронное обновление метаданных (на старте и по кнопке Refresh в UI).
  ipcMain.handle("authlib:refresh-server", async (_event, id: string): Promise<AuthlibInjectorServerSummary | null> => {
    const server = dbHelpers.getAuthServer(id)
    if (!server) return null
    try {
      const updated = await refreshServer(server)
      if (!updated) return null
      dbHelpers.saveAuthServer(updated)
      return authServerToSummary(updated)
    } catch {
      return null
    }
  })

  // Username/password логин. Пароль уходит только в authenticate-запрос.
  ipcMain.handle(
    "authlib:login",
    async (event, serverId: string, username: string, password: string, profileId?: string): Promise<AuthlibLoginOutcome> => {
      try {
        const result = await loginToServer(serverId, username, password, profileId, (phase) => {
          // Прогресс по фазам: логин — три последовательных сетевых шага,
          // без них окно выглядит «зависшим».
          try {
            event.sender.send("authlib:login-progress", { phase })
          } catch {
            // Окно могли закрыть — прогресс больше не нужен.
          }
        })
        return { ok: true, result }
      } catch (error) {
        return errorOutcome(error)
      }
    },
  )

  // Validate/refresh токена перед запуском. Не бросает исключений в renderer —
  // статус + сообщение.
  ipcMain.handle("authlib:ensure-session", async (_event, accountId: string): Promise<AuthlibSessionOutcome> => {
    return ensureSession(accountId)
  })

  // Logout: invalidate на сервере.
  ipcMain.handle("authlib:invalidate", async (_event, accountId: string): Promise<boolean> => {
    return invalidateSession(accountId)
  })

  // Текстуры профиля (скин/плащ) из sessionserver.
  ipcMain.handle("authlib:get-profile-textures", async (_event, serverId: string, uuid: string) => {
    try {
      return await getProfileTextures(serverId, uuid)
    } catch {
      return null
    }
  })
}

/**
 * Стартовый refresh метаданных всех сохранённых серверов — без await,
 * параллельно, с тихим фолбэком: недоступный сервер оставляет старые данные,
 * UI не зависает.
 */
export function refreshAuthServersInBackground(): void {
  setImmediate(() => {
    const servers = dbHelpers.loadAuthServers()
    if (servers.length === 0) return
    void Promise.allSettled(servers.map(async (server) => {
      try {
        const updated = await refreshServer(server)
        if (updated) dbHelpers.saveAuthServer(updated)
      } catch {
        // Тихо: сервер недоступен, оставляем кэш.
      }
    })).then(() => {
      log(`Background metadata refresh completed for ${servers.length} server(s)`)
    })
  })
}
