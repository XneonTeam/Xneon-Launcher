import { app, dialog, ipcMain, shell } from "electron"
import os from "os"
import path from "path"
import fs from "fs/promises"
import { dbHelpers, isUsingFallbackStorage } from "../db"
import { getMainWindow } from "./runtime"
import { discoverAllInstances, discoverGdLauncherInstances, importLauncherInstance } from "./import"
import { execAsync, fileExists } from "./import/helpers"

const MOJANG_BASE = "https://launchercontent.mojang.com"

function resolveImageUrl(url: string | undefined): string | undefined {
  if (!url) return undefined
  if (url.startsWith("http://") || url.startsWith("https://")) return url
  return `${MOJANG_BASE}${url.startsWith("/") ? "" : "/"}${url}`
}

async function getJavaVersion(javaExe: string): Promise<string | null> {
  try {
    const { stdout } = await execAsync(`"${javaExe}" -version 2>&1`, { timeout: 4000, encoding: process.platform === "win32" ? "cp866" : undefined })
    const m = stdout.match(/version "([^"]+)"/)
    return m ? m[1] : null
  } catch {
    return null
  }
}

function makeJavaLabel(version: string): string {
  const parts = version.split(".")
  const major = parts[0] === "1" ? parseInt(parts[1]) : parseInt(parts[0])
  return `Java ${major} (${version})`
}

export function registerSystemHandlers() {
  ipcMain.handle("system:get-total-memory", () => os.totalmem())

  ipcMain.handle("fetch:minecraft-news", async () => {
    try {
      const res = await fetch(`${MOJANG_BASE}/v2/news.json`)
      const data = await res.json() as { entries?: Record<string, unknown>[] }
      const entries = data.entries ?? []
      return entries.map(e => ({
        ...e,
        playPageImage: e.playPageImage ? { ...(e.playPageImage as Record<string, unknown>), url: resolveImageUrl((e.playPageImage as { url?: string }).url) } : e.playPageImage,
        newsPageImage: e.newsPageImage ? { ...(e.newsPageImage as Record<string, unknown>), url: resolveImageUrl((e.newsPageImage as { url?: string }).url) } : e.newsPageImage,
      }))
    } catch {
      return []
    }
  })

  ipcMain.handle("db:load-accounts", async () => dbHelpers.loadAccounts())
  ipcMain.handle("db:save-account", async (_event, account) => dbHelpers.saveAccount(account))
  ipcMain.handle("db:remove-account", async (_event, id: string) => dbHelpers.removeAccount(id))
  ipcMain.handle("db:load-builds", async () => dbHelpers.loadBuilds())
  ipcMain.handle("db:save-builds", async (_event, builds) => dbHelpers.saveAllBuilds(builds))
  ipcMain.handle("db:is-fallback-storage", async () => ({ isFallback: isUsingFallbackStorage() }))
  ipcMain.handle("launcher:discover-importable-instances", async () => discoverAllInstances())
  ipcMain.handle("launcher:import-gdlauncher-instances", async (_event, ids: string[]) => {
    const selectedIds = Array.isArray(ids) ? new Set(ids) : new Set<string>()
    const sourceInstances = (await discoverGdLauncherInstances()).filter((entry) => selectedIds.has(entry.id))
    if (sourceInstances.length === 0) return { success: true, imported: 0 }

    const existingBuilds = await dbHelpers.loadBuilds()
    const existingNames = new Set(existingBuilds.map((build) => build.name.trim().toLowerCase()))

    const importedBuilds = []
    for (const entry of sourceInstances) {
      if (existingNames.has(entry.name.trim().toLowerCase())) continue
      const result = await importLauncherInstance(entry)
      if (result) importedBuilds.push(result)
    }

    if (importedBuilds.length === 0) {
      return { success: true, imported: 0 }
    }

    await dbHelpers.saveAllBuilds([...importedBuilds, ...existingBuilds])
    return { success: true, imported: importedBuilds.length }
  })
  ipcMain.handle("launcher:import-instances", async (_event, ids: string[]) => {
    const selectedIds = Array.isArray(ids) ? new Set(ids) : new Set<string>()
    const allInstances = (await discoverAllInstances()).filter((entry) => selectedIds.has(entry.id))
    if (allInstances.length === 0) return { success: true, imported: 0 }

    const existingBuilds = await dbHelpers.loadBuilds()
    const existingNames = new Set(existingBuilds.map((build) => build.name.trim().toLowerCase()))

    const importedBuilds = []
    for (const entry of allInstances) {
      if (existingNames.has(entry.name.trim().toLowerCase())) continue
      const result = await importLauncherInstance(entry)
      if (result) importedBuilds.push(result)
    }

    if (importedBuilds.length === 0) {
      return { success: true, imported: 0 }
    }

    await dbHelpers.saveAllBuilds([...importedBuilds, ...existingBuilds])
    return { success: true, imported: importedBuilds.length }
  })
  ipcMain.handle("settings:get", async (_event, key: string) => dbHelpers.getSetting(key))
  ipcMain.handle("settings:set", async (_event, key: string, value: string) => dbHelpers.setSetting(key, value))

  ipcMain.handle("shell:open-external", (_event, url: string) => shell.openExternal(url))
  ipcMain.handle("shell:open-launcher-folder", async (): Promise<void> => {
    const launcherDir = await dbHelpers.getLauncherDirectory()
    await shell.openPath(launcherDir)
  })

  ipcMain.handle("shell:open-path", async (_event, dirPath: string): Promise<void> => {
    await shell.openPath(dirPath)
  })

  ipcMain.handle("java:detect", async (): Promise<{ path: string; version: string; label: string }[]> => {
    const found: { path: string; version: string; label: string }[] = []
    const visited = new Set<string>()
    const tryJava = async (javaExe: string) => {
      const normalized = path.normalize(javaExe)
      if (visited.has(normalized)) return
      visited.add(normalized)
      if (!(await fileExists(normalized))) return
      const version = await getJavaVersion(normalized)
      if (!version) return
      found.push({ path: normalized, version, label: makeJavaLabel(version) })
    }

    if (process.platform === "win32") {
      const bases = [
        "C:\\Program Files\\Java",
        "C:\\Program Files\\Eclipse Adoptium",
        "C:\\Program Files\\Microsoft",
        "C:\\Program Files\\Zulu",
        "C:\\Program Files\\BellSoft",
        "C:\\Program Files\\Amazon Corretto",
        "C:\\Program Files\\OpenJDK",
      ]
      for (const base of bases) {
        if (!(await fileExists(base))) continue
        let dirs: string[] = []
        try { dirs = await fs.readdir(base) } catch { continue }
        for (const dir of dirs) await tryJava(path.join(base, dir, "bin", "java.exe"))
      }
      try {
        const { stdout } = await execAsync("where java 2>nul", { timeout: 3000, encoding: "cp866" })
        for (const line of stdout.split("\n")) {
          const p = line.trim()
          if (p) await tryJava(p)
        }
      } catch {}
    } else if (process.platform === "darwin") {
      const jvmBase = "/Library/Java/JavaVirtualMachines"
      if (await fileExists(jvmBase)) {
        let dirs: string[] = []
        try { dirs = await fs.readdir(jvmBase) } catch { dirs = [] }
        for (const dir of dirs) await tryJava(path.join(jvmBase, dir, "Contents", "Home", "bin", "java"))
      }
      for (const p of ["/opt/homebrew/opt/openjdk/bin/java", "/usr/local/opt/openjdk/bin/java"]) await tryJava(p)
      try {
        const { stdout } = await execAsync("/usr/libexec/java_home -V 2>&1", { timeout: 3000 })
        for (const m of stdout.matchAll(/^\s+(\/\S+)/gm)) await tryJava(path.join(m[1], "bin", "java"))
      } catch {}
    } else {
      const jvmBase = "/usr/lib/jvm"
      if (await fileExists(jvmBase)) {
        let dirs: string[] = []
        try { dirs = await fs.readdir(jvmBase) } catch { dirs = [] }
        for (const dir of dirs) await tryJava(path.join(jvmBase, dir, "bin", "java"))
      }
      for (const p of ["/usr/bin/java", "/usr/local/bin/java"]) await tryJava(p)
      try {
        const { stdout } = await execAsync("which java 2>/dev/null", { timeout: 3000 })
        if (stdout.trim()) await tryJava(stdout.trim())
      } catch {}
    }

    return found
  })

  ipcMain.handle("java:pick-file", async (): Promise<string | null> => {
    const win = getMainWindow()
    if (!win) return null
    const result = await dialog.showOpenDialog(win, {
      title: "Выбрать исполняемый файл Java",
      properties: ["openFile"],
      filters: process.platform === "win32" ? [{ name: "Java", extensions: ["exe"] }] : [{ name: "Все файлы", extensions: ["*"] }],
    })
    if (result.canceled || !result.filePaths.length) return null
    return result.filePaths[0]
  })

  ipcMain.handle("logs:share-to-mclogs", async (_event, content: string): Promise<{ success: boolean; url?: string; error?: string }> => {
    try {
      const res = await fetch("https://api.mclo.gs/1/log", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content, source: "XNeon Launcher" }),
      })
      if (!res.ok) return { success: false, error: `HTTP ${res.status}` }
      const data = await res.json() as { success: boolean; url?: string; error?: string }
      if (!data.success) return { success: false, error: data.error ?? "Ошибка mclo.gs" }
      if (data.url) await shell.openExternal(data.url)
      return { success: true, url: data.url }
    } catch (e) {
      return { success: false, error: e instanceof Error ? e.message : String(e) }
    }
  })
}
