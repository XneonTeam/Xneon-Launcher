import { ArchiveContext } from "./archive.js"
import { analyzeOpen, type ParserDiagnostic, type ParserResult } from "./metadata.js"
import { extractIcon } from "./utilities.js"
import { getLoaderRequirements, type ModArchiveRequirements } from "./loader-requirements.js"
import type { JarDeclaredDependencies } from "./jar-inspector.js"
import { stringifyVersionRange } from "./jar-dependencies.js"

export type ContentMetadata = { name?: string; version?: string; description?: string; icon_url?: string; author?: string; diagnostics?: ParserDiagnostic[] }

/** Извлекает сводку для списка контента за один обход архива. */
export function getDeclaredDependencies(result: ParserResult): JarDeclaredDependencies | null {
  const fabric = result.mods.find(item => item.loader === "fabric")
  const quilt = result.mods.find(item => item.loader === "quilt")
  const forge = result.mods.filter(mod => mod.loader === "forge" || mod.loader === "neoforge")
  const mod = fabric ?? quilt ?? forge[0] ?? result.mods.find(item => ["paper", "bukkit", "bungee", "velocity"].includes(item.loader))
  if (!mod) return null
  return { modId: mod.id ?? null, declared: (fabric ? [fabric] : quilt ? [quilt] : forge.length ? forge : [mod])
    .flatMap(item => item.dependencies)
    .filter(dep => dep.kind === "depends" && dep.optional === false && dep.interpretation === "declared" && dep.id)
    .map(dep => ({ modId: dep.id!, versionRange: stringifyVersionRange(dep.versions) })) }
}

export async function inspectArchive(input: string | Uint8Array | ArchiveContext, request: { metadata?: boolean; dependencies?: boolean; loaderRequirements?: boolean; signal?: AbortSignal; nested?: boolean; parsed?: ParserResult }): Promise<{ metadata: ContentMetadata | null; dependencies: JarDeclaredDependencies | null; loaderRequirements?: ModArchiveRequirements; diagnostics: ParserDiagnostic[]; analysis: ParserResult }> {
  const archive = input instanceof ArchiveContext ? input : await ArchiveContext.open(input, { signal: request.signal })
  try {
    // Встроенные JAR перечисляются парсером и без рекурсивного анализа; данные
    // дочерних архивов не используются в контрактах списка и зависимостей.
    const result = request.parsed ?? await analyzeOpen(archive, { signal: request.signal, nested: request.nested })
    const inspection: { metadata: ContentMetadata | null; dependencies: JarDeclaredDependencies | null; loaderRequirements?: ModArchiveRequirements; diagnostics: ParserDiagnostic[]; analysis: ParserResult } = { metadata: null, dependencies: null, diagnostics: [...result.diagnostics], analysis: result }
    if (request.dependencies) inspection.dependencies = getDeclaredDependencies(result)
    if (request.loaderRequirements) inspection.loaderRequirements = getLoaderRequirements(result.mods)
    if (!request.metadata) return inspection
    // Порядок соответствует существующему контракту выбора metadata лаунчера.
    const toml = (loader: string) => result.mods.find(item => item.loader === loader && item.raw && typeof item.raw === "object" && "root" in item.raw && item.name?.trim() && item.name.trim() !== "Example Mod")
    const mod = toml("neoforge") ?? toml("forge")
      ?? result.mods.find(item => item.loader === "forge" && item.raw && typeof item.raw === "object" && !("root" in item.raw) && item.name?.trim() && item.name.trim() !== "Example Mod")
      ?? result.mods.find(item => item.loader === "quilt" && item.name?.trim())
      ?? result.mods.find(item => item.loader === "fabric" && item.name?.trim())
      ?? result.mods.find(item => item.loader === "liteloader" && item.name?.trim())
      ?? result.mods.find(item => ["resourcepack", "datapack", "hybridpack", "unknownpack", "shaderpack"].includes(item.loader))
      ?? result.mods.find(item => ["paper", "bukkit", "bungee", "velocity"].includes(item.loader) && item.name?.trim())
    if (!mod) return inspection
    const format = mod.loader
    const raw = mod.raw && typeof mod.raw === "object" ? mod.raw as Record<string, unknown> : {}
    let icon_url: string | undefined
    if (mod.iconPath) {
      try {
        const icon = await extractIcon(archive, mod.iconPath)
        if (icon) icon_url = `data:${icon.mimeType};base64,${Buffer.from(icon.data).toString("base64")}`
      } catch (error) {
        const extension = mod.iconPath.toLowerCase().split(".").pop()
        const mime = extension === "svg" ? "image/svg+xml" : extension === "bmp" ? "image/bmp" : extension === "ico" ? "image/x-icon" : undefined
        if (mime && archive.get(mod.iconPath)) {
          try { icon_url = `data:${mime};base64,${Buffer.from(await archive.read(mod.iconPath, archive.limits.maxIconSize)).toString("base64")}` } catch {}
        }
        if (!icon_url) inspection.diagnostics.push({ code: "INVALID_ICON", source: mod.iconPath, message: String(error) })
      }
    }
    const author = mod.authors.map(name => name.trim()).filter(Boolean).join(", ") || undefined
    let version = mod.version?.trim()
    if (format === "liteloader" && !raw.version && !raw.revision) version = undefined
    const trimEmpty = format !== "fabric" && format !== "quilt"
    const description = typeof mod.description === "string" ? mod.description.trim() || (trimEmpty ? undefined : "") : mod.description && typeof mod.description === "object" ? String((mod.description as { text?: unknown; translate?: unknown }).text ?? (mod.description as { translate?: unknown }).translate ?? "") || undefined : undefined
    inspection.metadata = { name: mod.name?.trim(), version: trimEmpty ? version || undefined : version, description, author, icon_url }
    return inspection
  } finally {
    if (!(input instanceof ArchiveContext)) archive.close()
  }
}

