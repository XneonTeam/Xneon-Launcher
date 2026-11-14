import { ArchiveContext, ParserError, type ArchiveOptions } from "./archive.js"

export type PackFormat = "resourcepack" | "datapack" | "hybridpack" | "unknownpack"
export type Format = "fabric" | "quilt" | "forge" | "neoforge" | "liteloader" | PackFormat | "shaderpack" | "bukkit" | "paper" | "bungee" | "velocity"
export function classifyPack(assets: boolean, data: boolean): PackFormat {
  return assets ? data ? "hybridpack" : "resourcepack" : data ? "datapack" : "unknownpack"
}
export interface ModDependency { id?: string; versions?: unknown; kind: string; optional?: boolean; side?: string; ordering?: string; loader: Format; raw: unknown; source: string; interpretation: "declared" | "unknown" }
export interface ModMetadata { loader: Format; id?: string; name?: string; main?: string; version?: string; description?: unknown; authors: string[]; license?: unknown; contact?: unknown; environment?: unknown; loaderVersion?: string; /** Объявленные строки или диапазоны, а не вычисленный список совместимых версий. */ minecraftVersions?: string[]; iconPath?: string; raw: unknown; dependencies: ModDependency[] }
export interface ParserDiagnostic { code: string; source?: string; message: string }
export interface EmbeddedJar { path: string; declared: boolean; present: boolean; result?: ParserResult; matches?: { dependencyId: string; embeddedVersion?: string; versionCheck: "exact" | "unknown" }[] }
export interface ParserResult { formats: Format[]; mods: ModMetadata[]; dependencies: ModDependency[]; diagnostics: ParserDiagnostic[]; embeddedJars: EmbeddedJar[]; completeness: { metadata: boolean; dependencies: boolean; embeddedJars: boolean; classes: false } }
type RecordValue = Record<string, unknown>
const object = (x: unknown): RecordValue => x && typeof x === "object" && !Array.isArray(x) ? x as RecordValue : {}
const str = (x: unknown): string | undefined => typeof x === "string" && x.length ? x : undefined
export function checkMetadataShape(value: unknown): unknown {
  const pending: { value: unknown; depth: number }[] = [{ value, depth: 0 }]
  const visited = new WeakSet<object>()
  let nodes = 1
  while (pending.length) {
    const item = pending.pop()!
    if (item.depth > 64 || typeof item.value === "string" && item.value.length > 262144) throw new ParserError("LIMIT_EXCEEDED", "Metadata structure limit exceeded")
    if (!item.value || typeof item.value !== "object") continue
    if (visited.has(item.value)) throw new ParserError("LIMIT_EXCEEDED", "Repeated metadata object")
    visited.add(item.value)
    for (const key in item.value) {
      if (!Object.hasOwn(item.value, key)) continue
      if (++nodes > 50000 || key.length > 1024) throw new ParserError("LIMIT_EXCEEDED", "Metadata structure limit exceeded")
      pending.push({ value: (item.value as RecordValue)[key], depth: item.depth + 1 })
    }
  }
  return value
}
const authors = (x: unknown): string[] => (Array.isArray(x) ? x : typeof x === "string" ? [x] : []).map(v => typeof v === "string" ? v : str(object(v).name)).filter((v): v is string => !!v)
function minecraftVersions(dependencies: ModDependency[]): string[] | undefined {
  const ranges = dependencies.filter(dep => dep.id === "minecraft" && dep.kind === "depends" && dep.optional === false && dep.interpretation === "declared").flatMap(dep => typeof dep.versions === "string" ? [dep.versions] : Array.isArray(dep.versions) ? dep.versions.filter((value): value is string => typeof value === "string") : [])
  return ranges.length ? ranges : undefined
}
function iconPath(x: unknown): string | undefined {
  if (typeof x === "string") return x
  return Object.entries(object(x)).filter(([k, v]) => Number.isFinite(Number(k)) && typeof v === "string").sort((a, b) => Number(b[0]) - Number(a[0])).map(([, v]) => v as string)[0]
}
const sentinels: [string, Format][] = [["META-INF/mods.toml", "forge"], ["META-INF/neoforge.mods.toml", "neoforge"], ["mcmod.info", "forge"], ["cccmod.info", "forge"], ["neimod.info", "forge"], ["fabric.mod.json", "fabric"], ["quilt.mod.json", "quilt"], ["litemod.json", "liteloader"], ["pack.mcmeta", "resourcepack"], ["plugin.yml", "bukkit"], ["paper-plugin.yml", "paper"], ["bungee.yml", "bungee"], ["velocity-plugin.json", "velocity"]]
export function identify(archive: ArchiveContext): Format[] {
  const formats = new Set<Format>()
  for (const [path, format] of sentinels) if (archive.get(path)) formats.add(format)
  const entries = archive.entries()
  if (formats.delete("resourcepack")) formats.add(classifyPack(entries.some(e => e.name.startsWith("assets/")), entries.some(e => e.name.startsWith("data/"))))
  if (entries.some(e => e.name.startsWith("shaders/") || e.name === "optionsshaders.txt")) formats.add("shaderpack")
  return [...formats]
}
function jsonDependencies(root: RecordValue, loader: "fabric" | "quilt", source: string): ModDependency[] {
  const out: ModDependency[] = []
  for (const kind of ["depends", "recommends", "suggests", "conflicts", "breaks"]) {
    const value = root[kind]
    if (loader === "fabric") {
      for (const [id, versions] of Object.entries(object(value))) out.push({ id, versions, kind, optional: kind !== "depends", loader, raw: versions, source, interpretation: "declared" })
    } else if (value !== undefined) {
      const items = Array.isArray(value) ? value : [value]
      for (const raw of items) {
        const data = object(raw)
        out.push({ id: typeof raw === "string" ? raw : str(data.id), versions: data.versions, kind, optional: data.optional === true || kind !== "depends", side: str(data.environment), loader, raw, source, interpretation: Array.isArray(raw) || data.unless !== undefined || (!str(data.id) && typeof raw !== "string") ? "unknown" : "declared" })
      }
    }
  }
  return out
}
export async function analyze(input: string | Uint8Array, options: ArchiveOptions = {}): Promise<ParserResult> {
  const archive = await ArchiveContext.open(input, options)
  try { return await analyzeOpen(archive, options) } finally { archive.close() }
}
export async function analyzeOpen(archive: ArchiveContext, options: ArchiveOptions = {}): Promise<ParserResult> {
  return analyzeArchive(archive, options, { count: 0, bytes: 0 }, 0, new Set())
}
async function analyzeArchive(archive: ArchiveContext, options: ArchiveOptions, budget: { count: number; bytes: number }, depth: number, ancestors: Set<string>): Promise<ParserResult> {
  const check = () => { if (options.signal?.aborted) throw new ParserError("ABORTED", "Operation aborted") }
  check()
  const formats = identify(archive), mods: ModMetadata[] = [], diagnostics: ParserDiagnostic[] = []
  const invalidDependency = (source: string, field: string) => diagnostics.push({ code: "INVALID_DEPENDENCY", source, message: `Invalid dependency field: ${field}` })
  const validVersion = (value: unknown): boolean => typeof value === "string" && !!value.trim()
  const validateJsonDependencies = (root: RecordValue, loader: "fabric" | "quilt", source: string) => {
    for (const key of ["depends", "recommends", "suggests", "conflicts", "breaks"]) {
      if (!Object.hasOwn(root, key)) continue
      const value = root[key]
      if (loader === "fabric") {
        if (!value || typeof value !== "object" || Array.isArray(value) || Object.entries(object(value)).some(([id, range]) => !id.trim() || !(validVersion(range) || Array.isArray(range) && range.length > 0 && range.every(validVersion)))) invalidDependency(source, key)
      } else {
        const validQuiltVersions = (input: unknown): boolean => {
          const stack = [input]
          while (stack.length) {
            const range = stack.pop()
            if (validVersion(range)) continue
            const keys = Object.keys(object(range))
            const terms = Array.isArray(range) ? range : keys.length === 1 && (keys[0] === "all" || keys[0] === "any") ? object(range)[keys[0]] : undefined
            if (!Array.isArray(terms) || !terms.length) return false
            for (const term of terms) stack.push(term)
          }
          return true
        }
        const rows = Array.isArray(value) ? value : [value]
        const stack = [...rows]
        while (stack.length) {
          const row = stack.pop()
          if (validVersion(row)) continue
          if (Array.isArray(row) && row.length) { for (const alternative of row) stack.push(alternative); continue }
          const dep = object(row)
          if (!validVersion(dep.id) || Object.hasOwn(dep, "optional") && typeof dep.optional !== "boolean" ||
            Object.hasOwn(dep, "environment") && !validVersion(dep.environment) ||
            Object.hasOwn(dep, "versions") && !validQuiltVersions(dep.versions)) {
            invalidDependency(source, key); break
          }
        }
      }
    }
  }
  if (!formats.length) diagnostics.push({ code: "METADATA_NOT_FOUND", message: "No recognized metadata or content markers" })
  async function read(path: string, kind: "json" | "toml" | "yaml"): Promise<unknown> {
    if (!archive.get(path)) return undefined
    try {
      const text = new TextDecoder("utf-8", { fatal: true }).decode(await archive.read(path, archive.limits.maxMetadataSize, options.signal)).replace(/^\uFEFF/, "")
      if (kind === "yaml") {
        // До проверки лимитов YAML-парсера не принимаем aliases и anchors.
        if (/(?:^|[\s\[\{,:])[&*][A-Za-z0-9_-]+/m.test(text)) throw new Error("YAML anchors and aliases are unsupported")
        return checkMetadataShape(Bun.YAML.parse(text))
      }
      if (kind === "json") {
        let value: unknown
        try { value = JSON.parse(text) } catch (error) {
          // XMCL принимает встречающиеся у Fabric/Quilt переносы строк внутри JSON-строк.
          // Нормализация используется только после ошибки обычного JSON-разбора.
          if (path !== "fabric.mod.json" && path !== "quilt.mod.json") throw error
          value = JSON.parse(text.replace(/\n/g, ""))
        }
        const legacy = ["mcmod.info", "cccmod.info", "neimod.info"].includes(path)
        if (!value || typeof value !== "object" || (!legacy && Array.isArray(value))) throw new Error("Metadata root must be an object")
        return checkMetadataShape(value)
      }
      return checkMetadataShape(Bun.TOML.parse(text))
    } catch (e) {
      if (e instanceof ParserError && (e.code === "ABORTED" || e.code === "CLOSED")) throw e
      diagnostics.push({ code: e instanceof ParserError ? e.code : "INVALID_METADATA", source: path, message: e instanceof Error ? e.message : "Invalid metadata" })
      return undefined
    }
  }
  const fabric = await read("fabric.mod.json", "json")
  if (fabric !== undefined) {
    const m = object(fabric), deps = jsonDependencies(m, "fabric", "fabric.mod.json")
    validateJsonDependencies(m, "fabric", "fabric.mod.json")
    mods.push({ loader: "fabric", id: str(m.id), name: str(m.name), version: str(m.version), description: m.description, authors: authors(m.authors), license: m.license, contact: m.contact, environment: m.environment, minecraftVersions: minecraftVersions(deps), iconPath: iconPath(m.icon), raw: fabric, dependencies: deps })
  }
  const quilt = await read("quilt.mod.json", "json")
  if (quilt !== undefined) {
    const q = object(quilt), l = object(q.quilt_loader), meta = object(l.metadata), deps = jsonDependencies(l, "quilt", "quilt.mod.json")
    validateJsonDependencies(l, "quilt", "quilt.mod.json")
    mods.push({ loader: "quilt", id: str(l.id), name: str(meta.name), version: str(l.version), description: meta.description, authors: authors(q.authors).length ? authors(q.authors) : Object.keys(object(meta.contributors)), license: meta.license, contact: meta.contact, environment: l.environment, minecraftVersions: minecraftVersions(deps), iconPath: iconPath(meta.icon), raw: quilt, dependencies: deps })
  }
  let manifestVersion: string | undefined
  if (archive.get("META-INF/MANIFEST.MF") && (archive.get("META-INF/mods.toml") || archive.get("META-INF/neoforge.mods.toml"))) {
    try {
      const raw = new TextDecoder("utf-8", { fatal: true }).decode(await archive.read("META-INF/MANIFEST.MF", archive.limits.maxMetadataSize, options.signal))
      const main = raw.split(/\r?\n\r?\n/, 1)[0].replace(/\r?\n /g, "")
      manifestVersion = main.match(/^Implementation-Version:[ \t]*([^\r\n]+)$/im)?.[1]?.trim() || undefined
    } catch (e) {
      if (e instanceof ParserError && (e.code === "ABORTED" || e.code === "CLOSED")) throw e
      diagnostics.push({ code: e instanceof ParserError ? e.code : "INVALID_METADATA", source: "META-INF/MANIFEST.MF", message: e instanceof Error ? e.message : "Invalid manifest" })
    }
  }
  for (const [path, loader] of [["META-INF/mods.toml", "forge"], ["META-INF/neoforge.mods.toml", "neoforge"]] as const) {
    const raw = await read(path, "toml")
    if (raw === undefined) continue
    const root = object(raw), byMod = object(root.dependencies)
    if (Object.hasOwn(root, "dependencies") && (!root.dependencies || typeof root.dependencies !== "object" || Array.isArray(root.dependencies) || Object.values(byMod).some(value => !Array.isArray(value)))) invalidDependency(path, "dependencies")
    for (const item of Array.isArray(root.mods) ? root.mods : []) {
      const m = object(item), id = str(m.modId), rows = id && Array.isArray(byMod[id]) ? byMod[id] as unknown[] : []
      const dependencies = rows.map(row => {
        const d = object(row), type = str(d.type)
        if (!validVersion(d.modId) || Object.hasOwn(d, "mandatory") && typeof d.mandatory !== "boolean" || ["type", "side", "ordering", "versionRange"].some(key => Object.hasOwn(d, key) && !validVersion(d[key]))) invalidDependency(path, "dependencies")
        const known = type === undefined || ["required", "optional", "incompatible", "discouraged"].includes(type)
        return { id: str(d.modId), versions: d.versionRange, kind: type === "incompatible" ? "breaks" : type === "discouraged" ? "discouraged" : "depends", optional: !known ? undefined : type ? type !== "required" : d.mandatory === false, side: str(d.side), ordering: str(d.ordering), loader, raw: row, source: path, interpretation: known && str(d.modId) ? "declared" as const : "unknown" as const }
      })
      const declaredVersion = str(m.version)
      mods.push({ loader, id, name: str(m.displayName), version: declaredVersion === "${file.jarVersion}" ? manifestVersion ?? declaredVersion : declaredVersion, description: m.description, authors: authors(m.authors ?? root.authors), license: root.license, contact: { homepage: m.displayURL ?? root.displayURL }, environment: m.clientSideOnly === true || root.clientSideOnly === true ? "client" : undefined, loaderVersion: str(root.loaderVersion), minecraftVersions: minecraftVersions(dependencies), iconPath: str(m.logoFile), raw: { root, mod: m }, dependencies })
    }
  }
  const legacyPath = ["mcmod.info", "cccmod.info", "neimod.info"].find(path => archive.get(path))
  const legacy = legacyPath ? await read(legacyPath, "json") : undefined
  if (legacy !== undefined) {
    const root = object(legacy), items = Array.isArray(legacy) ? legacy : Array.isArray(root.modlist) ? root.modlist : Array.isArray(root.modList) ? root.modList : root.modid ? [root] : []
    for (const value of items) { const m = object(value); mods.push({ loader: "forge", id: str(m.modid), name: str(m.name), version: str(m.version), description: m.description, authors: authors(m.authorList ?? m.authors), minecraftVersions: str(m.mcversion) ? [str(m.mcversion)!] : undefined, iconPath: str(m.logoFile), raw: value, dependencies: [] }) }
  }
  const lite = await read("litemod.json", "json")
  if (lite !== undefined) { const m = object(lite); mods.push({ loader: "liteloader", id: str(m.id), name: str(m.name), version: str(m.version) ?? (m.revision != null ? String(m.revision) : undefined), description: m.description, authors: authors(m.author), minecraftVersions: str(m.mcversion) ? [str(m.mcversion)!] : undefined, raw: lite, dependencies: [] }) }
  const velocity = await read("velocity-plugin.json", "json")
  if (velocity !== undefined) {
    const m = object(velocity)
    if (Object.hasOwn(m, "dependencies") && (!Array.isArray(m.dependencies) || m.dependencies.some(row => !validVersion(object(row).id) || Object.hasOwn(object(row), "optional") && typeof object(row).optional !== "boolean" || Object.hasOwn(object(row), "version") && !validVersion(object(row).version)))) invalidDependency("velocity-plugin.json", "dependencies")
    const dependencies: ModDependency[] = (Array.isArray(m.dependencies) ? m.dependencies : []).map(raw => {
      const dep = object(raw)
      return { id: str(dep.id), versions: dep.version, kind: "depends", optional: dep.optional === true, loader: "velocity", raw, source: "velocity-plugin.json", interpretation: str(dep.id) ? "declared" : "unknown" }
    })
    mods.push({ loader: "velocity", id: str(m.id), name: str(m.name), version: str(m.version), description: m.description, authors: authors(m.authors), contact: m.url ? { homepage: m.url } : undefined, environment: "server", raw: velocity, dependencies })
  }
  for (const [path, loader] of [["plugin.yml", "bukkit"], ["paper-plugin.yml", "paper"], ["bungee.yml", "bungee"]] as const) {
    const raw = await read(path, "yaml")
    if (raw === undefined) continue
    const m = object(raw), dependencies: ModDependency[] = []
    const fields = loader === "bungee" ? [["depends", "depends", false], ["softDepends", "depends", true]] as const : [["depend", "depends", false], ["softdepend", "depends", true], ["loadbefore", "loadBefore", true]] as const
    for (const [key, kind, optional] of fields) {
      if (Object.hasOwn(m, key) && (!Array.isArray(m[key]) || !m[key].every(validVersion))) invalidDependency(path, key)
      for (const item of Array.isArray(m[key]) ? m[key] : []) {
        dependencies.push({ id: str(item), kind, optional, loader, raw: item, source: path, interpretation: str(item) ? "declared" : "unknown" })
      }
    }
    if (loader === "paper" && Object.hasOwn(m, "dependencies") && (!m.dependencies || typeof m.dependencies !== "object" || Array.isArray(m.dependencies))) invalidDependency(path, "dependencies")
    if (loader === "paper") for (const [section, values] of Object.entries(object(m.dependencies))) {
      if (!values || typeof values !== "object" || Array.isArray(values)) invalidDependency(path, `dependencies.${section}`)
      for (const [id, value] of Object.entries(object(values))) {
        const dep = object(value)
        if (!id.trim() || !value || typeof value !== "object" || Array.isArray(value) ||
          ["required", "join-classpath"].some(key => Object.hasOwn(dep, key) && typeof dep[key] !== "boolean") ||
          Object.hasOwn(dep, "load") && !validVersion(dep.load)) invalidDependency(path, `dependencies.${section}`)
        dependencies.push({ id, kind: "depends", optional: dep.required === false, ordering: str(dep.load), side: section, loader, raw: value, source: path, interpretation: "declared" })
      }
    }
    mods.push({ loader, name: str(m.name), main: str(m.main), version: str(m.version), description: m.description, authors: authors(m.authors ?? m.author), contact: m.website ? { homepage: m.website } : undefined, environment: "server", raw, dependencies })
  }
  const pack = await read("pack.mcmeta", "json")
  if (pack !== undefined) {
    const p = object(object(pack).pack)
    const loader = formats.find(f => f === "resourcepack" || f === "datapack" || f === "hybridpack" || f === "unknownpack") ?? "unknownpack"
    mods.push({ loader, description: p.description, version: typeof p.pack_format === "number" && Number.isSafeInteger(p.pack_format) ? String(p.pack_format) : undefined, authors: [], iconPath: archive.get("pack.png") ? "pack.png" : undefined, raw: pack, dependencies: [] })
  }
  const candidates = new Map<string, boolean>()
  if (formats.includes("shaderpack")) {
    mods.push({ loader: "shaderpack", authors: [], iconPath: archive.get("shaders/shaders.png") ? "shaders/shaders.png" : undefined, raw: null, dependencies: [] })
  }
  function addDeclared(value: unknown) {
    for (const item of Array.isArray(value) ? value : []) {
      const path = typeof item === "string" ? item : str(object(item).file)
      if (path) candidates.set(path, true)
    }
  }
  addDeclared(object(fabric).jars)
  addDeclared(object(object(quilt).quilt_loader).jars)
  for (const entry of archive.entries()) if (/^META-INF\/(?:jars|jarjar)\/.+\.jar$/i.test(entry.name) && !candidates.has(entry.name)) candidates.set(entry.name, false)
  const embeddedJars: EmbeddedJar[] = []
  for (const [path, declared] of candidates) {
    const entry = archive.get(path)
    const embedded: EmbeddedJar = { path, declared, present: !!entry }
    embeddedJars.push(embedded)
    if (!entry || !options.nested) continue
    if (depth >= archive.limits.maxNestedDepth || budget.count >= archive.limits.maxNestedArchives || entry.size > archive.limits.maxNestedArchiveSize || budget.bytes + entry.size > archive.limits.maxNestedTotalSize) {
      diagnostics.push({ code: "NESTED_LIMIT_EXCEEDED", source: path, message: "Nested archive limit exceeded" })
      continue
    }
    budget.count++; budget.bytes += entry.size
    try {
      const bytes = await archive.read(path, archive.limits.maxNestedArchiveSize, options.signal)
      const digest = new Bun.CryptoHasher("sha256").update(bytes).digest("hex")
      if (ancestors.has(digest)) { diagnostics.push({ code: "NESTED_CYCLE", source: path, message: "Repeated archive in ancestor chain" }); continue }
      const child = await archive.openNested(bytes, options)
      try { embedded.result = await analyzeArchive(child, options, budget, depth + 1, new Set([...ancestors, digest])) } finally { child.close() }
      const matches: NonNullable<EmbeddedJar["matches"]> = []
      for (const dependency of mods.flatMap(mod => mod.dependencies)) {
        if (!dependency.id) continue
        for (const mod of embedded.result.mods) {
          if (dependency.id !== mod.id) continue
          matches.push({ dependencyId: dependency.id, embeddedVersion: mod.version, versionCheck: mod.version && dependency.versions === mod.version ? "exact" : "unknown" })
        }
      }
      if (matches.length) embedded.matches = matches
    } catch (e) {
      if (e instanceof ParserError && (e.code === "ABORTED" || e.code === "CLOSED")) throw e
      diagnostics.push({ code: e instanceof ParserError ? e.code : "INVALID_ARCHIVE", source: path, message: e instanceof Error ? e.message : "Invalid nested archive" })
    }
  }
  const invalidSources = new Set(diagnostics.filter(item => item.code === "INVALID_DEPENDENCY").map(item => item.source))
  const dependencies = mods.flatMap(m => m.dependencies)
  for (const dependency of dependencies) if (invalidSources.has(dependency.source)) dependency.interpretation = "unknown"
  const metadataErrors = diagnostics.some(item => item.code !== "INVALID_DEPENDENCY" && !item.code.startsWith("NESTED_") && !candidates.has(item.source ?? ""))
  const legacyForge = legacy !== undefined
  const hasRequiredMetadata = (mod: ModMetadata): boolean => {
    if (["fabric", "quilt", "forge", "neoforge", "velocity"].includes(mod.loader)) return !!mod.id && !!mod.version && mod.version !== "${file.jarVersion}"
    if (["bukkit", "paper", "bungee", "liteloader"].includes(mod.loader)) return !!mod.name && !!mod.version
    return (mod.loader === "resourcepack" || mod.loader === "datapack" || mod.loader === "hybridpack") && !!mod.version
  }
  const metadataComplete = mods.length > 0 && !metadataErrors && !legacyForge && mods.every(hasRequiredMetadata) && formats.every(format => format !== "shaderpack" && mods.some(mod => mod.loader === format))
  const dependencyComplete = metadataComplete && !diagnostics.some(item => item.code === "INVALID_DEPENDENCY") && !formats.includes("liteloader") && dependencies.every(dep => dep.interpretation === "declared")
  const nestedComplete = embeddedJars.every(item => item.present && (!options.nested ? false : !!item.result?.completeness.embeddedJars))
  check()
  return { formats, mods, dependencies, diagnostics, embeddedJars, completeness: { metadata: metadataComplete, dependencies: dependencyComplete, embeddedJars: nestedComplete, classes: false } }
}
export async function analyzeBatch(inputs: (string | Uint8Array)[], options: ArchiveOptions & { concurrency?: number } = {}): Promise<PromiseSettledResult<ParserResult>[]> {
  const concurrency = options.concurrency ?? 4
  if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 64) throw new RangeError("Invalid concurrency")
  const results: PromiseSettledResult<ParserResult>[] = new Array(inputs.length)
  let cursor = 0
  await Promise.all(Array.from({ length: Math.min(concurrency, inputs.length) }, async () => {
    while (true) { const i = cursor++; if (i >= inputs.length) break; try { results[i] = { status: "fulfilled", value: await analyze(inputs[i], options) } } catch (reason) { results[i] = { status: "rejected", reason } } }
  }))
  return results
}
