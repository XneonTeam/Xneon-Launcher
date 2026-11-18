const environment = (): Record<string, string | undefined> => typeof process === "undefined" ? {} : process.env
const envUrl = (key: string, fallback: string): string => (environment()[key]?.trim() || fallback).replace(/\/+$/, "")
export const joinUrl = (base: string, suffix: string): string => `${base.replace(/\/+$/, "")}/${suffix.replace(/^\/+/, "")}`
const javaRuntimePath = "/v1/products/java-runtime/2ec0cc96c44e5a76b9c8b7c39df7210883d12871/all.json"
const BMCLAPI_BASE = "https://bmclapi2.bangbang93.com"

/** Читаем окружение при обращении: включённое после импорта зеркало не остаётся старым снимком. */
export const URLS = {
  official: {
    mojang: {
      get meta() { return envUrl("XNLC_URL_MOJANG_META", "https://launchermeta.mojang.com") },
      get versionManifestV2() { return joinUrl(this.meta, "/mc/game/version_manifest_v2.json") },
      get libraries() { return envUrl("XNLC_URL_MOJANG_LIBRARIES", "https://libraries.minecraft.net") },
      get assets() { return envUrl("XNLC_URL_MOJANG_ASSETS", "https://resources.download.minecraft.net") },
      get javaRuntime() { return envUrl("XNLC_URL_MOJANG_JAVA_RUNTIME", joinUrl(this.meta, javaRuntimePath)) },
    },
    fabric: {
      get meta() { return envUrl("XNLC_URL_FABRIC_META", "https://meta.fabricmc.net") },
      get metaV2() { return joinUrl(this.meta, "/v2") },
      get maven() { return envUrl("XNLC_URL_FABRIC_MAVEN", "https://maven.fabricmc.net") },
    },
    neoforge: { get maven() { return envUrl("XNLC_URL_NEOFORGE_MAVEN", "https://maven.neoforged.net/releases") } },
    forge: { get maven() { return envUrl("XNLC_URL_FORGE_MAVEN", "https://maven.minecraftforge.net") } },
    loader: {
      get meta() { return envUrl("XNLC_URL_PRISM_META", "https://meta.prismlauncher.org/v1") },
      get files() { return envUrl("XNLC_URL_PRISM_FILES", "https://files.prismlauncher.org") },
      get fmlLibraries() { return envUrl("XNLC_URL_FML_LIBRARIES", joinUrl(this.files, "/fmllibs")) },
    },
    quilt: {
      get meta() { return envUrl("XNLC_URL_QUILT_META", "https://meta.quiltmc.org") },
      get metaV3() { return joinUrl(this.meta, "/v3") },
      get mavenRelease() { return envUrl("XNLC_URL_QUILT_MAVEN_RELEASE", "https://maven.quiltmc.org/repository/release") },
    },
    optifine: {
      get root() { return envUrl("XNLC_URL_OPTIFINE_ROOT", "https://optifine.net") },
      get downloads() { return joinUrl(this.root, "/downloads") },
    },
    authlibInjector: { get root() { return envUrl("XNLC_URL_AUTHLIB_INJECTOR_ROOT", "https://authlib-injector.yushi.moe") } },
    azul: { get metadataApi() { return envUrl("XNLC_URL_AZUL_METADATA_API", "https://api.azul.com/metadata/v1/zulu/packages") } },
  },
} as const

export function applyBmclapiEnv(): void {
  process.env.XNLC_URL_MOJANG_META = BMCLAPI_BASE
  process.env.XNLC_URL_MOJANG_LIBRARIES = `${BMCLAPI_BASE}/maven`
  process.env.XNLC_URL_MOJANG_ASSETS = `${BMCLAPI_BASE}/assets`
  process.env.XNLC_URL_FABRIC_MAVEN = `${BMCLAPI_BASE}/maven`
  process.env.XNLC_URL_FORGE_MAVEN = `${BMCLAPI_BASE}/maven`
  process.env.XNLC_URL_QUILT_MAVEN_RELEASE = `${BMCLAPI_BASE}/maven`
  process.env.XNLC_URL_AUTHLIB_INJECTOR_ROOT = `${BMCLAPI_BASE}/mirrors/authlib-injector`
  process.env.XNLC_URL_MOJANG_JAVA_RUNTIME = joinUrl(BMCLAPI_BASE, javaRuntimePath)
}

/** Меняем только известные источники, сохраняя путь и query; CDN стороннего контента не затрагиваем. */
export function rewriteMinecraftUrl(value: string): string {
  try {
    const url = new URL(value)
    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || url.port) return value
    const { pathname, search, hostname } = url
    const sources = URLS.official
    const append = (base: string, suffix = pathname) => {
      if ((url.origin + pathname).startsWith(base + "/")) return value
      return joinUrl(base, suffix) + search
    }
    switch (hostname) {
      case "launchermeta.mojang.com":
      case "launcher.mojang.com": return append(sources.mojang.meta)
      case "piston-meta.mojang.com":
      case "piston-data.mojang.com": return environment().XNLC_URL_MOJANG_META?.trim() ? append(sources.mojang.meta) : value
      case "resources.download.minecraft.net": return append(sources.mojang.assets)
      case "libraries.minecraft.net": return append(sources.mojang.libraries)
      case "authlib-injector.yushi.moe": return append(sources.authlibInjector.root)
      case "meta.fabricmc.net": return append(sources.fabric.meta)
      case "maven.fabricmc.net": return append(sources.fabric.maven)
      case "maven.minecraftforge.net": return append(sources.forge.maven)
      case "maven.neoforged.net": return pathname.startsWith("/releases/") ? append(sources.neoforge.maven, pathname.slice("/releases/".length)) : value
      case "meta.quiltmc.org": return append(sources.quilt.meta)
      case "maven.quiltmc.org": return pathname.startsWith("/repository/release/") ? append(sources.quilt.mavenRelease, pathname.slice("/repository/release/".length)) : value
      default: return value
    }
  } catch { return value }
}
