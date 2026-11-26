import { describe, expect, test } from "bun:test"
import { ShareApiClient } from "../../packages/xnlc-share/src/client.ts"
import { ShareError } from "../../packages/xnlc-share/src/types.ts"

function client(respond: () => Response, seen: RequestInit[] = []) {
  return new ShareApiClient("https://share.example", async () => "session-token", async (_url, init) => { seen.push(init ?? {}); return respond() })
}

async function rejection(run: Promise<unknown>): Promise<ShareError> {
  try { await run } catch (error) {
    if (error instanceof ShareError) return error
    throw error
  }
  throw new Error("ожидалась ошибка Share")
}

describe("клиент Share API", () => {
  test("каждый запрос несёт User-Agent, Accept и токен", async () => {
    const seen: RequestInit[] = []
    const repository = await client(() => Response.json({ id: "repo-1" }), seen).create()
    expect(repository).toBe("repo-1")
    const headers = new Headers(seen[0].headers)
    expect(headers.get("user-agent")).toBe("xnlc-share")
    expect(headers.get("accept")).toBe("application/json")
    expect(headers.get("authorization")).toBe("Bearer session-token")
  })

  test("Cloudflare challenge не маскируется под синтаксическую ошибку", async () => {
    const challenged = client(() => new Response("<!DOCTYPE html><html><title>Just a moment...</title></html>", { status: 403, headers: { "cf-mitigated": "challenge", "content-type": "text/html" } }))
    const error = await rejection(challenged.create())
    expect(error.code).toBe("SERVICE_UNAVAILABLE")
    expect(error.message).toContain("Cloudflare challenge")
  })

  test("JSON-ошибка сервера сохраняет код", async () => {
    const unauthorized = client(() => Response.json({ error: { code: "UNAUTHORIZED", message: "Launcher proof is invalid or expired" } }, { status: 401 }))
    const error = await rejection(unauthorized.create())
    expect(error.code).toBe("UNAUTHORIZED")
    expect(error.message).toBe("Launcher proof is invalid or expired")
  })

  test("сетевой сбой транспорта — SERVICE_UNAVAILABLE, отмена остаётся отменой", async () => {
    const offline = new ShareApiClient("https://share.example", async () => "token", async () => { throw new TypeError("getaddrinfo ENOTFOUND share.example") })
    const unavailable = await rejection(offline.create())
    expect(unavailable.code).toBe("SERVICE_UNAVAILABLE")
    expect(unavailable.message).toContain("unreachable")

    const aborted = new ShareApiClient("https://share.example", async () => "token", async () => { throw Object.assign(new Error("aborted"), { name: "AbortError" }) })
    let error: unknown
    try { await aborted.create() } catch (caught) { error = caught }
    expect((error as Error).name).toBe("AbortError")
    expect(error).not.toBeInstanceOf(ShareError)
  })
})
