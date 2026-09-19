/**
 * Ссылка на страницу проекта на сайте площадки. Нужна из каталогов (моды,
 * ресурспаки, шейдеры, модпаки): раньше открыть страницу проекта можно было
 * только из «Информации» самой сборки, а из результатов поиска — никак.
 */
export type ProjectKind = "mod" | "modpack" | "resourcepack" | "shader" | "datapack" | "plugin"

/** Путь проекта на modrinth.com. */
const MODRINTH_PATH: Record<ProjectKind, string> = {
  mod: "mod",
  modpack: "modpack",
  resourcepack: "resourcepack",
  shader: "shader",
  datapack: "datapack",
  plugin: "plugin",
}

/** Путь проекта на curseforge.com/minecraft/... */
const CURSEFORGE_PATH: Record<ProjectKind, string> = {
  mod: "mc-mods",
  modpack: "modpacks",
  resourcepack: "texture-packs",
  shader: "shaders",
  datapack: "data-packs",
  plugin: "bukkit-plugins",
}

export type ProjectLinkSource = {
  source?: string | null
  slug?: string | null
  projectId?: string | null
  modId?: number | null
  id?: string | null
}

export function projectPageUrl(project: ProjectLinkSource, kind: ProjectKind = "mod"): string | null {
  const source = String(project.source ?? "")
  if (source === "modrinth") {
    // Modrinth принимает и slug, и id проекта в одном пути.
    const slug = project.slug || project.projectId || project.id
    return slug ? `https://modrinth.com/${MODRINTH_PATH[kind]}/${encodeURIComponent(slug)}` : null
  }
  if (source === "curseforge") {
    const slug = project.slug
    return slug ? `https://www.curseforge.com/minecraft/${CURSEFORGE_PATH[kind]}/${encodeURIComponent(slug)}` : null
  }
  if (source === "ftb") {
    const id = project.modId ?? project.projectId
    return id ? `https://www.feed-the-beast.com/modpack/${id}` : null
  }
  return null
}

/** Открывает страницу проекта в браузере. */
export function openProjectPage(project: ProjectLinkSource, kind: ProjectKind = "mod"): boolean {
  const url = projectPageUrl(project, kind)
  if (!url) return false
  window.open(url, "_blank")
  return true
}
