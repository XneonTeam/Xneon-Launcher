import fs from "fs/promises"
import path from "path"

export type ContentDropKind = "mod" | "resourcepack" | "shader"

/**
 * Почему файл не приняли. Коды, а не текст: сообщение собирает рендерер на
 * языке пользователя.
 */
export type ContentDropRejectReason = "notFound" | "folderNotAllowed" | "wrongExtension" | "empty"

export interface ContentDropEntry {
  path: string
  name: string
  isDirectory: boolean
}

export interface ContentDropClassification {
  accepted: ContentDropEntry[]
  rejected: Array<ContentDropEntry & { reason: ContentDropRejectReason }>
}

/** Что вообще можно положить в сборку для каждого типа контента. */
const ALLOWED_EXTENSIONS: Record<ContentDropKind, string[]> = {
  mod: [".jar", ".litemod"],
  resourcepack: [".zip"],
  shader: [".zip"],
}

/**
 * Папки принимаем только там, где Minecraft читает их сам — ресурспаки и
 * шейдеры работают распакованными, моды — нет.
 */
const ALLOWED_FOLDERS: Record<ContentDropKind, boolean> = {
  mod: false,
  resourcepack: true,
  shader: true,
}

export async function classifyContentDropPaths(rawPaths: string[], kind: ContentDropKind): Promise<ContentDropClassification> {
  const accepted: ContentDropEntry[] = []
  const rejected: Array<ContentDropEntry & { reason: ContentDropRejectReason }> = []

  for (const rawPath of rawPaths) {
    const target = rawPath?.trim()
    if (!target) continue

    const name = path.basename(target)
    const stat = await fs.stat(target).catch(() => null)
    if (!stat) {
      rejected.push({ path: target, name, isDirectory: false, reason: "notFound" })
      continue
    }

    const isDirectory = stat.isDirectory()
    if (isDirectory) {
      if (ALLOWED_FOLDERS[kind]) accepted.push({ path: target, name, isDirectory })
      else rejected.push({ path: target, name, isDirectory, reason: "folderNotAllowed" })
      continue
    }

    if (stat.size === 0) {
      rejected.push({ path: target, name, isDirectory: false, reason: "empty" })
      continue
    }

    const extension = path.extname(name).toLowerCase()
    if (ALLOWED_EXTENSIONS[kind].includes(extension)) accepted.push({ path: target, name, isDirectory })
    else rejected.push({ path: target, name, isDirectory: false, reason: "wrongExtension" })
  }

  return { accepted, rejected }
}
