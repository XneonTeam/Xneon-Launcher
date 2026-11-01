export type ShareContentCategory = "mods" | "plugins" | "resourcepacks" | "shaders" | "other"

export function shareContentCategory(path: string, categories?: readonly ShareContentCategory[]): ShareContentCategory {
  const category = /^mods\/[^/]+\.(jar|litemod)(\.disabled)?$/i.test(path) ? "mods" : /^plugins\/([^/]+\.jar(\.disabled)?$|[^/]+\/)/i.test(path) ? "plugins" : path.startsWith("resourcepacks/") ? "resourcepacks" : path.startsWith("shaderpacks/") ? "shaders" : "other"
  return !categories || categories.includes(category) ? category : "other"
}
