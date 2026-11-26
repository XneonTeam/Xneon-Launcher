import { describe, expect, test } from "bun:test"
import { ShareError } from "@xnlc/share"
import { APP_USER_AGENT } from "../../lib/app-meta.ts"
import { readShareJson, shareFetch, shareHeaders, shareHttpError } from "../../electrobun/main/share/http.ts"

function challengeResponse(body = "<!DOCTYPE html><html><head><title>Just a moment...</title></head></html>", status = 403) {
  return new Response(body, { status, headers: { "content-type": "text/html; charset=UTF-8", "cf-mitigated": "challenge" } })
}

describe("запросы Share к API", () => {
  test("заголовки содержат подпись лаунчера и Accept JSON", () => {
    expect(shareHeaders()).toEqual({ Accept: "application/json", "User-Agent": APP_USER_AGENT })
    expect(shareHeaders({ Authorization: "Bearer t" })).toEqual({ Accept: "application/json", "User-Agent": APP_USER_AGENT, Authorization: "Bearer t" })
    expect(APP_USER_AGENT).toStartWith("Xneon-Launcher/")
  })

  test("JSON-ответ возвращается как есть", async () => {
    expect(await readShareJson(Response.json({ id: "challenge", nonce: "n" }))).toEqual({ id: "challenge", nonce: "n" })
    expect(await readShareJson(Response.json({ error: { code: "AUTH_KEY", message: "Invalid launcher key" } }, { status: 400 }))).toEqual({ error: { code: "AUTH_KEY", message: "Invalid launcher key" } })
    expect(await readShareJson(new Response("", { status: 204 }))).toBeUndefined()
  })

  test("Cloudflare challenge превращается в SERVICE_UNAVAILABLE, а не в SyntaxError", async () => {
    for (const response of [challengeResponse(), challengeResponse("<html>blocked</html>", 503)]) {
      let error: unknown
      try { await readShareJson(response) } catch (caught) { error = caught }
      expect(error).toBeInstanceOf(ShareError)
      expect((error as ShareError).code).toBe("SERVICE_UNAVAILABLE")
      expect((error as ShareError).message).toContain("Cloudflare challenge")
    }
  })

  test("прочий нечитаемый ответ остаётся HTTP-ошибкой", async () => {
    for (const response of [new Response("Bad Gateway", { status: 502 }), new Response("<html>proxy</html>", { status: 200 })]) {
      let error: unknown
      try { await readShareJson(response) } catch (caught) { error = caught }
      expect(error).toBeInstanceOf(ShareError)
      expect((error as ShareError).code).toBe("HTTP")
    }
  })

  test("ошибка сервера сохраняет код и текст API", () => {
    expect(shareHttpError({ error: { code: "AUTH_KEY", message: "Invalid launcher key" } }, "fallback")).toMatchObject({ code: "AUTH_KEY", message: "Invalid launcher key" })
    expect(shareHttpError(undefined, "fallback")).toMatchObject({ code: "HTTP", message: "fallback" })
  })

  test("сетевой сбой становится SERVICE_UNAVAILABLE, отмена проходит как есть", async () => {
    const original = globalThis.fetch
    try {
      globalThis.fetch = (async () => { throw new TypeError("fetch failed") }) as typeof fetch
      let error: unknown
      try { await shareFetch("https://share.example/v1/health") } catch (caught) { error = caught }
      expect(error).toBeInstanceOf(ShareError)
      expect((error as ShareError).code).toBe("SERVICE_UNAVAILABLE")
      expect((error as ShareError).message).toContain("unreachable")

      globalThis.fetch = (async () => { throw Object.assign(new Error("aborted"), { name: "AbortError" }) }) as typeof fetch
      let aborted: unknown
      try { await shareFetch("https://share.example/v1/health") } catch (caught) { aborted = caught }
      expect((aborted as Error).name).toBe("AbortError")
      expect(aborted).not.toBeInstanceOf(ShareError)
    } finally { globalThis.fetch = original }
  })
})
