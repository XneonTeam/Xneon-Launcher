import { describe, expect, test } from "bun:test"
import { credentialsForShareUrl, DEFAULT_SHARE_URL, resolveShareUrl } from "../../electrobun/main/share/service-url.ts"

describe("адрес Share API", () => {
  test("без переопределения используется публичный домен", () => {
    expect(DEFAULT_SHARE_URL).toBe("https://share.xneon.org")
    expect(resolveShareUrl(undefined)).toBe("https://share.xneon.org")
    expect(resolveShareUrl("")).toBe("https://share.xneon.org")
    expect(resolveShareUrl("   ")).toBe("https://share.xneon.org")
  })

  test("переопределение обрезается, хвостовые слэши снимаются", () => {
    expect(resolveShareUrl("  http://127.0.0.1:8787  ")).toBe("http://127.0.0.1:8787")
    expect(resolveShareUrl("https://share.example/")).toBe("https://share.example")
    expect(resolveShareUrl("https://share.example///")).toBe("https://share.example")
  })

  test("credentials другого адреса не переиспользуются", () => {
    const url = resolveShareUrl(undefined)
    expect(credentialsForShareUrl({ url: "https://xnlc-share.example.workers.dev", token: "t" }, url)).toBeUndefined()
    expect(credentialsForShareUrl({ url: "https://share.xneon.org", token: "t" }, url)).toEqual({ url: "https://share.xneon.org", token: "t" })
    expect(credentialsForShareUrl({ url: " https://share.xneon.org/ ", token: "t" }, url)).toEqual({ url: " https://share.xneon.org/ ", token: "t" })
    expect(credentialsForShareUrl(undefined, url)).toBeUndefined()
  })
})
