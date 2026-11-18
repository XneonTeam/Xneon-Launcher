import type { ContentUpdateInfo, ModVersion } from "@xnlc/types"

type InstalledContent = {
  id: string
  slug: string
  version: string
  source?: string
  versionId?: string
  fileId?: number
}

/** Старый SHA-1 никогда не должен обозначать скачанные байты новой версии. */
export function updatedContentItem<T extends InstalledContent>(item: T, version: ModVersion): T {
  const file = version.files?.[0]
  const hash = file?.hashes?.sha1
  return {
    ...item,
    id: hash && /^[a-f0-9]{40}$/i.test(hash) ? hash.toLowerCase() : `installed:${item.source ?? "local"}:${version.id}`,
    slug: file?.filename || version.fileName,
    version: version.versionNumber || version.name || version.id,
    versionId: item.source === "modrinth" ? version.id : undefined,
    fileId: item.source === "curseforge" && Number.isFinite(Number(version.id)) ? Number(version.id) : undefined,
  }
}

/** pack_format из ZIP — не номер релиза ресурспака на площадке. */
export function retainInstalledIdentity(installed: InstalledContent, scanned: InstalledContent): Pick<InstalledContent, "version" | "versionId" | "fileId"> {
  const sameBytes = installed.id === scanned.id
    || (installed.id.startsWith("installed:") && installed.slug === scanned.slug)
  if (sameBytes && (installed.versionId || installed.fileId)) {
    return { version: installed.version, versionId: installed.versionId, fileId: installed.fileId }
  }
  return { version: sameBytes && (!scanned.version || scanned.version === "local") ? installed.version : scanned.version, versionId: scanned.versionId, fileId: scanned.fileId }
}

export function scopedContentUpdates(updates: ContentUpdateInfo[], type: ContentUpdateInfo["contentType"]): ContentUpdateInfo[] {
  return updates.filter(update => update.contentType === type)
}
