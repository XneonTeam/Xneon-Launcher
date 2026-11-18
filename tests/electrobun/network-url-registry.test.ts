import { afterEach, describe, expect, test } from "bun:test"
import { URLS, applyBmclapiEnv, rewriteMinecraftUrl } from "../../packages/xnlc-urls/src/minecraft.ts"
import { AUTH_URLS, CONTENT_URLS, SERVICE_URLS, curseforgeDownloadUrl } from "../../packages/xnlc-urls/src/index.ts"

const original = { ...process.env }
afterEach(() => {
  for (const key of Object.keys(process.env)) if (key.startsWith("XNLC_URL_") && !(key in original)) delete process.env[key]
  for (const [key, value] of Object.entries(original)) if (key.startsWith("XNLC_URL_")) process.env[key] = value
})

describe("реестр адресов без адаптеров", () => {
  test("каждое поддерживаемое переопределение читается лениво и убирает завершающий слэш", () => {
    const sources = URLS.official
    const cases: Array<[string, () => string]> = [
      ["MOJANG_META", () => sources.mojang.meta], ["MOJANG_LIBRARIES", () => sources.mojang.libraries],
      ["MOJANG_ASSETS", () => sources.mojang.assets], ["MOJANG_JAVA_RUNTIME", () => sources.mojang.javaRuntime],
      ["FABRIC_META", () => sources.fabric.meta], ["FABRIC_MAVEN", () => sources.fabric.maven],
      ["NEOFORGE_MAVEN", () => sources.neoforge.maven], ["FORGE_MAVEN", () => sources.forge.maven],
      ["PRISM_META", () => sources.loader.meta], ["PRISM_FILES", () => sources.loader.files],
      ["FML_LIBRARIES", () => sources.loader.fmlLibraries], ["QUILT_META", () => sources.quilt.meta],
      ["QUILT_MAVEN_RELEASE", () => sources.quilt.mavenRelease], ["OPTIFINE_ROOT", () => sources.optifine.root],
      ["AUTHLIB_INJECTOR_ROOT", () => sources.authlibInjector.root], ["AZUL_METADATA_API", () => sources.azul.metadataApi],
    ]
    for (const [name, read] of cases) {
      const key = `XNLC_URL_${name}`
      delete process.env[key]
      expect(read()).toStartWith("https://")
      process.env[key] = " https://mirror.example/base/// "
      expect(read()).toBe("https://mirror.example/base")
    }
    expect(sources.fabric.metaV2).toBe("https://mirror.example/base/v2")
    expect(sources.quilt.metaV3).toBe("https://mirror.example/base/v3")
    expect(sources.optifine.downloads).toBe("https://mirror.example/base/downloads")
    delete process.env.XNLC_URL_FML_LIBRARIES
    expect(sources.loader.fmlLibraries).toBe("https://mirror.example/base/fmllibs")
    delete process.env.XNLC_URL_MOJANG_JAVA_RUNTIME
    expect(sources.mojang.javaRuntime).toStartWith("https://mirror.example/base/v1/products/java-runtime/")
  })

  test("BMCLAPI применяется ко всем известным источникам, остальные URL не меняются", () => {
    applyBmclapiEnv()
    for (const url of [
      "https://launchermeta.mojang.com/a.json", "https://launcher.mojang.com/a.json",
      "https://piston-meta.mojang.com/a.json", "https://piston-data.mojang.com/a.jar",
      "https://resources.download.minecraft.net/a/hash", "https://libraries.minecraft.net/a.jar",
      "https://maven.fabricmc.net/a.jar", "https://maven.minecraftforge.net/a.jar",
      "https://maven.quiltmc.org/repository/release/a.jar", "https://authlib-injector.yushi.moe/artifact/latest.json",
    ]) expect(rewriteMinecraftUrl(url)).toStartWith("https://bmclapi2.bangbang93.com/")
    expect(rewriteMinecraftUrl("https://meta.fabricmc.net/v2/a")).toBe(URLS.official.fabric.metaV2 + "/a")
    expect(rewriteMinecraftUrl("https://meta.quiltmc.org/v3/a")).toBe(URLS.official.quilt.metaV3 + "/a")
    expect(rewriteMinecraftUrl("https://maven.neoforged.net/releases/net/neoforged/a.jar")).toBe(URLS.official.neoforge.maven + "/net/neoforged/a.jar")
    for (const url of ["https://maven.neoforged.net/other/a.jar", "https://maven.quiltmc.org/other/a.jar", "https://user:pass@libraries.minecraft.net/a.jar", "https://libraries.minecraft.net:8443/a.jar", "file:///a.jar", "not-url", "https://cdn.modrinth.com/a.jar"]) {
      expect(rewriteMinecraftUrl(url)).toBe(url)
    }
  })

  test("общие API сохраняют адреса и экранирование имён файлов", () => {
    expect(AUTH_URLS.minecraftProfile).toBe("https://api.minecraftservices.com/minecraft/profile")
    expect(CONTENT_URLS.modrinthApi).toBe("https://api.modrinth.com/v2")
    expect(SERVICE_URLS.share).toBe("https://share.xneon.org")
    expect(curseforgeDownloadUrl(1234567, "мод #1.jar")).toBe("https://edge.forgecdn.net/files/1234/567/%D0%BC%D0%BE%D0%B4%20%231.jar")
  })
})
