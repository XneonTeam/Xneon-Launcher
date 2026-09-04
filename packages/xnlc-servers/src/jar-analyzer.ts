import fs from "fs"
import AdmZip from "adm-zip"
import * as toml from "toml"

export interface JarAnalysisResult {
  minecraftVersion: string | null
  loaderId: string | null
  loaderLabel: string | null
  modId: string | null
  mainClass: string | null
  error?: string
}

// Паттерн версии Minecraft:
//   старый формат: 1.20.1, 1.21, 1.7.10
//   новый формат (с 2026): 26.1, 26.1.2, 25.4-snapshot-1
//   старые снэпшоты: 24w14a
const MC_VERSION_PATTERN = /\b(?:1\.\d{1,2}(?:\.\d{1,2})?|[2-9]\d\.\d{1,2}(?:\.\d{1,2})?(?:-snapshot-\d+)?|\d{2}w\d{2}[a-z])\b/i

const MODLOADER_IDS = [
  "vanilla", "forge", "fabric", "quilt", "neoforge",
  "paper", "spigot", "bukkit", "purpur", "folia",
  "sponge", "bungeecord", "velocity", "waterfall",
]

function findMcVersionInText(text: string): string | null {
  const match = MC_VERSION_PATTERN.exec(text)
  return match ? match[0] : null
}

function normalizeLoader(label: string | null): { loaderId: string | null; loaderLabel: string | null } {
  if (!label) return { loaderId: null, loaderLabel: null }
  const l = label.toLowerCase()
  if (l.includes("neoforge")) return { loaderId: "neoforge", loaderLabel: "NeoForge" }
  if (l.includes("forge")) return { loaderId: "forge", loaderLabel: "Forge" }
  if (l.includes("fabric")) return { loaderId: "fabric", loaderLabel: "Fabric" }
  if (l.includes("quilt")) return { loaderId: "quilt", loaderLabel: "Quilt" }
  if (l.includes("purpur")) return { loaderId: "purpur", loaderLabel: "Purpur" }
  if (l.includes("folia")) return { loaderId: "folia", loaderLabel: "Folia" }
  if (l.includes("spigot")) return { loaderId: "spigot", loaderLabel: "Spigot" }
  if (l.includes("bukkit")) return { loaderId: "bukkit", loaderLabel: "Bukkit" }
  if (l.includes("paper")) return { loaderId: "paper", loaderLabel: "Paper" }
  if (l.includes("velocity")) return { loaderId: "velocity", loaderLabel: "Velocity" }
  if (l.includes("waterfall")) return { loaderId: "waterfall", loaderLabel: "Waterfall" }
  if (l.includes("bungee")) return { loaderId: "bungeecord", loaderLabel: "BungeeCord" }
  if (l.includes("sponge")) return { loaderId: "sponge", loaderLabel: "Sponge" }
  if (l.includes("vanilla") || l.includes("minecraft")) return { loaderId: "vanilla", loaderLabel: "Vanilla" }
  return { loaderId: null, loaderLabel: label }
}

export function analyzeServerJar(jarPath: string): JarAnalysisResult {
  const result: JarAnalysisResult = {
    minecraftVersion: null,
    loaderId: null,
    loaderLabel: null,
    modId: null,
    mainClass: null,
  }

  if (!jarPath || !fs.existsSync(jarPath)) {
    result.error = "Файл не найден"
    return result
  }

  let zip: any
  try {
    zip = new AdmZip(jarPath)
  } catch {
    result.error = "Не является корректным JAR/ZIP файлом"
    return result
  }

  const entries: any[] = zip.getEntries()
  const names: string[] = entries.map((e: any) => e.entryName)
  const readText = (entryName: string): string | null => {
    const entry = entries.find((e: any) => e.entryName === entryName)
    if (!entry) return null
    if (entry.header.size > 2_000_000) return null
    try {
      return entry.getData().toString("utf8")
    } catch {
      try {
        return entry.getData().toString("latin1")
      } catch {
        return null
      }
    }
  }

  // ---------- 1. MANIFEST.MF ----------
  for (const path of ["META-INF/MANIFEST.MF", "META-INF/manifest.mf"]) {
    const text = readText(path)
    if (text == null) continue
    const mainMatch = /Main-Class:\s*([^\r\n]+)/i.exec(text)
    if (mainMatch) result.mainClass = mainMatch[1].trim()

    const implTitle = /Implementation-Title:\s*([^\r\n]+)/i.exec(text)
    if (implTitle) {
      const norm = normalizeLoader(implTitle[1].trim())
      if (norm.loaderId && !result.loaderId) {
        result.loaderId = norm.loaderId
        result.loaderLabel = norm.loaderLabel
      }
    }

    for (const key of ["Minecraft-Version:", "Minecraft-Version-Id:", "Implementation-Version:"]) {
      const m = new RegExp(`${key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*([^\\r\\n]+)`, "i").exec(text)
      if (m) {
        const version = findMcVersionInText(m[1])
        if (version && !result.minecraftVersion) {
          result.minecraftVersion = version
        }
      }
    }
    break
  }

  // ---------- 2. version.json (ванильный/Paper/Purpur) ----------
  if (!result.minecraftVersion) {
    for (const path of ["version.json", "META-INF/version.json"]) {
      const text = readText(path)
      if (text == null) continue
      try {
        const data = JSON.parse(text)
        const version = data.id || data.name || data.version
        if (version) {
          result.minecraftVersion = String(version)
        }
      } catch {}
      if (result.minecraftVersion) break
    }
  }

  // ---------- 3. fabric.mod.json ----------
  for (const name of names) {
    if (name.endsWith("fabric.mod.json")) {
      if (!result.loaderId) {
        result.loaderId = "fabric"
        result.loaderLabel = "Fabric"
      }
      const text = readText(name)
      if (text != null) {
        try {
          const data = JSON.parse(text)
          result.modId = data.id ?? null
          if (!result.minecraftVersion && data.depends?.minecraft) {
            const version = findMcVersionInText(String(data.depends.minecraft))
            if (version) result.minecraftVersion = version
          }
        } catch {}
      }
      break
    }
  }

  // ---------- 4. Forge/NeoForge mods.toml ----------
  for (const name of names) {
    if (name.endsWith("mods.toml")) {
      if (!result.loaderId) {
        result.loaderId = "forge"
        result.loaderLabel = "Forge"
      }
      const text = readText(name)
      if (text != null) {
        try {
          const data = toml.parse(text)
          const mods = Array.isArray(data.mods) ? data.mods : []
          if (mods[0]?.modId) result.modId = mods[0].modId
          if (!result.minecraftVersion) {
            const raw = data.minecraft_version ?? data.minecraft ?? ""
            const version = findMcVersionInText(String(raw))
            if (version) result.minecraftVersion = version
          }
        } catch {
          // fallback: regex
          const m = /(?:minecraft_version|minecraft)\s*=\s*["']?([^"'\r\n]+)/i.exec(text)
          if (m) {
            const version = findMcVersionInText(m[1])
            if (version && !result.minecraftVersion) result.minecraftVersion = version
          }
        }
      }
      break
    }
  }

  // ---------- 5. installer.json (Arclight и подобные) ----------
  const installerText = readText("META-INF/installer.json")
  if (installerText != null) {
    try {
      const data = JSON.parse(installerText)
      const installer = data.installer ?? {}
      if (installer.minecraft && !result.minecraftVersion) {
        result.minecraftVersion = String(installer.minecraft)
      }
      if (installer.neoforge && result.loaderId !== "neoforge") {
        result.loaderId = result.loaderId ? `${result.loaderId} + NeoForge` : "neoforge"
        result.loaderLabel = result.loaderLabel ? `${result.loaderLabel} + NeoForge` : "NeoForge"
      }
      if (installer.forge && !result.loaderId) {
        result.loaderId = "forge"
        result.loaderLabel = "Forge"
      }
      if (installer.fabricLoader && !/fabric/i.test(result.loaderId ?? "")) {
        result.loaderId = result.loaderId ? `${result.loaderId} + Fabric` : "fabric"
        result.loaderLabel = result.loaderLabel ? `${result.loaderLabel} + Fabric` : "Fabric"
      }
    } catch {}
  }

  // ---------- 6. Определение лоадера по структуре, если ещё не найден ----------
  if (!result.loaderId) {
    if (names.some((p: string) => p.startsWith("org/bukkit/") || p.startsWith("org/spigotmc/"))) {
      result.loaderId = "paper"
      result.loaderLabel = "Bukkit/Spigot/Paper-совместимый"
    } else if (names.some((p: string) => p.startsWith("net/minecraftforge/"))) {
      result.loaderId = "forge"
      result.loaderLabel = "Forge"
    } else if (names.some((p: string) => p.startsWith("net/fabricmc/"))) {
      result.loaderId = "fabric"
      result.loaderLabel = "Fabric"
    }
  }

  // ---------- 7. Fallback: полный скан текстовых метаданных ----------
  if (!result.minecraftVersion) {
    const metaExt = [".json", ".toml", ".properties", ".mf", ".txt", ".cfg"]
    const found: string[] = []
    for (const name of names) {
      const lower = name.toLowerCase()
      if (!metaExt.some(ext => lower.endsWith(ext))) continue
      const text = readText(name)
      if (!text) continue
      const matches = text.match(new RegExp(MC_VERSION_PATTERN.source, "gi")) || []
      for (const v of matches) {
        if (!found.includes(v)) found.push(v)
      }
    }
    if (found.length > 0) {
      result.minecraftVersion = found[0]
    }
  }

  // Очистка loaderId: если он содержит "+", это гибрид — для запуска берём базовый id
  if (result.loaderId && result.loaderId.includes("+")) {
    const base = result.loaderId.split("+")[0].trim().toLowerCase()
    if (MODLOADER_IDS.includes(base)) {
      result.loaderId = base
    } else {
      result.loaderId = null
    }
  }

  return result
}
