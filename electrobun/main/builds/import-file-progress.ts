import path from "path"
import type { ImportProgressFile } from "@xnlc/types" with { "resolution-mode": "import" }
import type { ModrinthManifestFile, FTBFile } from "@xnlc/mods" with { "resolution-mode": "import" }
import { loadModsModule, sendImportProgress, throwIfImportCancelled } from "./helpers"

const fileKind = (file: string): ImportProgressFile["kind"] => file.startsWith("mods/") ? "mod" : file.startsWith("resourcepacks/") ? "resourcepack" : file.startsWith("shaderpacks/") ? "shader" : "file"

/** Имена и иконки необязательны: недоступность каталога не мешает установке. */
export async function describeModrinthImportFiles(files: ModrinthManifestFile[], signal: AbortSignal): Promise<ImportProgressFile[]> {
  const mods = await loadModsModule()
  const projectIds = files.map(file => file.downloads?.map(url => url.match(/\/data\/([^/]+)\/versions\//)?.[1]).find(Boolean))
  let projects: Awaited<ReturnType<typeof mods.modrinthGetProjectsByIds>> = {}
  try { projects = await mods.modrinthGetProjectsByIds([...new Set(projectIds.filter((id): id is string => !!id))]) } catch {}
  throwIfImportCancelled(signal)
  return files.map((file, index) => {
    const fileName = path.basename(file.path ?? "")
    const project = projects[projectIds[index] ?? ""]
    return { id: file.path || String(index), fileName, name: project?.name || fileName, iconUrl: project?.iconUrl, kind: fileKind(file.path ?? ""), status: "queued" }
  })
}

export async function describeCurseforgeImportFiles(files: Array<{ projectID?: number; fileID?: number }>, batch: Record<number, { fileName: string }>, signal: AbortSignal): Promise<ImportProgressFile[]> {
  const mods = await loadModsModule()
  let projects: Awaited<ReturnType<typeof mods.curseforgeGetProjectsByIds>> = {}
  try { projects = await mods.curseforgeGetProjectsByIds(files.map(file => file.projectID!).filter(Boolean)) } catch {}
  throwIfImportCancelled(signal)
  return files.map((file, index) => {
    const candidate = projects[file.projectID!]
    const project = candidate?.isAvailable === false ? undefined : candidate
    const fileName = batch[file.fileID!]?.fileName || `mod-${file.fileID}.jar`
    return { id: `${file.projectID}:${file.fileID}:${index}`, name: project?.name || fileName, fileName, iconUrl: project?.iconUrl, kind: "mod", status: "queued" }
  })
}

export async function describeFtbImportFiles(files: FTBFile[], signal: AbortSignal): Promise<ImportProgressFile[]> {
  const mods = await loadModsModule()
  let projects: Awaited<ReturnType<typeof mods.curseforgeGetProjectsByIds>> = {}
  try { projects = await mods.curseforgeGetProjectsByIds(files.map(file => file.curseforge?.project).filter((id): id is number => !!id)) } catch {}
  throwIfImportCancelled(signal)
  return files.map((file, index) => {
    const fileName = path.basename(mods.getFTBPath(file))
    const candidate = projects[file.curseforge?.project ?? 0]
    const project = candidate?.isAvailable === false ? undefined : candidate
    return { id: `${file.id}:${index}`, name: project?.name || file.name || fileName, fileName, iconUrl: project?.iconUrl, kind: file.type === "mod" ? "mod" : fileKind(mods.getFTBPath(file)), status: "queued" }
  })
}

/** Передаём список один раз, затем только изменённый файл: сотни модов не дублируются в каждом IPC-событии. */
export function withImportFileProgress<T>(tasks: Array<() => Promise<T>>, files: ImportProgressFile[], signal: AbortSignal): Array<() => Promise<T>> {
  let complete = 0
  const emit = (file?: ImportProgressFile) => {
    if (signal.aborted) return
    sendImportProgress(Math.round(complete / Math.max(files.length, 1) * 90), 100, `${complete}/${files.length} файлов`, undefined, {
      phase: "files", fileCount: files.length, completedFiles: complete, ...(file ? { file } : { files }),
    })
  }
  emit()
  return tasks.map((task, index) => async () => {
    throwIfImportCancelled(signal)
    emit({ ...files[index], status: "downloading" })
    try {
      const result = await task()
      throwIfImportCancelled(signal)
      complete++
      emit({ ...files[index], status: "complete" })
      return result
    } catch (error) {
      emit({ ...files[index], status: "error" })
      throw error
    }
  })
}
