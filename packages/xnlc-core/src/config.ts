// ============================================================
// XNLC — BMCLAPI Configuration
// Bangbang93's Minecraft API mirror for Chinese users
// Extracted from minecraft-launch-worker.ts
// ============================================================

const BMCLAPI_BASE = "https://bmclapi2.bangbang93.com"

/** Хосты, с которых разрешено скачивать authlib-injector.jar. */
const AUTHLIB_INJECTOR_DEFAULT_HOSTS = [
  "authlib-injector.yushi.moe",
  "github.com",
  "objects.githubusercontent.com",
  "bmclapi2.bangbang93.com",
]

/**
 * Allowlist хостов для загрузки authlib-injector.
 *
 * URL загрузки приходит из ответа удалённого сервера (artifact/latest.json
 * или GitHub API), а сам JAR затем исполняется как -javaagent. Без проверки
 * хоста подменённый ответ увёл бы загрузку исполняемого файла на чужой
 * ресурс, поэтому сверяем хост перед скачиванием.
 *
 * Хост BMCLAPI-зеркала берётся из XNLC_URL_AUTHLIB_INJECTOR_ROOT, который
 * выставляет applyBmclapiEnv(): включённое зеркало не должно ломать загрузку.
 */
export function getAuthlibInjectorAllowedHosts(): string[] {
  const hosts = new Set(AUTHLIB_INJECTOR_DEFAULT_HOSTS)
  const root = process.env.XNLC_URL_AUTHLIB_INJECTOR_ROOT?.trim()
  if (root) {
    try {
      const host = new URL(root).hostname.toLowerCase()
      if (host) hosts.add(host)
    } catch {
      // Некорректный env — игнорируем, остаётся базовый список.
    }
  }
  return [...hosts]
}

/**
 * Override XNLC download URL environment variables to use
 * the BMCLAPI mirror. This speeds up downloads for users
 * in regions with poor access to official Mojang servers.
 */
export function applyBmclapiEnv(): void {
  process.env.XNLC_URL_MOJANG_META = BMCLAPI_BASE
  process.env.XNLC_URL_MOJANG_LAUNCHER = BMCLAPI_BASE
  process.env.XNLC_URL_MOJANG_LIBRARIES = `${BMCLAPI_BASE}/maven`
  process.env.XNLC_URL_MOJANG_ASSETS = `${BMCLAPI_BASE}/assets`
  process.env.XNLC_URL_FABRIC_MAVEN = `${BMCLAPI_BASE}/maven`
  process.env.XNLC_URL_FORGE_MAVEN = `${BMCLAPI_BASE}/maven`
  process.env.XNLC_URL_AUTHLIB_INJECTOR_ROOT = `${BMCLAPI_BASE}/mirrors/authlib-injector`
  process.env.XNLC_URL_MOJANG_JAVA_RUNTIME = `${BMCLAPI_BASE}/v1/products/java-runtime/2ec0cc96c44e5a76b9c8b7c39df7210883d12871/all.json`
}
