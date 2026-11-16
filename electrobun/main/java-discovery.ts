import path from "node:path"
import fs from "node:fs/promises"
import fsSync from "node:fs"
import { execFileAsync, fileExists } from "./import/helpers"
import { findExecutablesInPath } from "../platform/executable-path"
import { readJavaHomesFromRegistry } from "../platform/java-registry"

type Execute = typeof execFileAsync
export type JavaInfo = { version: string; fullVersion?: string; vendor?: string; arch?: string }
export type JavaDetectEntry = JavaInfo & { path: string; label: string }

export async function getJavaVersion(javaExe: string, execute: Execute = execFileAsync): Promise<string | null> {
  try {
    const { stdout, stderr } = await execute(javaExe, ["-version"], { timeout: 4000 })
    return (stderr + "\n" + stdout).match(/version "([^"]+)"/)?.[1] ?? null
  } catch { return null }
}

export async function getJavaInstallationInfo(javaExe: string, execute: Execute = execFileAsync): Promise<JavaInfo | null> {
  try {
    const { stdout, stderr } = await execute(javaExe, ["-XshowSettings:properties", "-version"], { timeout: 6000 })
    const props: Record<string, string> = {}
    for (const line of (stderr + "\n" + stdout).split("\n")) {
      const index = line.indexOf("=")
      if (index === -1) continue
      const key = line.slice(0, index).trim(), value = line.slice(index + 1).trim()
      if (key && value) props[key] = value
    }
    const version = props["java.version"]
    if (version) return { version, fullVersion: props["java.runtime.version"] || props["java.fullversion"] || version,
      vendor: props["java.vendor"] || props["java.vm.vendor"], arch: props["sun.arch.data.model"] || undefined }
  } catch { /* Старые JVM могут не поддерживать -XshowSettings. */ }
  const version = await getJavaVersion(javaExe, execute)
  return version ? { version } : null
}

const WINDOWS_JAVA_BASES = ["C:\\Program Files\\Java", "C:\\Program Files\\Eclipse Adoptium", "C:\\Program Files\\Microsoft", "C:\\Program Files\\Zulu", "C:\\Program Files\\BellSoft", "C:\\Program Files\\Amazon Corretto", "C:\\Program Files\\OpenJDK"]
const JAVA_DETECT_TTL_MS = 5 * 60_000
let cache: { at: number; value: JavaDetectEntry[] } | null = null
let inFlight: Promise<JavaDetectEntry[]> | null = null

async function scanJavaInstallations(): Promise<JavaDetectEntry[]> {
  const found: JavaDetectEntry[] = [], visited = new Set<string>()
  const tryJava = async (executable: string) => {
    const normalized = path.normalize(executable)
    if (visited.has(normalized)) return
    visited.add(normalized)
    if (!await fileExists(normalized)) return
    const info = await getJavaInstallationInfo(normalized)
    if (!info) return
    const parts = info.version.split(".")
    const major = parts[0] === "1" ? parseInt(parts[1]) : parseInt(parts[0])
    const label = [`Java ${major} (${info.version})`, ...(info.arch ? [`${info.arch}-бит`] : []), ...(info.vendor ? [info.vendor] : [])].join(" · ")
    found.push({ path: normalized, ...info, label })
  }
  const scanDirectory = async (base: string, suffix: string[]) => {
    if (!await fileExists(base)) return
    let directories: string[]
    try { directories = await fs.readdir(base) } catch { return }
    for (const directory of directories) await tryJava(path.join(base, directory, ...suffix))
  }
  if (process.platform === "win32") {
    for (const home of await readJavaHomesFromRegistry()) {
      await tryJava(path.join(home, "bin", "java.exe"))
      await tryJava(path.join(home, "bin", "javaw.exe"))
    }
    for (const base of WINDOWS_JAVA_BASES) await scanDirectory(base, ["bin", "java.exe"])
    for (const executable of findExecutablesInPath("java")) await tryJava(executable)
  } else if (process.platform === "darwin") {
    await scanDirectory("/Library/Java/JavaVirtualMachines", ["Contents", "Home", "bin", "java"])
    for (const executable of ["/opt/homebrew/opt/openjdk/bin/java", "/usr/local/opt/openjdk/bin/java"]) await tryJava(executable)
    try {
      const { stdout, stderr } = await execFileAsync("/usr/libexec/java_home", ["-V"], { timeout: 3000 })
      for (const line of (stderr + "\n" + stdout).split("\n")) {
        const home = line.match(/(?:^|\s)(\/.*)$/)?.[1]?.trim()
        if (home) await tryJava(path.join(home, "bin", "java"))
      }
    } catch { /* Недоступный java_home не отменяет остальные источники. */ }
  } else {
    await scanDirectory("/usr/lib/jvm", ["bin", "java"])
    for (const executable of ["/usr/bin/java", "/usr/local/bin/java"]) await tryJava(executable)
    const onPath = Bun.which("java")
    if (onPath) await tryJava(onPath)
  }
  return found
}

export async function detectJavaInstallations(force = false): Promise<JavaDetectEntry[]> {
  if (!force && cache && Date.now() - cache.at < JAVA_DETECT_TTL_MS) return cache.value
  if (inFlight) return inFlight
  const tracked = scanJavaInstallations().then(value => { cache = { at: Date.now(), value }; return value }).finally(() => {
    if (inFlight === tracked) inFlight = null
  })
  inFlight = tracked
  return tracked
}

export function findJavaBinarySync(): string | null {
  const javaExe = process.platform === "win32" ? "java.exe" : "java"
  const home = process.env.JAVA_HOME
  if (home && fsSync.existsSync(path.join(home, "bin", javaExe))) return path.join(home, "bin", javaExe)
  if (process.platform === "win32") {
    for (const base of WINDOWS_JAVA_BASES) {
      if (!fsSync.existsSync(base)) continue
      try {
        for (const directory of fsSync.readdirSync(base)) {
          const candidate = path.join(base, directory, "bin", javaExe)
          if (fsSync.existsSync(candidate)) return candidate
        }
      } catch { /* Следующий поставщик Java. */ }
    }
  } else if (process.platform === "darwin") {
    for (const candidate of ["/Library/Java/JavaVirtualMachines", "/opt/homebrew/opt/openjdk/bin/java", "/usr/local/opt/openjdk/bin/java"]) {
      if (candidate.endsWith("java")) { if (fsSync.existsSync(candidate)) return candidate }
      else if (fsSync.existsSync(candidate)) {
        try {
          for (const directory of fsSync.readdirSync(candidate)) {
            const binary = path.join(candidate, directory, "Contents", "Home", "bin", "java")
            if (fsSync.existsSync(binary)) return binary
          }
        } catch { /* Следующий каталог JVM. */ }
      }
    }
  } else {
    for (const base of ["/usr/lib/jvm", "/usr/local/sdkman/candidates/java/current"]) {
      if (!fsSync.existsSync(base)) continue
      try {
        for (const directory of fsSync.readdirSync(base)) {
          const candidate = path.join(base, directory, "bin", "java")
          if (fsSync.existsSync(candidate)) return candidate
        }
      } catch { /* Следующий каталог JVM. */ }
    }
  }
  return Bun.which(javaExe)
}
