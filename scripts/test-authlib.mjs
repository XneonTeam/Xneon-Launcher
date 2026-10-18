/**
 * ============================================================
 * XNLC — Authlib-Injector / Yggdrasil Unit & Integration Tests
 * ============================================================
 *
 * Запуск: node scripts/test-authlib.mjs
 *
 * Содержит:
 *  1. Mock Yggdrasil HTTP Server на встроенном node:http
 *  2. Тесты нормализации URL (normalizeServerUrl)
 *  3. Тесты стабильного Server ID (makeServerId)
 *  4. Тесты парсинга метаданных сервера (parseMetadata, extractLinks)
 *  5. Тесты разрешения сервера через x-authlib-injector-api-location
 *  6. Тесты Yggdrasil authenticate (успех, неверные пароли, выбор профилей)
 *  7. Тесты Yggdrasil refresh
 *  8. Тесты Yggdrasil validate (204 -> true, 403 -> false)
 *  9. Тесты Yggdrasil invalidate
 * 10. Тесты декодирования текстур из Base64 свойств профиля
 * 11. Тесты формирования аргументов JVM для Java Agent и prefetched metadata
 * 12. Тесты изоляции множества серверов и привязки аккаунта к serverId
 */

import assert from "node:assert/strict"
import http from "node:http"
import path from "node:path"
import fs from "node:fs/promises"
import { pathToFileURL } from "node:url"
import { fileURLToPath } from "node:url"

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const rootDir = path.resolve(__dirname, "..")

// Импортируем скомпилированные модули из dist-electron/main/authlib
let serverModule, yggdrasilModule, managerModule, errorsModule
try {
  serverModule = await import("../dist-electron/main/authlib/server.js")
  yggdrasilModule = await import("../dist-electron/main/authlib/yggdrasil.js")
  managerModule = await import("../dist-electron/main/authlib/manager.js")
  errorsModule = await import("../dist-electron/main/authlib/errors.js")
} catch (error) {
  console.error("Не скомпилирован electron/main: выполните `node node_modules/typescript/bin/tsc -p tsconfig.node.json`")
  console.error(error)
  process.exit(1)
}

const {
  normalizeServerUrl,
  makeServerId,
  resolveAuthlibInjectorServer,
  resolveFavicon,
  parseMetadata,
  buildServer,
} = serverModule

const {
  AuthServerInvalidUrlError,
  AuthServerUnsupportedError,
  YggdrasilInvalidCredentialsError,
  YggdrasilInvalidTokenError,
  YggdrasilTwoFactorRequiredError,
} = errorsModule

const {
  YggdrasilClient,
  buildEndpoints,
  decodeTexturesProperty,
  authenticate,
  refresh,
  validate,
  invalidate,
  uploadSkin,
  deleteSkin,
  uploadCape,
  deleteCape,
} = yggdrasilModule

let passed = 0
let failed = 0

function test(name, fn) {
  return (async () => {
    try {
      await fn()
      console.log(`  ✓ ${name}`)
      passed++
    } catch (err) {
      console.error(`  ✗ ${name}`)
      console.error(err)
      failed++
    }
  })()
}

// ============================================================
// 1. Mock Yggdrasil Server
// ============================================================
class MockYggdrasilServer {
  constructor() {
    this.server = null
    this.port = 0
    this.url = ""
    this.invalidCredentialsAttempted = false
    this.receivedAuthenticatePayload = null
    this.receivedRefreshPayload = null
    this.receivedValidatePayload = null
    this.receivedInvalidatePayload = null
  }

  async start() {
    return new Promise((resolve) => {
      this.server = http.createServer((req, res) => {
        let body = ""
        req.on("data", (chunk) => {
          body += chunk
        })
        req.on("end", () => {
          this.handleRequest(req, res, body)
        })
      })

      this.server.listen(0, "127.0.0.1", () => {
        this.port = this.server.address().port
        this.url = `http://127.0.0.1:${this.port}/`
        resolve(this.url)
      })
    })
  }

  stop() {
    return new Promise((resolve) => {
      if (this.server) {
        this.server.close(() => resolve())
      } else {
        resolve()
      }
    })
  }

  handleRequest(req, res, rawBody) {
    const url = new URL(req.url, `http://127.0.0.1:${this.port}`)
    const pathname = url.pathname

    // 1) Роут с редиректом через header x-authlib-injector-api-location
    if (pathname === "/redirect-root" || pathname === "/redirect-root/") {
      res.writeHead(200, {
        "Content-Type": "text/html",
        "x-authlib-injector-api-location": "/api/yggdrasil/",
      })
      res.end('<html><head><link rel="icon" href="/custom-icon.png"></head><body>Redirecting...</body></html>')
      return
    }

    // Роут для иконки
    if (pathname === "/custom-icon.png" || pathname === "/favicon.ico") {
      const samplePng = Buffer.from(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
        "base64",
      )
      res.writeHead(200, { "Content-Type": "image/png" })
      res.end(samplePng)
      return
    }

    // 2) Root metadata (прямой вход или API root)
    if (pathname === "/" || pathname === "/api/yggdrasil/") {
      res.writeHead(200, { "Content-Type": "application/json" })
      res.end(
        JSON.stringify({
          meta: {
            serverName: "Test Yggdrasil Server",
            implementationName: "MockAuth",
            version: "1.0.0",
            "feature.non_email_login": true,
            links: {
              homepage: "https://example.com",
              register: "https://example.com/register",
              unsafeLink: "javascript:alert(1)",
            },
          },
          skinDomains: ["example.com"],
          signaturePublickey: "MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8A...",
        }),
      )
      return
    }

    let parsed = null
    if (rawBody) {
      try {
        parsed = JSON.parse(rawBody)
      } catch {}
    }

    // 3) POST /authserver/authenticate
    if (pathname.endsWith("/authserver/authenticate")) {
      this.receivedAuthenticatePayload = parsed
      if (parsed?.username === "baduser" || parsed?.password === "wrongpass") {
        res.writeHead(403, { "Content-Type": "application/json" })
        res.end(
          JSON.stringify({
            error: "ForbiddenOperationException",
            errorMessage: "Invalid credentials. Invalid username or password.",
          }),
        )
        return
      }

      // Ошибка двухфакторной аутентификации (Ely.by и др.)
      if (parsed?.username === "2fa-user") {
        res.writeHead(403, { "Content-Type": "application/json" })
        res.end(
          JSON.stringify({
            error: "ForbiddenOperationException",
            errorMessage: "Account protected with two factor auth.",
          }),
        )
        return
      }

      // Возврат 2 профилей для проверки profile selection
      if (parsed?.username === "multiuser") {
        res.writeHead(200, { "Content-Type": "application/json" })
        res.end(
          JSON.stringify({
            accessToken: "mock-access-token-multi",
            clientToken: parsed.clientToken,
            availableProfiles: [
              { id: "11111111111111111111111111111111", name: "SteveHero" },
              { id: "22222222222222222222222222222222", name: "AlexPro" },
            ],
            user: { id: "user-123" },
          }),
        )
        return
      }

      // Стандартный успешный ответ с selectedProfile
      res.writeHead(200, { "Content-Type": "application/json" })
      res.end(
        JSON.stringify({
          accessToken: "mock-access-token-123",
          clientToken: parsed?.clientToken || "client-token-default",
          selectedProfile: {
            id: "33333333333333333333333333333333",
            name: "MAINER4IK",
          },
          availableProfiles: [
            { id: "33333333333333333333333333333333", name: "MAINER4IK" },
          ],
          user: { id: "user-mainer" },
        }),
      )
      return
    }

    // 4) POST /authserver/refresh
    if (pathname.endsWith("/authserver/refresh")) {
      this.receivedRefreshPayload = parsed
      if (parsed?.accessToken === "expired-token") {
        res.writeHead(403, { "Content-Type": "application/json" })
        res.end(
          JSON.stringify({
            error: "ForbiddenOperationException",
            errorMessage: "Invalid token.",
          }),
        )
        return
      }

      res.writeHead(200, { "Content-Type": "application/json" })
      res.end(
        JSON.stringify({
          accessToken: "mock-refreshed-access-token",
          clientToken: parsed?.clientToken || "client-token",
          selectedProfile: parsed?.selectedProfile || {
            id: "33333333333333333333333333333333",
            name: "MAINER4IK",
          },
          availableProfiles: [
            { id: "33333333333333333333333333333333", name: "MAINER4IK" },
          ],
        }),
      )
      return
    }

    // 5) POST /authserver/validate
    if (pathname.endsWith("/authserver/validate")) {
      this.receivedValidatePayload = parsed
      if (parsed?.accessToken === "valid-token") {
        res.writeHead(204)
        res.end()
        return
      }
      res.writeHead(403, { "Content-Type": "application/json" })
      res.end(
        JSON.stringify({
          error: "ForbiddenOperationException",
          errorMessage: "Invalid token.",
        }),
      )
      return
    }

    // 6) POST /authserver/invalidate
    if (pathname.endsWith("/authserver/invalidate")) {
      this.receivedInvalidatePayload = parsed
      res.writeHead(204)
      res.end()
      return
    }

    // 7) GET /sessionserver/session/minecraft/profile/:uuid
    if (pathname.includes("/sessionserver/session/minecraft/profile/")) {
      const uuid = pathname.split("/").pop()
      const textureJson = JSON.stringify({
        timestamp: Date.now(),
        profileId: uuid,
        profileName: "MAINER4IK",
        textures: {
          SKIN: {
            url: "http://example.com/textures/skin-mainer.png",
            metadata: { model: "slim" },
          },
          CAPE: {
            url: "http://example.com/textures/cape-mainer.png",
          },
        },
      })
      const base64Textures = Buffer.from(textureJson, "utf8").toString("base64")

      res.writeHead(200, { "Content-Type": "application/json" })
      res.end(
        JSON.stringify({
          id: uuid,
          name: "MAINER4IK",
          properties: [
            {
              name: "textures",
              value: base64Textures,
            },
            {
              name: "uploadableTextures",
              value: "skin,cape",
            },
          ],
        }),
      )
      return
    }

    // 8) PUT /api/user/profile/:uuid/skin
    if (req.method === "PUT" && pathname.match(/\/api\/user\/profile\/[^/]+\/skin$/)) {
      this.receivedSkinUpload = {
        pathname,
        auth: req.headers.authorization,
        body: rawBody,
      }
      res.writeHead(204)
      res.end()
      return
    }

    // 9) DELETE /api/user/profile/:uuid/skin
    if (req.method === "DELETE" && pathname.match(/\/api\/user\/profile\/[^/]+\/skin$/)) {
      this.receivedSkinDelete = {
        pathname,
        auth: req.headers.authorization,
      }
      res.writeHead(204)
      res.end()
      return
    }

    // 10) PUT /api/user/profile/:uuid/cape
    if (req.method === "PUT" && pathname.match(/\/api\/user\/profile\/[^/]+\/cape$/)) {
      this.receivedCapeUpload = {
        pathname,
        auth: req.headers.authorization,
        body: rawBody,
      }
      res.writeHead(204)
      res.end()
      return
    }

    // 11) DELETE /api/user/profile/:uuid/cape
    if (req.method === "DELETE" && pathname.match(/\/api\/user\/profile\/[^/]+\/cape$/)) {
      this.receivedCapeDelete = {
        pathname,
        auth: req.headers.authorization,
      }
      res.writeHead(204)
      res.end()
      return
    }

    res.writeHead(404)
    res.end()
  }
}

// ============================================================
// MAIN TEST RUNNER
// ============================================================
console.log("\n--- Запуск тестов Authlib-Injector / Yggdrasil ---\n")

const mockServer = new MockYggdrasilServer()
await mockServer.start()

try {
  // ── 1. normalizeServerUrl ──
  await test("normalizeServerUrl: добавляет https:// при отсутствии протокола", () => {
    const res = normalizeServerUrl("ely.by")
    assert.equal(res, "https://ely.by/")
  })

  await test("normalizeServerUrl: сохраняет http:// для локальных/тестовых серверов", () => {
    const res = normalizeServerUrl("http://localhost:8080/api")
    assert.equal(res, "http://localhost:8080/api/")
  })

  await test("normalizeServerUrl: добавляет завершающий слэш", () => {
    const res = normalizeServerUrl("https://example.com/yggdrasil")
    assert.equal(res, "https://example.com/yggdrasil/")
  })

  await test("normalizeServerUrl: удаляет query и hash", () => {
    const res = normalizeServerUrl("https://example.com/api?foo=bar#section")
    assert.equal(res, "https://example.com/api/")
  })

  await test("normalizeServerUrl: выбрасывает AuthServerInvalidUrlError при пустом URL", () => {
    assert.throws(() => normalizeServerUrl("   "), (err) => err instanceof AuthServerInvalidUrlError)
  })

  await test("normalizeServerUrl: выбрасывает AuthServerUnsupportedError при некорректном протоколе", () => {
    assert.throws(() => normalizeServerUrl("ftp://example.com"), (err) => err instanceof AuthServerUnsupportedError)
  })

  // ── 2. makeServerId ──
  await test("makeServerId: детерминирован и одинаков для эквивалентных нормализованных URL", () => {
    const id1 = makeServerId("https://ely.by/")
    const id2 = makeServerId("https://ely.by/")
    assert.equal(id1, id2)
    assert.equal(typeof id1, "string")
    assert.equal(id1.length, 16)
  })

  await test("makeServerId: различает разные серверы", () => {
    const idA = makeServerId("https://server-a.com/api/")
    const idB = makeServerId("https://server-b.com/api/")
    assert.notEqual(idA, idB)
  })

  // ── 3. parseMetadata & buildServer ──
  await test("parseMetadata: корректно извлекает поля метаданных", () => {
    const raw = JSON.stringify({
      meta: {
        serverName: "SuperCraft Auth",
        "feature.non_email_login": true,
        links: {
          homepage: "https://supercraft.net",
          register: "https://supercraft.net/reg",
        },
      },
    })
    const meta = parseMetadata(raw)
    const server = buildServer("https://supercraft.net/api/", meta)

    assert.equal(server.name, "SuperCraft Auth")
    assert.equal(server.nonEmailLogin, true)
    assert.equal(server.links.homepage, "https://supercraft.net")
    assert.equal(server.links.register, "https://supercraft.net/reg")
    assert.equal(server.url, "https://supercraft.net/api/")
  })

  await test("parseMetadata: отклоняет невалидный JSON", () => {
    assert.throws(() => parseMetadata("<html>Error</html>"))
  })

  // ── 4. resolveAuthlibInjectorServer (header redirect) ──
  await test("resolveAuthlibInjectorServer: прямой root", async () => {
    const server = await resolveAuthlibInjectorServer(mockServer.url)
    assert.equal(server.name, "Test Yggdrasil Server")
    assert.equal(server.nonEmailLogin, true)
    assert.equal(server.links.homepage, "https://example.com")
    assert.equal(server.links.register, "https://example.com/register")
    assert.equal(server.links.unsafeLink, undefined) // опасные ссылки отсеяны
  })

  await test("resolveAuthlibInjectorServer: переход по x-authlib-injector-api-location и парсинг фавикона", async () => {
    const redirectUrl = `${mockServer.url}redirect-root`
    const server = await resolveAuthlibInjectorServer(redirectUrl)
    assert.equal(server.url, `${mockServer.url}api/yggdrasil/`)
    assert.equal(server.name, "Test Yggdrasil Server")
    assert.ok(server.favicon, "Фавикон должен быть загружен")
    assert.ok(server.favicon.startsWith("data:image/"), "Фавикон должен быть в формате data URL")
  })

  await test("resolveFavicon: находит фавикон по /favicon.ico", async () => {
    const favicon = await resolveFavicon(mockServer.url)
    assert.ok(favicon)
    assert.ok(favicon.startsWith("data:image/"))
  })

  // ── 5. buildEndpoints ──
  await test("buildEndpoints: формирует корректные URL для всех операций", () => {
    const endpoints = buildEndpoints("https://auth.xneon.org/api/")
    assert.equal(endpoints.authenticate, "https://auth.xneon.org/api/authserver/authenticate")
    assert.equal(endpoints.refresh, "https://auth.xneon.org/api/authserver/refresh")
    assert.equal(endpoints.validate, "https://auth.xneon.org/api/authserver/validate")
    assert.equal(endpoints.invalidate, "https://auth.xneon.org/api/authserver/invalidate")
    assert.equal(
      endpoints.profile("33333333333333333333333333333333"),
      "https://auth.xneon.org/api/sessionserver/session/minecraft/profile/33333333333333333333333333333333",
    )
    assert.equal(
      endpoints.skin("33333333333333333333333333333333"),
      "https://auth.xneon.org/api/api/user/profile/33333333333333333333333333333333/skin",
    )
  })

  // ── 6. authenticate ──
  await test("authenticate: успешный вход передаёт агент Minecraft/1 и возвращает токены", async () => {
    const session = await authenticate(mockServer.url, {
      username: "user@example.com",
      password: "secretpassword",
      clientToken: "test-client-token-999",
    })

    assert.equal(mockServer.receivedAuthenticatePayload.agent.name, "Minecraft")
    assert.equal(mockServer.receivedAuthenticatePayload.agent.version, 1)
    assert.equal(mockServer.receivedAuthenticatePayload.username, "user@example.com")
    assert.equal(mockServer.receivedAuthenticatePayload.clientToken, "test-client-token-999")
    assert.equal(session.accessToken, "mock-access-token-123")
    assert.equal(session.selectedProfile.name, "MAINER4IK")
    assert.equal(session.selectedProfile.id, "33333333333333333333333333333333")
  })

  await test("authenticate: неверные учетные данные превращаются в YggdrasilInvalidCredentialsError", async () => {
    await assert.rejects(
      async () => {
        await authenticate(mockServer.url, {
          username: "baduser",
          password: "wrongpass",
          clientToken: "token-1",
        })
      },
      (err) => err instanceof YggdrasilInvalidCredentialsError && err.code === "invalid_credentials",
    )
  })

  await test("authenticate: ошибка 2FA ('Account protected with two factor auth.') маппится в two_factor_required", async () => {
    await assert.rejects(
      async () => {
        await authenticate(mockServer.url, {
          username: "2fa-user",
          password: "mypassword",
          clientToken: "token-2fa",
        })
      },
      (err) => err instanceof YggdrasilTwoFactorRequiredError && err.code === "two_factor_required" && err.message.includes("two factor"),
    )
  })

  // ── 7. refresh ──
  await test("refresh: успешное обновление токена", async () => {
    const session = await refresh(mockServer.url, {
      accessToken: "old-token",
      clientToken: "test-client-token-999",
      selectedProfile: { id: "33333333333333333333333333333333", name: "MAINER4IK" },
    })

    assert.equal(session.accessToken, "mock-refreshed-access-token")
    assert.equal(session.selectedProfile.name, "MAINER4IK")
  })

  await test("refresh: просроченный токен выбрасывает YggdrasilInvalidTokenError", async () => {
    await assert.rejects(
      async () => {
        await refresh(mockServer.url, {
          accessToken: "expired-token",
          clientToken: "test-client-token-999",
        })
      },
      (err) => err instanceof YggdrasilInvalidTokenError && err.code === "invalid_token",
    )
  })

  // ── 8. validate ──
  await test("validate: возвращает true при 204 и false при 403", async () => {
    const valid = await validate(mockServer.url, {
      accessToken: "valid-token",
      clientToken: "client",
    })
    assert.equal(valid, true)

    const invalid = await validate(mockServer.url, {
      accessToken: "expired-token",
      clientToken: "client",
    })
    assert.equal(invalid, false)
  })

  // ── 9. invalidate ──
  await test("invalidate: отправляет запрос на authserver/invalidate", async () => {
    await invalidate(mockServer.url, {
      accessToken: "any-token",
      clientToken: "any-client",
    })
    assert.equal(mockServer.receivedInvalidatePayload.accessToken, "any-token")
  })

  // ── 10. decodeTexturesProperty ──
  await test("decodeTexturesProperty: корректно декодирует скин и плащ из Base64", () => {
    const payload = {
      textures: {
        SKIN: {
          url: "https://textures.example.com/skin.png",
          metadata: { model: "slim" },
        },
        CAPE: {
          url: "https://textures.example.com/cape.png",
        },
      },
    }
    const b64 = Buffer.from(JSON.stringify(payload)).toString("base64")
    const textures = decodeTexturesProperty(b64)

    assert.equal(textures.skin.url, "https://textures.example.com/skin.png")
    assert.equal(textures.skin.model, "slim")
    assert.equal(textures.cape.url, "https://textures.example.com/cape.png")
  })

  // ── 11. fetchProfile через YggdrasilClient ──
  await test("YggdrasilClient.fetchProfile: получает профиль и декодирует текстуры", async () => {
    const client = new YggdrasilClient(mockServer.url)
    const profile = await client.fetchProfile("33333333333333333333333333333333")

    assert.equal(profile.id, "33333333333333333333333333333333")
    assert.equal(profile.name, "MAINER4IK")
    assert.equal(profile.textures.skin.url, "http://example.com/textures/skin-mainer.png")
    assert.equal(profile.textures.skin.model, "slim")
    assert.equal(profile.textures.cape.url, "http://example.com/textures/cape-mainer.png")
  })

  // ── 12. buildWorkerAuthlibPayload & Launch Args ──
  await test("buildWorkerAuthlibPayload: формирует параметры запуска с Base64 metadata", async () => {
    const serverObj = {
      id: "test-server-id",
      url: mockServer.url,
      name: "Test Server",
      nonEmailLogin: true,
      links: {},
    }

    const payload = await managerModule.buildWorkerAuthlibPayload(rootDir, serverObj)
    assert.ok(payload.injectorPath.endsWith("authlib-injector.jar"))
    assert.equal(payload.serverUrl, mockServer.url)
    assert.ok(payload.prefetchedMetadata)

    // Проверяем, что Base64 декодируется обратно в валидный JSON метаданных
    const decodedJson = JSON.parse(Buffer.from(payload.prefetchedMetadata, "base64").toString("utf8"))
    assert.equal(decodedJson.meta.serverName, "Test Yggdrasil Server")
  })

  // ── 13. Multiple servers isolation ──
  await test("Multiple servers: клиенты разных серверов изолированы по server URL", () => {
    const clientA = new YggdrasilClient("https://server-a.com/api/")
    const clientB = new YggdrasilClient("https://server-b.com/api/")

    assert.equal(clientA.endpoints.authenticate, "https://server-a.com/api/authserver/authenticate")
    assert.equal(clientB.endpoints.authenticate, "https://server-b.com/api/authserver/authenticate")
    assert.notEqual(clientA.endpoints.authenticate, clientB.endpoints.authenticate)
  })
  // ── 14. uploadSkin & deleteSkin ──
  await test("uploadSkin & deleteSkin: загрузка и сброс скина по Authlib-Injector API", async () => {
    // Временный тестовый PNG
    const tempSkinPath = path.join(rootDir, "temp-test-skin.png")
    const samplePng = Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
      "base64",
    )
    await fs.writeFile(tempSkinPath, samplePng)

    try {
      const client = new YggdrasilClient(mockServer.url)

      // Загрузка
      await client.uploadSkin({
        uuid: "33333333333333333333333333333333",
        accessToken: "test-skin-token",
        filePath: tempSkinPath,
        model: "slim",
      })

      assert.ok(mockServer.receivedSkinUpload)
      assert.equal(mockServer.receivedSkinUpload.auth, "Bearer test-skin-token")
      assert.ok(mockServer.receivedSkinUpload.body.includes('name="model"\r\n\r\nslim'))
      assert.ok(mockServer.receivedSkinUpload.body.includes('filename="skin.png"'))

      // Сброс
      await client.deleteSkin({
        uuid: "33333333333333333333333333333333",
        accessToken: "test-skin-token",
      })

      assert.ok(mockServer.receivedSkinDelete)
      assert.equal(mockServer.receivedSkinDelete.auth, "Bearer test-skin-token")
    } finally {
      await fs.unlink(tempSkinPath).catch(() => {})
    }
  })

  // ── 15. uploadCape & deleteCape ──
  await test("uploadCape & deleteCape: загрузка и сброс плаща по Authlib-Injector API", async () => {
    const tempCapePath = path.join(rootDir, "temp-test-cape.png")
    const samplePng = Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
      "base64",
    )
    await fs.writeFile(tempCapePath, samplePng)

    try {
      const client = new YggdrasilClient(mockServer.url)

      // Загрузка плаща
      await client.uploadCape({
        uuid: "33333333333333333333333333333333",
        accessToken: "test-cape-token",
        filePath: tempCapePath,
      })

      assert.ok(mockServer.receivedCapeUpload)
      assert.equal(mockServer.receivedCapeUpload.auth, "Bearer test-cape-token")
      assert.ok(mockServer.receivedCapeUpload.body.includes('filename="cape.png"'))

      // Сброс плаща
      await client.deleteCape({
        uuid: "33333333333333333333333333333333",
        accessToken: "test-cape-token",
      })

      assert.ok(mockServer.receivedCapeDelete)
      assert.equal(mockServer.receivedCapeDelete.auth, "Bearer test-cape-token")
    } finally {
      await fs.unlink(tempCapePath).catch(() => {})
    }
  })

  // ── 16. MinecraftSkins integration ──
  await test("MinecraftSkins: интеграция надевания, сброса и профиля для authlib-injector", async () => {
    const { MinecraftSkins } = await import(
      pathToFileURL(path.join(rootDir, "packages/xnlc-skins/lib/minecraft.js")).href
    )

    const mockAccountPort = {
      resolve: async () => ({
        id: "acc-1",
        type: "authlib-injector",
        username: "MAINER4IK",
        uuid: "33333333333333333333333333333333",
        accessToken: "authlib-mc-token",
        serverUrl: mockServer.url,
      }),
      refresh: async () => null,
    }

    const skins = new MinecraftSkins(mockAccountPort)

    // Профиль
    const profile = await skins.profile("acc-1")
    assert.equal(profile.name, "MAINER4IK")
    assert.equal(profile.skins[0].url, "http://example.com/textures/skin-mainer.png")
    assert.equal(profile.skins[0].variant, "SLIM")
    assert.equal(profile.uploadableTextures, "skin,cape")

    // Надевание
    const fakeData = new Uint8Array([1, 2, 3, 4])
    const applyOk = await skins.apply({
      accountId: "acc-1",
      data: fakeData,
      variant: "slim",
    })
    assert.equal(applyOk, true)

    // Сброс
    const resetOk = await skins.reset("acc-1")
    assert.equal(resetOk, true)
  })
} finally {
  await mockServer.stop()
}

console.log(`\nРезультаты: ${passed} успешно, ${failed} провалено.\n`)
if (failed > 0) {
  process.exit(1)
}
