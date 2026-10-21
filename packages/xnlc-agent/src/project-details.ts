import type { ElectronAPI, ModDetails, ModVersion } from "@xnlc/types"

/** Те же методы каталога, что используются при открытии проекта в сборке. */
export async function loadAgentProjectDetails(api: ElectronAPI, project: Record<string, unknown>): Promise<{ details: ModDetails; versions: ModVersion[] }> {
  if (project.source === "ftb") { const id = Number(project.modId || project.projectId || project.id); if (!Number.isSafeInteger(id) || id <= 0) throw new Error("Invalid FTB project ID"); const details = await api.modsFtbDetails(id); if (!details) throw new Error("Project not found"); return { details, versions: details.versions || [] } }
  if (project.source === "curseforge") {
    const id = Number(project.modId || project.projectId || project.id)
    if (!Number.isSafeInteger(id) || id <= 0) throw new Error("Invalid CurseForge project ID")
    const details = await api.modsCurseforgeDetails(id)
    if (!details) throw new Error("Project not found")
    return { details, versions: details.versions || [] }
  }
  if (project.source !== "modrinth") throw new Error("Project source is unavailable")
  const id = String(project.projectId || project.id || project.slug || "")
  if (!id) throw new Error("Project ID is unavailable")
  const [details, versions] = await Promise.all([api.modsModrinthDetails(id), api.modsModrinthVersions(id)])
  if (!details) throw new Error("Project not found")
  return { details, versions: versions || [] }
}
