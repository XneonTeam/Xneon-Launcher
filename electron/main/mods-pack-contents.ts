import { createHash } from "node:crypto"
import { loadAdmZip } from "./builds/archive-utils"
import type * as ModsApi from "@xnlc/mods" with { "resolution-mode": "import" }

const MAX_ARCHIVE_BYTES = 32 * 1024 * 1024
const MAX_INDEX_BYTES = 2 * 1024 * 1024

/** Читает только индекс архива в памяти: не устанавливает сборку и не извлекает файлы. */
export async function readModrinthPackContents(mods: typeof ModsApi, slug: string, versionId: string) {
  if (typeof slug !== "string" || !slug || typeof versionId !== "string" || !versionId) throw new Error("Project and version are required")
  const project = await mods.modrinthGetDetails(slug)
  if (!project) throw new Error("Project not found")
  const version = (await mods.modrinthGetVersions(project.id)).find(item => item.id === versionId)
  const file = version?.files?.find(item => item.filename.endsWith(".mrpack"))
  if (!version || !file) throw new Error("Modpack version archive not found")
  const url = new URL(file.url)
  if (url.protocol !== "https:" || url.hostname !== "cdn.modrinth.com") throw new Error("Unsupported modpack archive host")
  if (file.size > MAX_ARCHIVE_BYTES) throw new Error("Modpack archive is too large for inspection")
  const response = await fetch(url, { signal: AbortSignal.timeout(30_000), redirect: "error" })
  if (!response.ok || !response.body) throw new Error(`Modpack archive HTTP ${response.status}`)
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of response.body) {
    size += chunk.length
    if (size > MAX_ARCHIVE_BYTES) throw new Error("Modpack archive is too large for inspection")
    chunks.push(Buffer.from(chunk))
  }
  const buffer = Buffer.concat(chunks)
  if (file.hashes?.sha512 && createHash("sha512").update(buffer).digest("hex") !== file.hashes.sha512) throw new Error("Modpack archive hash mismatch")
  const AdmZip = await loadAdmZip()
  const zip = new AdmZip(buffer)
  const entry = zip.getEntry("modrinth.index.json")
  if (!entry) throw new Error("Modpack index not found")
  // Проверяем распакованный размер до декомпрессии индекса.
  const declaredSize = (entry as unknown as { header: { size: number } }).header.size
  if (declaredSize > MAX_INDEX_BYTES) throw new Error("Modpack index is too large")
  const raw: unknown = JSON.parse(entry.getData().toString("utf8"))
  if (!raw || typeof raw !== "object") throw new Error("Invalid modpack index")
  const index = raw as { game?: string; files?: unknown[]; dependencies?: Record<string, unknown> }
  if (index.game !== "minecraft" || !Array.isArray(index.files) || index.files.length > 2000) throw new Error("Invalid modpack files")
  const files = index.files.map(value => {
    if (!value || typeof value !== "object") throw new Error("Invalid modpack file")
    const item = value as { path?: unknown; hashes?: { sha1?: unknown }; env?: { client?: unknown; server?: unknown } }
    if (typeof item.path !== "string" || item.path.length > 1000) throw new Error("Invalid modpack file path")
    return { path: item.path, sha1: typeof item.hashes?.sha1 === "string" && /^[a-f0-9]{40}$/i.test(item.hashes.sha1) ? item.hashes.sha1.toLowerCase() : undefined,
      environment: item.env ? { client: typeof item.env.client === "string" ? item.env.client : undefined, server: typeof item.env.server === "string" ? item.env.server : undefined } : undefined }
  })
  const hashes = files.flatMap(item => item.sha1 ? [item.sha1] : [])
  const resolved = await mods.modrinthGetFilesByHash(hashes)
  return { projectId: project.id, versionId, name: project.name,
    dependencies: Object.fromEntries(Object.entries(index.dependencies ?? {}).filter((pair): pair is [string, string] => typeof pair[1] === "string")),
    files: files.map(item => ({ ...item, ...(item.sha1 ? resolved[item.sha1] : {}) })), totalFiles: files.length }
}
