// ============================================================
// XNLC — OAuth loopback-flow для облачных провайдеров
// ============================================================
//
// Четыре провайдера (Google Drive, OneDrive, Dropbox, Яндекс Диск) реализовали
// один и тот же сценарий: поднять локальный HTTP-сервер на своём порту,
// открыть в браузере URL авторизации, поймать `code` в колбэке, обменять его на
// токен, показать страницу успеха/ошибки и закрыть сервер. Различались только
// client_id, порт, scope и запрос обмена — то есть ~60 строк, скопированные
// четыре раза.
//
// Здесь остался общий каркас; провайдер передаёт свою конфигурацию и функцию
// обмена. Заодно централизованы таймер ожидания (снимается при завершении) и
// обработка ошибок.

import http from "http"
import { URL } from "url"
import { shell } from "electron"
import { callbackSuccessPage, callbackErrorPage } from "./callback-page"
import { generatePkcePair } from "./pkce"
import { toErrorMessage } from "../errors"
import type { CloudAuthResult, CloudProviderId } from "./provider"

/** Сколько ждём колбэк от браузера, мс. */
const CALLBACK_TIMEOUT_MS = 120_000

export type OAuthLoopbackConfig = {
  /** Как называть провайдера на странице, которую увидит пользователь. */
  providerLabel: string
  /** Значение provider в результате (id провайдера). */
  providerId: CloudProviderId
  /** Порт локального сервера; он же в redirect_uri. */
  port: number
  /** Собирает URL авторизации по PKCE-challenge. */
  buildAuthUrl: (params: { challenge: string }) => string
  /**
   * Обменивает код на токен и сохраняет его. Бросить исключение = показать
   * пользователю страницу ошибки.
   */
  exchange: (code: string, verifier: string) => Promise<void>
}

/**
 * Запускает loopback-flow и резолвится результатом авторизации.
 * Никогда не бросает: ошибка приходит в `{ success: false, error }`.
 */
export function runOAuthLoopback(config: OAuthLoopbackConfig): Promise<CloudAuthResult> {
  return new Promise((resolve) => {
    const { verifier, challenge } = generatePkcePair()
    const authUrl = config.buildAuthUrl({ challenge })
    let timeoutTimer: NodeJS.Timeout | null = null
    let settled = false

    /** Завершение: снимаем таймер, закрываем сервер, резолвим один раз. */
    const finish = (result: CloudAuthResult): void => {
      if (settled) return
      settled = true
      if (timeoutTimer) clearTimeout(timeoutTimer)
      try { server.close() } catch { /* сервер мог уже закрыться */ }
      resolve(result)
    }

    const server = http.createServer(async (req, res) => {
      const url = new URL(req.url || "/", `http://localhost:${config.port}`)
      const code = url.searchParams.get("code")
      if (!code) {
        res.writeHead(400)
        res.end("No code")
        return
      }

      try {
        await config.exchange(code, verifier)
        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" })
        res.end(callbackSuccessPage(config.providerLabel))
        finish({ success: true, provider: config.providerId })
      } catch (error) {
        const message = toErrorMessage(error)
        res.writeHead(500, { "Content-Type": "text/html; charset=utf-8" })
        res.end(callbackErrorPage(config.providerLabel, message))
        finish({ success: false, error: message })
      }
    })

    server.on("error", (error) => {
      // Порт занят или сервер не поднялся — сообщаем пользователю, а не висим.
      finish({ success: false, error: toErrorMessage(error) })
    })

    server.listen(config.port, () => {
      shell.openExternal(authUrl.toString())
    })

    timeoutTimer = setTimeout(() => finish({ success: false, error: "Timeout" }), CALLBACK_TIMEOUT_MS)
  })
}