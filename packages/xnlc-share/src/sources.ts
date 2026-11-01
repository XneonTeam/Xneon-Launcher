import type { ContentSourceAdapter, Hashes, SourceReference, ResolvedFile, HashPort } from "./types.js"
import { fail } from "./manifest.js"

export type FetchPort = (url: string, init?: RequestInit) => Promise<Response>
export function checkDownloadUrl(url: string, provider: string): string {
  const parsed = new URL(url)
  const hosts: Record<string, string[]> = { modrinth: ["cdn.modrinth.com"], curseforge: ["edge.forgecdn.net", "mediafilez.forgecdn.net"] }
  if (parsed.protocol !== "https:" || parsed.username || parsed.password || parsed.port || !hosts[provider]?.includes(parsed.hostname)) fail("SOURCE_URL", "Untrusted source download URL")
  return parsed.href
}
async function json<T>(fetcher: FetchPort, url: string, headers: Record<string, string>, body?: unknown): Promise<T | null> {
  let response: Response
  try { response = await fetcher(url, { headers, redirect: "error", signal: AbortSignal.timeout(30000), ...(body === undefined ? {} : { method: "POST", body: JSON.stringify(body) }) }) }
  catch { return fail("SOURCE_UNAVAILABLE", "Content source is unavailable") }
  if (response.status === 404) return null
  if (!response.ok) fail("SOURCE_UNAVAILABLE", `Content source returned ${response.status}`)
  return response.json() as Promise<T>
}
interface MRVersion { id: string; project_id: string; files: { filename: string; url: string; size: number; hashes: { sha512: string } }[]; dependencies: { version_id: string | null }[] }
export class ModrinthSource implements ContentSourceAdapter {
  readonly id = "modrinth"
  private identityCache = new Map<string, { value: ResolvedFile | null; expires: number }>()
  constructor(private fetcher: FetchPort, private userAgent = "XneonLauncher/Share (support@xneon.org)") {}
  private map(version: MRVersion, file: MRVersion["files"][number]): ResolvedFile {
    return { source: { provider: this.id, projectId: version.project_id, versionId: version.id, fileId: file.hashes.sha512 }, sha512: file.hashes.sha512, size: file.size, url: checkDownloadUrl(file.url, this.id), dependencies: version.dependencies.map(d => d.version_id).filter((v): v is string => !!v) }
  }
  async identifyMany(hashes: Hashes[], force = false): Promise<(ResolvedFile | null)[]> {
    const result = new Map<string, ResolvedFile | null>()
    const missing: string[] = []
    for (const sha512 of new Set(hashes.map(hash => hash.sha512))) {
      const cached = this.identityCache.get(sha512)
      if (!force && cached && cached.expires > Date.now()) result.set(sha512, cached.value)
      else missing.push(sha512)
    }
    // Как во вкладке модов: один запрос на пачку, а не запрос на каждый архив.
    for (let offset = 0; offset < missing.length; offset += 80) {
      const batch = missing.slice(offset, offset + 80)
      const versions = await json<Record<string, MRVersion>>(this.fetcher, "https://api.modrinth.com/v2/version_files", { "User-Agent": this.userAgent, "Content-Type": "application/json" }, { hashes: batch, algorithm: "sha512" })
      if (!versions) fail("SOURCE_UNAVAILABLE", "Modrinth batch lookup is unavailable")
      for (const sha512 of batch) {
        const version = versions[sha512]
        const file = version?.files.find(file => file.hashes.sha512 === sha512)
        const value = version && file ? this.map(version, file) : null
        result.set(sha512, value)
        if (this.identityCache.size >= 10000) this.identityCache.delete(this.identityCache.keys().next().value!)
        this.identityCache.set(sha512, { value, expires: Date.now() + (value ? 300000 : 30000) })
      }
    }
    return hashes.map(hash => result.get(hash.sha512) ?? null)
  }
  async identify(hashes: Hashes, hint?: SourceReference): Promise<ResolvedFile | null> {
    if (hint?.provider === this.id) {
      try { const known = await this.resolve(hint); if (known.sha512 === hashes.sha512) return known }
      catch (e) { if ((e as { code?: string }).code !== "VERSION_UNAVAILABLE") throw e }
    }
    const v = await json<MRVersion>(this.fetcher, `https://api.modrinth.com/v2/version_file/${hashes.sha512}?algorithm=sha512`, { "User-Agent": this.userAgent })
    const file = v?.files.find(f => f.hashes.sha512 === hashes.sha512)
    return v && file ? this.map(v, file) : null
  }
  async resolve(source: SourceReference): Promise<ResolvedFile> {
    const v = await json<MRVersion>(this.fetcher, `https://api.modrinth.com/v2/version/${encodeURIComponent(source.versionId)}`, { "User-Agent": this.userAgent })
    const file = v?.files.find(f => f.hashes.sha512 === source.fileId)
    if (!v || v.project_id !== source.projectId || !file) fail("VERSION_UNAVAILABLE", "Exact Modrinth version/file is unavailable")
    return this.map(v, file)
  }
  async download(file: ResolvedFile): Promise<Uint8Array> {
    const r = await this.fetcher(checkDownloadUrl(file.url, this.id), { redirect: "error", signal: AbortSignal.timeout(120000) })
    if (!r.ok) fail("SOURCE_UNAVAILABLE", `Modrinth download returned ${r.status}`)
    return readBounded(r, file.size)
  }
}
interface CFFile { id: number; modId: number; fileLength: number; downloadUrl: string | null; hashes: { algo: number; value: string }[]; dependencies: { modId: number }[] }
export class CurseForgeSource implements ContentSourceAdapter {
  readonly id = "curseforge"
  constructor(private fetcher: FetchPort, private key: string, private hash: HashPort) {}
  async resolve(source: SourceReference): Promise<ResolvedFile> {
    if (!this.key) fail("SOURCE_AUTH", "CurseForge API key is required")
    if (source.versionId !== source.fileId) fail("SOURCE", "CurseForge file/version IDs must match")
    const response = await json<{ data: CFFile }>(this.fetcher, `https://api.curseforge.com/v1/mods/${encodeURIComponent(source.projectId)}/files/${encodeURIComponent(source.fileId)}`, { "x-api-key": this.key })
    const file = response?.data
    if (!file || String(file.modId) !== source.projectId || String(file.id) !== source.fileId) fail("VERSION_UNAVAILABLE", "Exact CurseForge file is unavailable")
    if (!file.downloadUrl) fail("SOURCE_RESTRICTED", "CurseForge author has restricted third-party downloads")
    return { source, size: file.fileLength, url: checkDownloadUrl(file.downloadUrl, this.id), dependencies: file.dependencies.map(d => String(d.modId)) }
  }
  async identify(hashes: Hashes, hint?: SourceReference): Promise<ResolvedFile | null> {
    if (!hint || hint.provider !== this.id) return null
    const file = await this.resolve(hint)
    // SHA-1 из API недостаточно: сравниваем SHA-256 с официально полученными байтами.
    const sha256 = await this.hash.digest(await this.download(file))
    return sha256 === hashes.sha256 ? { ...file, sha256 } : null
  }
  async download(file: ResolvedFile): Promise<Uint8Array> {
    const r = await this.fetcher(checkDownloadUrl(file.url, this.id), { redirect: "error", signal: AbortSignal.timeout(120000) })
    if (!r.ok) fail("SOURCE_UNAVAILABLE", `CurseForge download returned ${r.status}`)
    return readBounded(r, file.size)
  }
}
export async function readBounded(response: Response, limit: number): Promise<Uint8Array> {
  if (!Number.isSafeInteger(limit) || limit < 0 || limit > 512 * 1024 * 1024) fail("SIZE", "Download exceeds memory limit")
  const reader = response.body?.getReader()
  if (!reader) return new Uint8Array()
  const chunks: Uint8Array[] = []; let size = 0
  try {
    for (;;) { const next = await reader.read(); if (next.done) break; size += next.value.length; if (size > limit) fail("SIZE", "Download exceeds expected size"); chunks.push(next.value) }
  } finally { await reader.cancel() }
  const bytes = new Uint8Array(size); let offset = 0
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length }
  return bytes
}
