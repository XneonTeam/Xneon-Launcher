// ============================================================
// XNLC — BMCLAPI Configuration
// Bangbang93's Minecraft API mirror for Chinese users
// Extracted from minecraft-launch-worker.ts
// ============================================================

const BMCLAPI_BASE = "https://bmclapi2.bangbang93.com"

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
