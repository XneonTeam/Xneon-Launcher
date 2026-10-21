import type { ElectronAPI, ModLoaderFilter, ModSearchResponse } from "@xnlc/types"

/** Покрытие версий в выборке популярных модпаков, а не статистика игроков. */
export async function recommendMinecraftVersions(api: ElectronAPI, query = "", loader?: ModLoaderFilter) {
  const releases = (await api.getMinecraftVersions()).filter(item => item.type === "release" && item.stable)
  if (!releases.length) throw new Error("Minecraft release list is unavailable")
  const available = new Set(releases.map(item => item.version))
  const catalogs = await Promise.allSettled([
    api.modsModrinthSearch(query, "modpack", undefined, loader, "downloads", 0),
    api.modsCurseforgeSearch(query, "modpack", undefined, loader, "downloads", 0),
  ])
  const sources = ["modrinth", "curseforge"] as const
  const samples: Array<{ source: string; catalog: ModSearchResponse }> = []
  const errors: Array<{ source: string; error: string }> = []
  catalogs.forEach((result, index) => {
    if (result.status === "fulfilled") samples.push({ source: sources[index], catalog: result.value })
    else errors.push({ source: sources[index], error: result.reason instanceof Error ? result.reason.message : String(result.reason) })
  })
  const candidates = new Map<string, { version: string; supportedModpacksInSample: number; examples: Array<{ source: string; id: string; name: string }> }>()
  for (const { source, catalog } of samples) {
    const seen = new Set<string>()
    for (const project of catalog.results) {
      const id = project.projectId || String(project.modId || project.id)
      if (seen.has(id)) continue
      seen.add(id)
      for (const version of new Set(project.gameVersions ?? [])) {
        if (!available.has(version)) continue
        const entry = candidates.get(version) ?? { version, supportedModpacksInSample: 0, examples: [] }
        entry.supportedModpacksInSample++
        if (entry.examples.length < 3) entry.examples.push({ source, id, name: project.name })
        candidates.set(version, entry)
      }
    }
  }
  const ranked = [...candidates.values()].sort((a, b) => b.supportedModpacksInSample - a.supportedModpacksInSample || b.version.localeCompare(a.version, undefined, { numeric: true })).slice(0, 6)
  const checked = await Promise.all(ranked.map(async candidate => {
    const loaders = loader ? [loader] : ["fabric", "forge", "neoforge", "quilt"] as const
    const checks = await Promise.all(loaders.map(async name => {
      try {
        const versions = name === "fabric" ? await api.getFabricVersions(candidate.version)
          : name === "forge" ? await api.getForgeVersions(candidate.version)
          : name === "neoforge" ? await api.getNeoForgeVersions(candidate.version)
          : name === "quilt" ? await api.getQuiltVersions(candidate.version) : []
        return { loader: name, available: versions.length > 0 }
      } catch (error) { return { loader: name, available: false, error: error instanceof Error ? error.message : String(error) } }
    }))
    return { ...candidate, loaders: checks }
  }))
  return {
    latestRelease: releases[0].version,
    candidates: checked.filter(candidate => candidate.loaders.some(item => item.available)),
    samples: samples.map(({ source, catalog }) => ({ source, sampledProjects: catalog.results.length, totalMatchingProjects: catalog.totalCount })),
    errors,
    instruction: "These are verified releases ranked by coverage in a sample of popular modpacks, not global version popularity or proof of mod compatibility. Offer suitable candidates, explain the sample and loader availability. Check required project versions before recommending a final Minecraft/loader pair. If candidates are empty or catalogs fail, report insufficient data; do not invent popular versions. Do not switch the user's chosen version automatically.",
  }
}
