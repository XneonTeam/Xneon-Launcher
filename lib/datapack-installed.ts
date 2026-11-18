import type { DatapackInfo } from "@xnlc/types"

type Project = { id?: string; projectId?: string; modId?: number; source: string; name: string; slug?: string; author?: string; primaryFileName?: string }
const identity = (value?: string) => (value ?? "").trim().toLocaleLowerCase().replace(/\.zip$/i, "").replace(/[\s_-]+/g, " ")

/** ID — приоритетный; между площадками сравниваем точное имя, не подстроку. */
export function findInstalledDatapack(packs: DatapackInfo[], project: Project): DatapackInfo | undefined {
  return packs.find(pack => {
    if (pack.parseError) return false
    if (pack.projectId) {
      // Текущий DTO хранит ID без provider: числовые ID принадлежат CurseForge.
      const provider = /^\d+$/.test(pack.projectId) ? "curseforge" : "modrinth"
      const projectId = project.source === "curseforge" ? String(project.modId ?? project.projectId ?? project.id ?? "") : project.projectId ?? project.id
      if (provider === project.source && projectId) return pack.projectId === projectId
    }
    if (pack.author && project.author && identity(pack.author) !== identity(project.author)) return false
    if (project.primaryFileName && identity(pack.name) === identity(project.primaryFileName)) return true
    return !!identity(project.name) && identity(pack.displayName || pack.name) === identity(project.name)
  })
}
