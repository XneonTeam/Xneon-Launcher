import type { ModVersion } from "@xnlc/types"

/** Проект может одновременно публиковать моды JAR и датапаки ZIP. */
export function datapackVersionFile(version: ModVersion): { fileName: string; downloadUrl?: string } | null {
  const loaders = (version.loaders ?? []).map(loader => loader.toLowerCase())
  if (loaders.length && !loaders.includes("datapack")) return null
  const file = version.files?.find(item => /\.zip$/i.test(item.filename))
  if (file) return { fileName: file.filename, downloadUrl: file.url }
  if (/\.zip$/i.test(version.fileName)) return { fileName: version.fileName, downloadUrl: version.downloadUrl }
  return null
}
