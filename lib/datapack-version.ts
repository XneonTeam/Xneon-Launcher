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

/** Только датапаки; у смешанных проектов первый релиз часто является модом. */
export function datapackVersions(versions: ModVersion[], gameVersion?: string): ModVersion[] {
  return versions.flatMap(version => {
    const file = datapackVersionFile(version)
    if (!file) return []
    if (gameVersion && !version.gameVersion.split(/[|,/]/).map(value => value.trim()).includes(gameVersion)) return []
    return [{ ...version, ...file }]
  })
}
