import { lstat, readFile } from "node:fs/promises"
import { CONTENT_URLS } from "@xnlc/urls"
import path from "node:path"
import { ArchiveContext, curseforgeFingerprintFile, extractIcon, probeImage, sha1File, type DatapackMetadata } from "@xnlc/parser"
import type { DatapackInfo } from "@xnlc/types" with { "resolution-mode": "import" }
import type { CurseforgeFingerprintsResult, ModProjectInfo } from "@xnlc/mods"

type Display = Pick<DatapackInfo, "displayName" | "description" | "iconUrl" | "author" | "projectId">

/** Текстовые компоненты Minecraft без цветов и форматирования. */
function plainText(value: unknown, depth = 0): string {
  if (depth > 16) return ""
  if (typeof value === "string") return value.replace(/§[0-9a-fk-orx]/gi, "")
  if (Array.isArray(value)) return value.map(item => plainText(item, depth + 1)).join("")
  if (!value || typeof value !== "object") return ""
  const component = value as Record<string, unknown>
  return plainText(component.text, depth + 1) + plainText(component.extra, depth + 1)
}

export async function localDatapackDisplay(filePath: string, pack: DatapackMetadata): Promise<Display> {
  const description = plainText(pack.description).trim().slice(0, 4096)
  const section = pack.raw.pack as Record<string, unknown> | undefined
  const explicitName = plainText(section?.name ?? pack.raw.name).trim()
  const fallback = path.basename(filePath).replace(/\.zip$/i, "").replace(/[_-]v?\d.*$/i, "").replace(/_/g, " ")
  const displayName = (explicitName || description.split(/\r?\n/)[0] || fallback).slice(0, 160)
  let iconUrl: string | undefined
  try {
    if (pack.iconPath) {
      const stat = await lstat(filePath)
      if (stat.isDirectory() && !stat.isSymbolicLink()) {
        // У датапака иконка находится в корне; ссылки наружу не читаем.
        const iconPath = path.join(filePath, "pack.png")
        const iconStat = await lstat(iconPath)
        if (iconStat.isFile() && !iconStat.isSymbolicLink() && iconStat.size <= 1024 * 1024) {
          const bytes = await readFile(iconPath)
          iconUrl = `data:${probeImage(bytes).mimeType};base64,${bytes.toString("base64")}`
        }
      } else if (stat.isFile()) {
        const archive = await ArchiveContext.open(filePath)
        try {
          const icon = await extractIcon(archive, pack.iconPath)
          if (icon) iconUrl = `data:${icon.mimeType};base64,${Buffer.from(icon.data).toString("base64")}`
        } finally { archive.close() }
      }
    }
  } catch { /* Отсутствующая или повреждённая иконка не скрывает датапак. */ }
  return { displayName, description: description || undefined, iconUrl }
}

const API = CONTENT_URLS.modrinthApi
const metadataCache = new Map<string, { value: Display; expires: number }>()

export type CurseforgeDatapackClient = {
  matches: (fingerprints: number[], signal: AbortSignal) => Promise<CurseforgeFingerprintsResult>
  project: (id: number) => Promise<ModProjectInfo | null>
}

const curseforgeClient: CurseforgeDatapackClient = {
  matches: async (fingerprints, signal) => (await import("@xnlc/mods")).curseforgeGetFingerprintsMatches(fingerprints, signal),
  project: async id => (await import("@xnlc/mods")).curseforgeGetProjectInfo(id),
}

/** Сопоставляем только точные байты файла, а не похожее название проекта. */
export async function enrichDatapacks(items: DatapackInfo[], fetcher: typeof fetch = fetch, curseforge: CurseforgeDatapackClient | null = curseforgeClient): Promise<DatapackInfo[]> {
  const result = items.map(item => ({ ...item }))
  const byHash = new Map<string, DatapackInfo[]>()
  // Последовательное хеширование не загружает все ZIP в память одновременно.
  for (const item of result) {
    try {
      if (!(await lstat(item.path)).isFile()) continue
      const hash = await sha1File(item.path)
      const cached = fetcher === fetch ? metadataCache.get(hash) : undefined
      if (cached && cached.expires > Date.now()) { Object.assign(item, cached.value); continue }
      const group = byHash.get(hash) ?? []
      group.push(item)
      byHash.set(hash, group)
    } catch { /* Папки и недоступные файлы остаются с локальными данными. */ }
  }
  if (!byHash.size) return result
  const signal = AbortSignal.timeout(5000)
  const json = async (route: string, body?: unknown): Promise<unknown> => {
    const response = await fetcher(`${API}${route}`, {
      signal,
      method: body ? "POST" : "GET",
      headers: { "User-Agent": "XneonLauncher/1.0 (https://launcher.xneon.org)", ...(body ? { "Content-Type": "application/json" } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}),
    })
    if (!response.ok) throw new Error(`Modrinth API ${response.status}`)
    return response.json()
  }
  const hashes = [...byHash.keys()]
  const resolved = new Map<string, Display>()
  for (let start = 0; start < hashes.length; start += 50) {
    try {
      const batch = hashes.slice(start, start + 50)
      const versions = await json("/version_files", { hashes: batch, algorithm: "sha1" }) as Record<string, { project_id: string }>
      const ids = [...new Set(batch.flatMap(hash => versions[hash]?.project_id ? [versions[hash].project_id] : []))]
      const projects = ids.length ? await json(`/projects?ids=${encodeURIComponent(JSON.stringify(ids))}`) as Array<{ id: string; title: string; icon_url?: string; team?: string }> : []
      const displays = new Map<string, Display>()
      for (const project of projects) {
        let author: string | undefined
        if (project.team) {
          try {
            const members = await json(`/team/${encodeURIComponent(project.team)}/members`) as Array<{ role: string; user?: { username?: string } }>
            const owners = members.filter(member => member.role?.toLowerCase() === "owner")
            author = (owners.length ? owners : members).map(member => member.user?.username).filter(Boolean).join(", ") || undefined
          } catch { /* Название и иконка доступны и без состава команды. */ }
        }
        displays.set(project.id, {
          displayName: project.title,
          ...(project.icon_url?.startsWith("https://") ? { iconUrl: project.icon_url } : {}),
          ...(author ? { author } : {}),
          projectId: project.id,
        })
      }
      for (const hash of batch) {
        const value = displays.get(versions[hash]?.project_id)
        if (value) resolved.set(hash, value)
      }
    } catch { /* Сбой сети не является ошибкой локального датапака. */ }
  }
  if (curseforge) {
    // Fingerprint не криптографический: при наличии SHA-1 сверяем и его.
    const fingerprints = new Map<string, number>()
    for (const hash of hashes) {
      if (resolved.has(hash)) continue
      try { fingerprints.set(hash, await curseforgeFingerprintFile(byHash.get(hash)![0].path)) }
      catch { /* Файл мог исчезнуть после локального сканирования. */ }
    }
    const pending = [...fingerprints.keys()]
    const projects = new Map<number, ModProjectInfo | null>()
    for (let start = 0; start < pending.length; start += 50) {
      try {
        const batch = pending.slice(start, start + 50)
        const matches = await curseforge.matches([...new Set(batch.map(hash => fingerprints.get(hash)!))], AbortSignal.timeout(5000))
        for (const hash of batch) {
          const match = matches.exactMatches.find(item => item.modId > 0 && item.fileFingerprint === fingerprints.get(hash) && (!item.sha1 || item.sha1.toLowerCase() === hash))
          if (!match) continue
          if (!projects.has(match.modId)) projects.set(match.modId, await curseforge.project(match.modId))
          const project = projects.get(match.modId)
          if (!project) continue
          resolved.set(hash, {
            displayName: project.name,
            ...(project.iconUrl?.startsWith("https://") ? { iconUrl: project.iconUrl } : {}),
            ...(project.author ? { author: project.author } : {}),
            projectId: String(match.modId),
          })
        }
      } catch { /* Недоступность CurseForge не мешает локальному списку. */ }
    }
  }
  for (const hash of hashes) {
    const value = resolved.get(hash)
    if (value) for (const item of byHash.get(hash) ?? []) Object.assign(item, value)
    // Кратко запоминаем промахи, но не сохраняем их на диск как метаданные.
    if (fetcher === fetch && curseforge === curseforgeClient) {
      metadataCache.delete(hash)
      metadataCache.set(hash, { value: value ?? {}, expires: Date.now() + (value ? 3600_000 : 60_000) })
      while (metadataCache.size > 256) metadataCache.delete(metadataCache.keys().next().value!)
    }
  }
  return result
}
