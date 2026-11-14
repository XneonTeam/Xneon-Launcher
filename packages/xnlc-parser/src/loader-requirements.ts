import type { ModMetadata } from "./metadata.js"
import { stringifyVersionRange } from "./jar-dependencies.js"

export interface DeclaredRequirement {
  loaderId: string
  requirement: string
}

export interface ModArchiveRequirements {
  modId?: string
  modName?: string
  requirements: DeclaredRequirement[]
}

export function normalizeLoaderId(loaderId?: string): string {
  const value = (loaderId ?? "").trim().toLowerCase()
  if (value === "fabric-legacy" || value === "fabric-loader") return "fabric"
  if (value === "quilt-loader") return "quilt"
  return value
}
const dependencyLoaders = new Map([
  ["fabricloader", "fabric"], ["fabric-loader", "fabric"],
  ["quilt_loader", "quilt"], ["quilt-loader", "quilt"],
  ["forge", "forge"], ["neoforge", "neoforge"],
])

export function getLoaderRequirements(mods: readonly ModMetadata[]): ModArchiveRequirements | undefined {
  const forge = mods.filter(mod => mod.loader === "forge" || mod.loader === "neoforge")
  const mod = mods.find(item => item.loader === "quilt") ?? mods.find(item => item.loader === "fabric")
    ?? forge.find(item => item.loader === "neoforge") ?? forge[0]
  if (!mod) return undefined
  const fabricLike = mod.loader === "fabric" || mod.loader === "quilt"
  const requirements = (fabricLike ? mod.dependencies : forge.flatMap(item => item.dependencies)).flatMap(dep => {
    if (dep.kind !== "depends" || dep.interpretation !== "declared" || !dep.id || (fabricLike && dep.optional !== false)) return []
    const loaderId = dependencyLoaders.get(dep.id.toLowerCase())
    const ranges = fabricLike && Array.isArray(dep.versions) ? dep.versions : [dep.versions]
    return ranges.flatMap(range => {
      const requirement = stringifyVersionRange(range)
      return loaderId && requirement ? [{ loaderId, requirement }] : []
    })
  })
  if (!fabricLike && mod.loaderVersion && !requirements.some(item => item.loaderId === mod.loader)) {
    requirements.push({ loaderId: mod.loader, requirement: mod.loaderVersion })
  }
  return { modId: mod.id, modName: mod.name ?? mod.id, requirements }
}
