// ============================================================
// XNLC — BMCLAPI Configuration
// Bangbang93's Minecraft API mirror for Chinese users
// Extracted from minecraft-launch-worker.ts
// ============================================================

export { applyBmclapiEnv } from "@xnlc/urls/minecraft"

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
