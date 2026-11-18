import { describe, expect, test } from "bun:test"
import fs from "node:fs"
import path from "node:path"
import vm from "node:vm"
import { createRequire } from "node:module"
import { EventEmitter } from "node:events"
import { transformSync } from "esbuild"

const require = createRequire(import.meta.url)

function fixture(env: Record<string, string> = {}, overrides: Record<string, unknown> = {}) {
  const modules = new Map<string, { exports: any }>()
  function load(relative: string, extra = ""): any {
    const filename = path.resolve(relative)
    if (modules.has(filename)) return modules.get(filename)!.exports
    const module = { exports: {} }
    modules.set(filename, module)
    const code = transformSync(fs.readFileSync(filename, "utf8") + extra, { loader: "ts", format: "cjs" }).code
    vm.runInNewContext(code, {
      module, exports: module.exports, URL, Buffer, console, process: { env }, setTimeout, clearTimeout,
      require(name: string) {
        if (Object.hasOwn(overrides, name)) return overrides[name]
        if (name === "@xnlc/urls") return load("packages/xnlc-urls/src/index.ts")
        if (name === "@xnlc/urls/minecraft") return load("packages/xnlc-urls/src/minecraft.ts")
        if (name.startsWith(".")) return load(path.resolve(path.dirname(filename), name.replace(/\.js$/, ".ts")))
        return require(name)
      },
    })
    return module.exports
  }
  return { env, load }
}

describe("единые адреса XNLC", () => {
  test("BMCLAPI меняет уже импортированные адреса, включая Maven и Java", () => {
    const f = fixture()
    const { URLS } = f.load("packages/xnlc-core/src/constants/urls.ts")
    expect(URLS.official.mojang.meta).toBe("https://launchermeta.mojang.com")
    f.load("packages/xnlc-core/src/config.ts").applyBmclapiEnv()
    expect(URLS.official.mojang.meta).toBe("https://bmclapi2.bangbang93.com")
    expect(URLS.official.mojang.versionManifestV2).toBe("https://bmclapi2.bangbang93.com/mc/game/version_manifest_v2.json")
    expect(URLS.official.forge.maven).toBe("https://bmclapi2.bangbang93.com/maven")
    expect(URLS.official.fabric.maven).toBe("https://bmclapi2.bangbang93.com/maven")
    expect(URLS.official.mojang.javaRuntime).toStartWith("https://bmclapi2.bangbang93.com/")
  })

  test("Maven-переопределения Fabric, Forge и Quilt не подменяются Mojang Libraries", () => {
    const f = fixture({
      XNLC_URL_MOJANG_LIBRARIES: "https://libraries.example/maven/",
      XNLC_URL_FABRIC_MAVEN: "https://fabric.example/maven/",
      XNLC_URL_FORGE_MAVEN: "https://forge.example/maven/",
      XNLC_URL_QUILT_MAVEN_RELEASE: "https://quilt.example/release/",
    })
    const { rewriteUrl } = f.load("packages/xnlc-core/src/utils/urls.ts")
    expect(rewriteUrl("https://maven.fabricmc.net/net/fabricmc/a.jar?q=1")).toBe("https://fabric.example/maven/net/fabricmc/a.jar?q=1")
    expect(rewriteUrl("https://maven.minecraftforge.net/net/minecraftforge/a.jar")).toBe("https://forge.example/maven/net/minecraftforge/a.jar")
    expect(rewriteUrl("https://maven.quiltmc.org/repository/release/org/quiltmc/a.jar")).toBe("https://quilt.example/release/org/quiltmc/a.jar")
  })

  test("default не меняет официальные Maven-адреса и посторонние URL", () => {
    const { rewriteUrl } = fixture().load("packages/xnlc-core/src/utils/urls.ts")
    for (const url of ["https://maven.fabricmc.net/a.jar", "https://maven.minecraftforge.net/a.jar", "https://maven.quiltmc.org/repository/release/a.jar", "https://cdn.example/a.jar?x=1", "file:///C:/game/a.jar", "not a URL"]) {
      expect(rewriteUrl(url)).toBe(url)
    }
  })

  test("переопределение читается после первого обращения, повторная подмена не удваивает путь", () => {
    const f = fixture()
    const { URLS } = f.load("packages/xnlc-core/src/constants/urls.ts")
    const { rewriteUrl } = f.load("packages/xnlc-core/src/utils/urls.ts")
    expect(URLS.official.fabric.meta).toBe("https://meta.fabricmc.net")
    f.env.XNLC_URL_FABRIC_META = " https://meta.fabricmc.net/mirror/ "
    const rewritten = rewriteUrl("https://meta.fabricmc.net/v2/versions/installer?x=1")
    expect(rewritten).toBe("https://meta.fabricmc.net/mirror/v2/versions/installer?x=1")
    expect(rewriteUrl(rewritten)).toBe(rewritten)
  })

  test("пустое окружение использует defaults, устаревшие параметры больше не объявлены", () => {
    const { URLS } = fixture({ XNLC_URL_MOJANG_META: "   " }).load("packages/xnlc-core/src/constants/urls.ts")
    expect(URLS.official.mojang.meta).toBe("https://launchermeta.mojang.com")
    expect(URLS.official.mojang).not.toHaveProperty("launcher")
    expect(URLS.official.neoforge).not.toHaveProperty("host")
    expect(URLS.official.neoforge).not.toHaveProperty("mirror")
    expect(URLS.official).not.toHaveProperty("liteloader")
    expect(URLS.official).not.toHaveProperty("launcherMeta")
    expect(URLS.official).not.toHaveProperty("mavenCentral")
  })

  test("BMCLAPI переписывает ссылки Piston из манифестов, без настройки они сохраняются", () => {
    const f = fixture()
    const { rewriteUrl } = f.load("packages/xnlc-core/src/utils/urls.ts")
    const input = "https://piston-data.mojang.com/v1/objects/hash/server.jar"
    expect(rewriteUrl(input)).toBe(input)
    f.load("packages/xnlc-core/src/config.ts").applyBmclapiEnv()
    expect(rewriteUrl(input)).toBe("https://bmclapi2.bangbang93.com/v1/objects/hash/server.jar")
  })

  test("адреса доступны renderer без глобального process", () => {
    const exports = loadBrowser("packages/xnlc-urls/src/minecraft.ts")
    expect(exports.URLS.official.mojang.versionManifestV2).toBe("https://launchermeta.mojang.com/mc/game/version_manifest_v2.json")
    expect(exports.rewriteMinecraftUrl("https://piston-meta.mojang.com/a.json")).toBe("https://piston-meta.mojang.com/a.json")
  })

  test("серверный HTTP-загрузчик применяет те же переопределения метаданных", async () => {
    const calls: string[] = []
    const http = { get(url: string, _options: unknown, callback: (response: any) => void) {
      calls.push(url)
      const request = new EventEmitter()
      queueMicrotask(() => {
        const response = Object.assign(new EventEmitter(), { statusCode: 200, headers: {} })
        callback(response)
        response.emit("data", Buffer.from("{}"))
        response.emit("end")
      })
      return request
    } }
    const f = fixture({ XNLC_URL_FABRIC_META: "https://meta.example/fabric/" }, { http, https: http })
    const server = f.load("packages/xnlc-servers/src/jar-downloader.ts", "\nexport { fetchJsonOnce };")
    await server.fetchJsonOnce("https://meta.fabricmc.net/v2/versions/installer")
    expect(calls).toEqual(["https://meta.example/fabric/v2/versions/installer"])
  })
})

function loadBrowser(filename: string): any {
  const module = { exports: {} }
  const code = transformSync(fs.readFileSync(filename, "utf8"), { loader: "ts", format: "cjs" }).code
  vm.runInNewContext(code, { module, exports: module.exports, URL })
  return module.exports
}
