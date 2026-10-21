import { useEffect, useState } from "react"
import { createPortal } from "react-dom"
import { useTranslation } from "react-i18next"
import type { ModDetails, ModVersion } from "@xnlc/types"
import type { ModalTab } from "../instance/types"
import type { ProjectKind } from "@/lib/project-links"
import { AddonDetailModal } from "../addon-detail-modal"
import { loadAgentProjectDetails } from "./project-details"

export default function AgentProjectDetailsModal({ project, onClose }: { project: Record<string, unknown>; onClose: () => void }) {
  const { t } = useTranslation()
  const [tab, setTab] = useState<ModalTab>("description")
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")
  const [versions, setVersions] = useState<ModVersion[]>([])
  const [details, setDetails] = useState<ModDetails>(() => ({
    id: String(project.id || project.projectId || project.modId || ""), slug: String(project.slug || ""), name: String(project.name || ""),
    summary: String(project.summary || ""), description: "", iconUrl: String(project.iconUrl || ""), downloadCount: Number(project.downloadCount || project.downloads || 0),
    source: project.source === "ftb" ? "ftb" : project.source === "curseforge" ? "curseforge" : "modrinth", categories: [], versions: [], gallery: [],
  }))
  useEffect(() => {
    let cancelled = false
    const api = window.electronAPI
    if (!api) { setLoading(false); setError(t("agent.projectLoadError")); return }
    void loadAgentProjectDetails(api, project).then(result => {
      if (!cancelled) { setDetails(result.details); setVersions(result.versions) }
    }).catch(() => { if (!cancelled) setError(t("agent.projectLoadError")) }).finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [project, t])
  const kind = ["mod", "modpack", "resourcepack", "shader", "datapack", "plugin"].includes(String(project.contentType)) ? project.contentType as ProjectKind : "mod"
  return createPortal(<AddonDetailModal selectedDetails={details} modalTab={tab} setModalTab={setTab} loadingModal={loading} loadError={error} displayedModalVersions={versions} projectKind={kind} onClose={onClose} />, document.body)
}
