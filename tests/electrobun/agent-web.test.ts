import { describe, expect, test } from "bun:test"
import { gzipSync } from "node:zlib"
import {
  assertPublicHost,
  extractWebPage,
  fetchAgentWebPage,
  isPublicAddress,
  parseWebTarget,
  searchAgentWeb,
  type WebPageResponse,
} from "../../electrobun/main/agent-web"

const PUBLIC = "93.184.216.34"

function page(status: number, headers: Record<string, string>, body: string | Buffer | string[], destroy = () => {}): WebPageResponse {
  const chunks = Array.isArray(body) ? body.map(chunk => Buffer.from(chunk)) : [Buffer.from(body)]
  return {
    status,
    headers,
    body: (async function* () { for (const chunk of chunks) yield chunk })(),
    destroy,
  }
}

describe("web_fetch: адреса", () => {
  test("блокирует loopback, приватные, link-local, multicast и служебные IPv4", () => {
    for (const address of ["127.0.0.1", "127.10.0.1", "10.0.0.1", "172.16.5.4", "172.31.255.255", "192.168.1.1", "169.254.169.254", "100.64.0.1", "198.18.0.1", "198.19.255.255", "0.0.0.0", "224.0.0.1", "239.255.255.250", "240.0.0.1", "255.255.255.255", "192.0.2.10", "198.51.100.7", "203.0.113.9"]) {
      expect(isPublicAddress(address), address).toBe(false)
    }
  })

  test("блокирует IPv6 и IPv4-mapped адреса, включая 6to4 и NAT64", () => {
    for (const address of ["::", "::1", "fe80::1", "fc00::1", "fd12:3456::1", "ff02::1", "2001:db8::1", "2001:0:1234::1", "::ffff:127.0.0.1", "::ffff:10.1.2.3", "::ffff:0:192.168.0.1", "2002:7f00:1::1", "2002:c0a8:0101::1", "64:ff9b::a00:1", "100::1"]) {
      expect(isPublicAddress(address), address).toBe(false)
    }
  })

  test("пропускает публичные адреса и не угадывает неизвестный формат", () => {
    expect(isPublicAddress(PUBLIC)).toBe(true)
    expect(isPublicAddress("2606:2800:220:1:248:1893:25c8:1946")).toBe(true)
    expect(isPublicAddress("::ffff:93.184.216.34")).toBe(true)
    for (const address of ["", "example.com", "1.2.3", "1.2.3.4.5", "fe80::1%eth0", "127.0.0.1 ", "999.1.1.1"]) {
      expect(isPublicAddress(address), address).toBe(false)
    }
  })

  test("принимает только полный HTTP(S)-адрес без учётных данных и нестандартного порта", () => {
    expect(parseWebTarget(" https://example.com/a?b=1#c ").href).toBe("https://example.com/a?b=1#c")
    expect(parseWebTarget("http://example.com").href).toBe("http://example.com/")
    for (const value of ["file:///etc/passwd", "javascript:alert(1)", "data:text/html,hi", "ftp://example.com", "https://user:pass@example.com", "https://user@example.com", "https://example.com:8443/", "http://example.com:443/", "", "example.com", "https://"]) {
      expect(() => parseWebTarget(value), value).toThrow()
    }
  })

  test("fail-closed: смешанный ответ DNS запрещает подключение", async () => {
    await expect(assertPublicHost("example.com", async () => [PUBLIC])).resolves.toBe(PUBLIC)
    await expect(assertPublicHost("example.com", async () => [PUBLIC, "127.0.0.1"])).rejects.toThrow("not allowed")
    await expect(assertPublicHost("example.com", async () => [])).rejects.toThrow("Cannot resolve host")
    await expect(assertPublicHost("example.com", async () => { throw new Error("ENOTFOUND") })).rejects.toThrow("Cannot resolve host")
  })
})

describe("web_fetch: разбор страницы", () => {
  const html = `<!DOCTYPE html><html><head>
    <title>  Mod &amp; Loader — Guide </title>
    <style>body{color:red}</style>
    <script>window.x = "<a href='/evil'>no</a>"</script>
  </head><body>
    <h1>Fabric</h1><p>Установите <b>Fabric&nbsp;API</b> &lt;вручную&gt;.</p>
    <a href="/docs/start">Начало</a>
    <a href="https://example.org/abs#frag">Абсолютная</a>
    <a href="javascript:alert(1)">Плохая</a>
    <a href="/docs/start">Дубликат</a>
    <a href="//cdn.example.org/x">Без схемы</a>
  </body></html>`

  test("извлекает заголовок, текст и абсолютные ссылки без скриптов", () => {
    const result = extractWebPage(html, "https://example.com/base/")
    expect(result.title).toBe("Mod & Loader — Guide")
    expect(result.text).toContain("Fabric API")
    expect(result.text).toContain("<вручную>")
    expect(result.text).not.toContain("window.x")
    expect(result.text).not.toContain("color:red")
    expect(result.links.map(link => link.url)).toEqual([
      "https://example.com/docs/start",
      "https://example.org/abs",
      "https://cdn.example.org/x",
    ])
    expect(result.links[0].text).toBe("Начало")
  })

  test("незакрытый script скрывает остаток документа, битый тег не зацикливает разбор", () => {
    const unclosed = extractWebPage("<p>Before</p><script>while(true){}<p>Hidden</p>", "https://example.com/")
    expect(unclosed.text).toBe("Before")
    const broken = extractWebPage("<p>Visible</p><span class=\"x", "https://example.com/")
    expect(broken.text).toBe("Visible")
    expect(broken.links).toEqual([])
  })

  test("ограничивает текст и число ссылок", () => {
    const many = `<p>${"word ".repeat(200)}</p>` + Array.from({ length: 80 }, (_, index) => `<a href="/p/${index}">Link ${index}</a>`).join("")
    const result = extractWebPage(many, "https://example.com/", { maxText: 50, maxLinks: 5 })
    expect(result.text.length).toBeLessThanOrEqual(50)
    expect(result.textTruncated).toBe(true)
    expect(result.links.length).toBe(5)
    expect(result.linksTruncated).toBe(true)
  })
})

describe("web_fetch: сеть и лимиты", () => {
  test("читает HTML через проверенный IP и сохраняет Host/SNI в запросе", async () => {
    const seen: Array<{ url: string; address: string }> = []
    const result = await fetchAgentWebPage("https://example.com/start", {
      resolve: async () => [PUBLIC],
      connect: async (url, address) => {
        seen.push({ url: url.href, address })
        return page(200, { "content-type": "text/html; charset=utf-8" }, "<title>Hi</title><p>Hello</p>")
      },
    })
    expect(seen).toEqual([{ url: "https://example.com/start", address: PUBLIC }])
    expect(result).toMatchObject({ url: "https://example.com/start", finalUrl: "https://example.com/start", status: 200, contentType: "text/html", title: "Hi", text: "Hello", truncated: false })
  })

  test("проходит редиректы вручную и возвращает конечный адрес", async () => {
    const hops: string[] = []
    const result = await fetchAgentWebPage("https://example.com/a", {
      resolve: async () => [PUBLIC],
      connect: async url => {
        hops.push(url.href)
        return hops.length === 1
          ? page(302, { location: "/b" }, "")
          : page(200, { "content-type": "text/plain" }, "done")
      },
    })
    expect(hops).toEqual(["https://example.com/a", "https://example.com/b"])
    expect(result.finalUrl).toBe("https://example.com/b")
    expect(result.text).toBe("done")
  })

  test("запрещает редирект на localhost и повторную проверку адреса", async () => {
    await expect(fetchAgentWebPage("https://example.com/", {
      resolve: async () => [PUBLIC],
      connect: async () => page(302, { location: "http://127.0.0.1/admin" }, ""),
    })).rejects.toThrow("not allowed")
    await expect(fetchAgentWebPage("https://example.com/", {
      resolve: async () => [PUBLIC],
      connect: async () => page(302, { location: "http://10.0.0.5/" }, ""),
    })).rejects.toThrow("not allowed")
  })

  test("отражает DNS rebinding: второй ответ приватный", async () => {
    const answers = [[PUBLIC], ["127.0.0.1"]]
    let calls = 0
    await expect(fetchAgentWebPage("https://example.com/", {
      resolve: async () => answers[Math.min(calls++, answers.length - 1)],
      connect: async () => page(302, { location: "/next" }, ""),
    })).rejects.toThrow("not allowed")
    expect(calls).toBe(2)
  })

  test("ограничивает число редиректов", async () => {
    await expect(fetchAgentWebPage("https://example.com/", {
      resolve: async () => [PUBLIC],
      connect: async () => page(302, { location: "/next" }, ""),
    })).rejects.toThrow("Too many web redirects")
  })

  test("обрезает тело по лимиту и сообщает об этом", async () => {
    const chunks = Array.from({ length: 10 }, () => "x".repeat(64 * 1024))
    const result = await fetchAgentWebPage("https://example.com/", {
      resolve: async () => [PUBLIC],
      maxBytes: 1000,
      connect: async () => page(200, { "content-type": "text/plain" }, chunks),
    })
    expect(result.bytes).toBe(1000)
    expect(result.byteLimit).toBe(1000)
    expect(result.truncated).toBe(true)
  })

  test("распаковывает Content-Encoding: gzip", async () => {
    const body = gzipSync(Buffer.from("<title>Gzip</title><p>Сжатый текст</p>"))
    const result = await fetchAgentWebPage("https://example.com/", {
      resolve: async () => [PUBLIC],
      connect: async () => page(200, { "content-type": "text/html", "content-encoding": "gzip" }, body),
    })
    expect(result.title).toBe("Gzip")
    expect(result.text).toBe("Сжатый текст")
  })

  test("отклоняет неизвестное кодирование, тип содержимого и HTTP-ошибку", async () => {
    await expect(fetchAgentWebPage("https://example.com/", { resolve: async () => [PUBLIC], connect: async () => page(200, { "content-type": "text/plain", "content-encoding": "zstd" }, "data") })).rejects.toThrow("Unsupported content encoding")
    await expect(fetchAgentWebPage("https://example.com/", { resolve: async () => [PUBLIC], connect: async () => page(200, { "content-type": "application/pdf" }, "%PDF") })).rejects.toThrow("Unsupported web content type")
    await expect(fetchAgentWebPage("https://example.com/", { resolve: async () => [PUBLIC], connect: async () => page(404, { "content-type": "text/html" }, "missing") })).rejects.toThrow("HTTP 404")
  })

  test("прерывает зависший запрос общим таймаутом", async () => {
    await expect(fetchAgentWebPage("https://example.com/", {
      timeoutMs: 25,
      resolve: async () => [PUBLIC],
      connect: (_url, _address, signal) => new Promise((_resolve, reject) => {
        signal.addEventListener("abort", () => reject(new Error("aborted")), { once: true })
      }),
    })).rejects.toThrow("timed out")
  })

  test("HTTPS_PROXY и fake-IP DNS не открывают обход SSRF", async () => {
    const previous = process.env.HTTPS_PROXY
    process.env.HTTPS_PROXY = "http://127.0.0.1:8080"
    try {
      let connected = false
      await expect(fetchAgentWebPage("https://example.com/", {
        resolve: async () => ["198.18.0.7"],
        connect: async () => { connected = true; return page(200, { "content-type": "text/plain" }, "leak") },
      })).rejects.toThrow("not allowed")
      expect(connected).toBe(false)
    } finally {
      if (previous === undefined) delete process.env.HTTPS_PROXY
      else process.env.HTTPS_PROXY = previous
    }
  })

  test("запрещает IPv6 loopback и редирект на него без подключения", async () => {
    let connected = false
    await expect(fetchAgentWebPage("https://[::1]/", {
      resolve: async () => { throw new Error("must not resolve") },
      connect: async () => { connected = true; return page(200, { "content-type": "text/plain" }, "leak") },
    })).rejects.toThrow("not allowed")
    expect(connected).toBe(false)
    await expect(fetchAgentWebPage("https://example.com/", {
      resolve: async () => [PUBLIC],
      connect: async () => page(302, { location: "http://[::1]/admin" }, ""),
    })).rejects.toThrow("not allowed")
  })

  test("отклоняет редирект с учётными данными и нестандартным портом", async () => {
    for (const location of ["https://user:pass@example.com/", "https://example.com:8443/"]) {
      await expect(fetchAgentWebPage("https://example.com/", {
        resolve: async () => [PUBLIC],
        connect: async () => page(302, { location }, ""),
      }), location).rejects.toThrow()
    }
  })

  test("не следует по meta refresh и не переходит по найденным ссылкам", () => {
    const result = extractWebPage('<meta http-equiv="refresh" content="0;url=https://evil.example/"><p>Stay</p><a href="https://ok.example/">Next</a>', "https://example.com/")
    expect(result.links.map(link => link.url)).toEqual(["https://ok.example/"])
    expect(result.text).toContain("Stay")
    expect(result.text).toContain("Next")
    expect(result.text).not.toContain("evil.example")
  })
})

describe("web_search (AnySearch)", () => {
  const envelope = (results: unknown[], metadata?: Record<string, unknown>) => JSON.stringify({ code: 0, message: "success", data: { results, metadata } })

  test("работает анонимно без ключа: POST JSON без Authorization", async () => {
    const requests: Array<{ url: string; init: RequestInit }> = []
    const result = await searchAgentWeb("fabric api", 2, {
      apiKey: "",
      fetch: (async (url: string | URL | Request, init?: RequestInit) => {
        requests.push({ url: String(url), init: init ?? {} })
        return new Response(envelope([]), { status: 200 })
      }) as typeof fetch,
    })
    expect(requests).toHaveLength(1)
    expect(requests[0].url).toBe("https://api.anysearch.com/v1/search")
    expect(requests[0].init.method).toBe("POST")
    expect(requests[0].init.redirect).toBe("error")
    expect((requests[0].init.headers as Record<string, string>).Authorization).toBeUndefined()
    expect(JSON.parse(String(requests[0].init.body))).toEqual({ query: "fabric api", max_results: 2 })
    expect(result.provider).toBe("anysearch")
    expect(result.results).toEqual([])
  })

  test("передаёт ключ только в заголовке Authorization", async () => {
    let headers: Record<string, string> = {}
    await searchAgentWeb("q", 3, {
      apiKey: "as_sk_test",
      fetch: (async (_url, init) => {
        headers = init?.headers as Record<string, string>
        return new Response(envelope([]), { status: 200 })
      }) as typeof fetch,
    })
    expect(headers.Authorization).toBe("Bearer as_sk_test")
    expect(JSON.stringify(headers)).not.toContain("as_sk_test=")
  })

  test("возвращает заголовок, описание, URL и домен-источник", async () => {
    const result = await searchAgentWeb("fabric", 2, {
      fetch: (async () => new Response(envelope([
        { title: "Minecraft Wiki", url: "https://minecraft.wiki/w/Fabric", content: "Fabric loader guide", snippet: "ignored" },
        { title: "CurseForge", url: "https://www.curseforge.com/minecraft", snippet: "Mods" },
      ], { total_results: 2, search_time_ms: 12 }), { status: 200 })) as typeof fetch,
    })
    expect(result.provider).toBe("anysearch")
    expect(result.truncated).toBe(false)
    expect(result.results).toEqual([
      { title: "Minecraft Wiki", url: "https://minecraft.wiki/w/Fabric", description: "Fabric loader guide", source: "minecraft.wiki" },
      { title: "CurseForge", url: "https://www.curseforge.com/minecraft", description: "Mods", source: "www.curseforge.com" },
    ])
  })

  test("ограничивает выдачу и отбрасывает небезопасные ссылки", async () => {
    const result = await searchAgentWeb("fabric", 1, {
      fetch: (async () => new Response(envelope([
        { title: "Bad", url: "javascript:alert(1)" },
        { title: "Loopback", url: "http://127.0.0.1/" },
        { title: "Good", url: "https://example.com/page", content: "ok" },
      ], { total_results: 3 }), { status: 200 })) as typeof fetch,
    })
    expect(result.results).toHaveLength(1)
    expect(result.results[0].source).toBe("example.com")
    expect(result.truncated).toBe(true)
  })

  test("metadata.total_results включает флаг обрезки", async () => {
    const result = await searchAgentWeb("fabric", 1, {
      fetch: (async () => new Response(envelope([{ title: "One", url: "https://example.com/1" }], { total_results: 40 }), { status: 200 })) as typeof fetch,
    })
    expect(result.results).toHaveLength(1)
    expect(result.truncated).toBe(true)
  })

  test("объясняет отказ ключа, лимит и недоступность сервиса", async () => {
    const run = (status: number, body = "{}") => searchAgentWeb("q", 3, {
      apiKey: "k",
      fetch: (async () => new Response(body, { status })) as typeof fetch,
    })
    await expect(run(401)).rejects.toThrow("key was rejected")
    await expect(run(403)).rejects.toThrow("key was rejected")
    await expect(run(429)).rejects.toThrow("limit reached")
    await expect(run(503)).rejects.toThrow("unavailable")
    await expect(run(200, JSON.stringify({ code: -1, message: "Rate limited, retry after 300 seconds." }))).rejects.toThrow("limit reached")
    await expect(run(200, JSON.stringify({ code: -1, message: "Invalid query." }))).rejects.toThrow("Invalid query")
    await expect(searchAgentWeb("q", 3, { fetch: (async () => { throw new Error("offline") }) as typeof fetch })).rejects.toThrow("unreachable")
  })

  test("отклоняет некорректный ответ и пустой запрос", async () => {
    await expect(searchAgentWeb("q", 3, { fetch: (async () => new Response("not json", { status: 200 })) as typeof fetch })).rejects.toThrow("invalid response")
    await expect(searchAgentWeb("   ", 3, { apiKey: "" })).rejects.toThrow("non-empty query")
    await expect(searchAgentWeb("q".repeat(301), 3, { apiKey: "" })).rejects.toThrow("too long")
    await expect(searchAgentWeb("q", 3, { fetch: (async () => new Response("[]", { status: 200 })) as typeof fetch })).rejects.toThrow("invalid response")
  })

  test("пустая выдача не считается ошибкой", async () => {
    const result = await searchAgentWeb("nothing", 3, {
      fetch: (async () => new Response(JSON.stringify({ code: 0 }), { status: 200 })) as typeof fetch,
    })
    expect(result.results).toEqual([])
    expect(result.truncated).toBe(false)
  })
})