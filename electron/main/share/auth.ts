import { safeStorage } from "electron"
import { createHash, generateKeyPairSync, sign } from "node:crypto"
import { ShareApiClient, ShareError, selectShareAccount } from "@xnlc/share"
import { dbHelpers } from "../../db"
import { run } from "../../db/core"

interface Credentials { url: string; token: string; userId?: string; expiresAt?: number; name?: string }
interface Configuration { url: string; token: string; userId: string; name: string }
let connecting: Promise<Configuration> | undefined
const DEFAULT_SHARE_URL = "https://xnlc-share.stepangavrilov736.workers.dev"

async function storedConfiguration() {
  const raw = await dbHelpers.getSetting("share.credentials")
  const stored = raw ? JSON.parse(raw) as Credentials : undefined
  const url = (process.env.XNLC_SHARE_URL || stored?.url || DEFAULT_SHARE_URL).replace(/\/$/, "")
  if (url) new ShareApiClient(url, async () => "", fetch)
  return { url, stored: stored?.url === url ? stored : undefined }
}
async function identity() {
  const raw = await dbHelpers.getSetting("share.identity")
  if (raw) return JSON.parse((await safeStorage.decryptStringAsync(Buffer.from(raw, "base64"))).result) as { publicKey: string; privateKey: string }
  const pair = generateKeyPairSync("ed25519")
  const keys = { publicKey: pair.publicKey.export({ type: "spki", format: "der" }).toString("base64"), privateKey: pair.privateKey.export({ type: "pkcs8", format: "pem" }).toString() }
  await dbHelpers.setSetting("share.identity", (await safeStorage.encryptStringAsync(JSON.stringify(keys))).toString("base64"))
  return keys
}
async function exchange(url: string, body: unknown, endpoint: string, legacyToken?: string) {
  const response = await fetch(url + "/v1/auth/" + endpoint, { method: "POST", redirect: "error", signal: AbortSignal.timeout(30000), headers: { "Content-Type": "application/json", ...(legacyToken ? { Authorization: `Bearer ${legacyToken}` } : {}) }, body: JSON.stringify(body) })
  const data = await response.json()
  if (!response.ok) throw new ShareError(data.error?.code ?? "HTTP", data.error?.message ?? "Share connection failed")
  return data
}
export async function shareConfiguration(): Promise<Configuration> {
  const account = selectShareAccount(await dbHelpers.loadAccounts())
  if (!account) throw new ShareError("ACCOUNT_REQUIRED", "Add a non-offline launcher account to use Share")
  const { url, stored } = await storedConfiguration()
  if (!url) throw new ShareError("SERVICE_UNAVAILABLE", "Share service has not been configured")
  if (connecting) return connecting
  connecting = (async () => {
    const keys = await identity(), userId = "launcher-" + createHash("sha256").update(Buffer.from(keys.publicKey, "base64")).digest("hex").slice(0, 32)
    if (stored?.userId === userId && stored.token && stored.expiresAt! > Date.now() + 60000 && stored.name === account.username) {
      return { url, userId, name: account.username, token: (await safeStorage.decryptStringAsync(Buffer.from(stored.token, "base64"))).result }
    }
    const challenge = await exchange(url, { publicKey: keys.publicKey }, "challenge") as { id: string; nonce: string }
    const signature = sign(null, Buffer.from(`XNLC/Share\n${challenge.id}\n${challenge.nonce}`), keys.privateKey).toString("base64")
    const legacyToken = stored?.token && !stored.userId ? (await safeStorage.decryptStringAsync(Buffer.from(stored.token, "base64"))).result : undefined
    const result = await exchange(url, { publicKey: keys.publicKey, challengeId: challenge.id, signature, name: account.username }, "launcher", legacyToken) as { token: string; user: { id: string; name: string }; expiresAt: number; migratedFrom?: string }
    await dbHelpers.setSetting("share.credentials", JSON.stringify({ url, token: (await safeStorage.encryptStringAsync(result.token)).toString("base64"), userId: result.user.id, name: account.username, expiresAt: result.expiresAt }))
    if (result.migratedFrom) run("UPDATE shared_instances SET user_id=? WHERE user_id=?", [result.user.id, result.migratedFrom])
    return { url, token: result.token, userId: result.user.id, name: account.username }
  })()
  try { return await connecting } finally { connecting = undefined }
}
export async function shareRequest(endpoint: string, method = "GET", body?: unknown, retry = true): Promise<any> {
  const c = await shareConfiguration()
  const response = await fetch(c.url + "/v1" + endpoint, { method, redirect: "error", signal: AbortSignal.timeout(30000), headers: { Authorization: `Bearer ${c.token}`, "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) })
  if (response.status === 401 && retry) {
    await dbHelpers.setSetting("share.credentials", JSON.stringify({ url: c.url, token: "" }))
    return shareRequest(endpoint, method, body, false)
  }
  const result = await response.json()
  if (!response.ok) throw new ShareError(result.error?.code ?? "HTTP", result.error?.message ?? "Share API request failed")
  return result
}
export async function shareSession() {
  const account = selectShareAccount(await dbHelpers.loadAccounts()), { url } = await storedConfiguration()
  if (!account) return { eligible: false, signedIn: false, configured: false, serviceAvailable: !!url }
  if (!url) return { eligible: true, signedIn: false, configured: false, serviceAvailable: false, username: account.username }
  const c = await shareConfiguration()
  return { eligible: true, signedIn: true, configured: true, serviceAvailable: true, user: c.userId, username: account.username }
}
