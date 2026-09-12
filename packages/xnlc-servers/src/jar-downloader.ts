import path from "path"
import fs from "fs"
import https from "https"
import http from "http"
import { execFile } from "child_process"
import { promisify } from "util"

const execFileAsync = promisify(execFile)

export interface DownloadProgress {
  phase: "resolving" | "downloading" | "extracting" | "done" | "error"
  percent?: number
  bytesTotal?: number
  bytesDownloaded?: number
  message: string
}

type OnProgress = (progress: DownloadProgress) => void

// ── HTTP helpers ─────────────────────────────────────

const MAX_RETRIES = 3
const RETRY_DELAY_MS = 1500

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function fetchJsonOnce(url: string): Promise<any> {
  return new Promise((resolve, reject) => {
    const client = url.startsWith("https") ? https : http
    client.get(url, { headers: { "User-Agent": "XneonLauncher/1.0" } }, (res) => {
      if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return fetchJsonOnce(res.headers.location).then(resolve, reject)
      }
      if (res.statusCode !== 200) {
        reject(new Error(`HTTP ${res.statusCode} for ${url}`))
        return
      }
      let data = ""
      res.on("data", (chunk: Buffer) => { data += chunk.toString() })
      res.on("end", () => {
        try { resolve(JSON.parse(data)) }
        catch { reject(new Error(`Invalid JSON from ${url}`)) }
      })
    }).on("error", reject)
  })
}

async function fetchJson(url: string): Promise<any> {
  let lastErr: Error | undefined
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      return await fetchJsonOnce(url)
    } catch (err: any) {
      lastErr = err
      if (attempt < MAX_RETRIES) await sleep(RETRY_DELAY_MS * attempt)
    }
  }
  throw lastErr
}

function downloadFileOnce(url: string, dest: string, onProgress?: OnProgress): Promise<void> {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(dest)
    const client = url.startsWith("https") ? https : http

    const req = client.get(url, { headers: { "User-Agent": "XneonLauncher/1.0" } }, (res) => {
      if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        file.close()
        try { fs.unlinkSync(dest) } catch {}
        return downloadFileOnce(res.headers.location, dest, onProgress).then(resolve, reject)
      }

      if (res.statusCode !== 200) {
        file.close()
        try { fs.unlinkSync(dest) } catch {}
        return reject(new Error(`HTTP ${res.statusCode} downloading ${url}`))
      }

      const total = parseInt(res.headers["content-length"] || "0", 10) || 0
      let downloaded = 0

      res.on("data", (chunk: Buffer) => {
        downloaded += chunk.length
        if (onProgress && total > 0) {
          onProgress({
            phase: "downloading",
            percent: Math.round((downloaded / total) * 100),
            bytesTotal: total,
            bytesDownloaded: downloaded,
            message: `Скачивание... ${formatBytes(downloaded)} / ${formatBytes(total)}`,
          })
        }
      })

      res.on("error", (err) => {
        file.close()
        try { fs.unlinkSync(dest) } catch {}
        reject(err)
      })

      res.pipe(file)
      file.on("finish", () => { file.close(); resolve() })
    })

    req.on("error", (err) => {
      file.close()
      try { fs.unlinkSync(dest) } catch {}
      reject(err)
    })
  })
}

async function downloadFile(url: string, dest: string, onProgress?: OnProgress): Promise<void> {
  let lastErr: Error | undefined
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      return await downloadFileOnce(url, dest, onProgress)
    } catch (err: any) {
      lastErr = err
      onProgress?.({
        phase: "downloading",
        message: attempt < MAX_RETRIES
          ? `Скачивание не удалось (${err.message}), повтор ${attempt}/${MAX_RETRIES}...`
          : `Скачивание не удалось: ${err.message}`,
      })
      if (attempt < MAX_RETRIES) await sleep(RETRY_DELAY_MS * attempt)
    }
  }
  throw lastErr
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

// ── Vanilla ──────────────────────────────────────────

async function installVanilla(serverDir: string, gameVersion: string, onProgress?: OnProgress): Promise<string> {
  onProgress?.({ phase: "resolving", message: "Получение манифеста Mojang..." })

  const manifest = await fetchJson("https://piston-meta.mojang.com/mc/game/version_manifest_v2.json")
  const versionEntry = manifest.versions?.find((v: any) => v.id === gameVersion)
  if (!versionEntry) throw new Error(`Версия ${gameVersion} не найдена`)

  const versionDetails = await fetchJson(versionEntry.url)
  const serverDownload = versionDetails.downloads?.server
  if (!serverDownload?.url) throw new Error(`Серверный JAR недоступен для ${gameVersion}`)

  const dest = path.join(serverDir, "server.jar")
  await downloadFile(serverDownload.url, dest, onProgress)

  onProgress?.({ phase: "done", percent: 100, message: "Готово!" })
  return dest
}

// ── Fabric ───────────────────────────────────────────

async function installFabric(serverDir: string, gameVersion: string, loaderVersion: string, onProgress?: OnProgress): Promise<string> {
  // 1. Получаем последнюю версию инсталлера
  onProgress?.({ phase: "resolving", message: "Получение информации о Fabric..." })
  const installers = await fetchJson("https://meta.fabricmc.net/v2/versions/installer")
  const latestInstaller = installers.find((i: any) => i.stable)?.version
    || installers[0]?.version
  if (!latestInstaller) throw new Error("Не удалось найти версию Fabric installer")

  // 2. Качаем self-contained server jar
  const url = `https://meta.fabricmc.net/v2/versions/loader/${gameVersion}/${loaderVersion}/${latestInstaller}/server/jar`
  const dest = path.join(serverDir, "fabric-server-launch.jar")
  await downloadFile(url, dest, onProgress)

  onProgress?.({ phase: "done", percent: 100, message: "Готово!" })
  return dest
}

// ── Forge ────────────────────────────────────────────

async function installForge(serverDir: string, gameVersion: string, forgeVersion: string, javaPath: string, onProgress?: OnProgress): Promise<string> {
  // If an args file already exists (previous install), reuse it
  const existingArgs = findArgsFile(serverDir, "net/minecraftforge/forge")
  if (existingArgs) {
    onProgress?.({ phase: "done", percent: 100, message: "Forge уже установлен" })
    return existingArgs
  }

  // 1. Скачиваем инсталлер
  onProgress?.({ phase: "resolving", message: "Скачивание Forge installer..." })
  const installerUrl = `https://maven.minecraftforge.net/net/minecraftforge/forge/${gameVersion}-${forgeVersion}/forge-${gameVersion}-${forgeVersion}-installer.jar`
  const installerPath = path.join(serverDir, "forge-installer.jar")
  await downloadFile(installerUrl, installerPath, onProgress)

  // 2. Запускаем инсталлер
  onProgress?.({ phase: "extracting", message: "Установка Forge..." })
  try {
    await execFileAsync(javaPath, ["-jar", installerPath, "--installServer"], {
      cwd: serverDir,
      timeout: 300_000,
    })
  } catch (err: any) {
    throw new Error(`Forge installer failed: ${err.stderr?.toString() || err.message}`)
  } finally {
    try { fs.unlinkSync(installerPath) } catch {}
  }

  // 3. Ищем launcher jar или args file
  const jar = findForgeLauncherJar(serverDir)
  if (jar) {
    onProgress?.({ phase: "done", percent: 100, message: "Готово!" })
    return jar
  }

  // 4. Для Forge 1.17+ ищем unix_args.txt / win_args.txt
  const argsFile = findForgeArgsFile(serverDir, "net/minecraftforge/forge")
  if (argsFile) {
    onProgress?.({ phase: "done", percent: 100, message: "Готово!" })
    return argsFile
  }

  throw new Error("Forge installer не создал server JAR")
}

function findForgeLauncherJar(serverDir: string): string | null {
  // Pre-1.17: forge-X.X.X-shim.jar или forge-X.X.X universal.jar
  const patterns = ["forge-*-shim.jar", "forge-*-server.jar", "forge-*-universal.jar"]
  const files = fs.readdirSync(serverDir)
  for (const pattern of patterns) {
    const base = pattern.replace(/\*/g, "")
    const match = files.find(f => f.startsWith(base.replace(/-$/, "")) && f.endsWith(".jar"))
    if (match) return path.join(serverDir, match)
  }
  return null
}

function findArgsFile(serverDir: string, vendorPath: string, preferredVersion?: string): string | null {
  const filePattern = process.platform === "win32" ? "win_args.txt" : "unix_args.txt"
  const vendorDir = path.join(serverDir, "libraries", vendorPath)

  if (!fs.existsSync(vendorDir)) return null

  try {
    const versions = fs.readdirSync(vendorDir).filter(v => {
      const p = path.join(vendorDir, v, "libraries", filePattern)
      return fs.existsSync(p)
    }).sort()

    if (versions.length === 0) {
      // Check direct path without /libraries/ subfolder
      const allVersions = fs.readdirSync(vendorDir).sort()
      for (const ver of allVersions) {
        const directPath = path.join(vendorDir, ver, filePattern)
        if (fs.existsSync(directPath)) {
          return path.join("libraries", vendorPath, ver, filePattern)
        }
      }
      return null
    }

    const target = preferredVersion && versions.includes(preferredVersion)
      ? preferredVersion
      : versions[versions.length - 1]

    return path.join("libraries", vendorPath, target, "libraries", filePattern)
  } catch {
    return null
  }
}

function findForgeArgsFile(serverDir: string, vendorPath: string): string | null {
  return findArgsFile(serverDir, vendorPath)
}

// ── NeoForge ─────────────────────────────────────────

async function installNeoForge(serverDir: string, neoforgeVersion: string, javaPath: string, onProgress?: OnProgress): Promise<string> {
  // If an args file already exists (previous install), reuse it
  const existingArgs = findArgsFile(serverDir, "net/neoforged/neoforge", neoforgeVersion)
  if (existingArgs) {
    onProgress?.({ phase: "done", percent: 100, message: "NeoForge уже установлен" })
    return existingArgs
  }

  // 1. Скачиваем инсталлер
  onProgress?.({ phase: "resolving", message: "Скачивание NeoForge installer..." })
  const installerUrl = `https://maven.neoforged.net/releases/net/neoforged/neoforge/${neoforgeVersion}/neoforge-${neoforgeVersion}-installer.jar`
  const installerPath = path.join(serverDir, "neoforge-installer.jar")
  await downloadFile(installerUrl, installerPath, onProgress)

  // 2. Запускаем инсталлер
  onProgress?.({ phase: "extracting", message: "Установка NeoForge..." })
  try {
    await execFileAsync(javaPath, ["-jar", installerPath, "--installServer"], {
      cwd: serverDir,
      timeout: 300_000,
    })
  } catch (err: any) {
    throw new Error(`NeoForge installer failed: ${err.stderr?.toString() || err.message}`)
  } finally {
    try { fs.unlinkSync(installerPath) } catch {}
  }

  // 3. Ищем args file
  const argsFile = findArgsFile(serverDir, "net/neoforged/neoforge", neoforgeVersion)
  if (argsFile) {
    onProgress?.({ phase: "done", percent: 100, message: "Готово!" })
    return argsFile
  }

  // 4. Ищем JAR напрямую
  const jar = findExistingJar(serverDir, "neoforge")
  if (jar) {
    onProgress?.({ phase: "done", percent: 100, message: "Готово!" })
    return jar
  }

  throw new Error("NeoForge installer не создал server JAR")
}

// ── Quilt ────────────────────────────────────────────

async function installQuilt(serverDir: string, gameVersion: string, loaderVersion: string, javaPath: string, onProgress?: OnProgress): Promise<string> {
  // 1. Получаем последнюю версию инсталлера
  onProgress?.({ phase: "resolving", message: "Получение информации о Quilt..." })
  const installers = await fetchJson("https://meta.quiltmc.org/v3/versions/installer")
  const latestInstaller = installers.find((i: any) => i.stable)?.version
    || installers[0]?.version
  if (!latestInstaller) throw new Error("Не удалось найти версию Quilt installer")

  // 2. Скачиваем инсталлер
  const installerUrl = `https://meta.quiltmc.org/v3/versions/installer/${latestInstaller}/jar`
  const installerPath = path.join(serverDir, "quilt-installer.jar")
  await downloadFile(installerUrl, installerPath, onProgress)

  // 3. Запускаем инсталлер
  onProgress?.({ phase: "extracting", message: "Установка Quilt..." })
  try {
    await execFileAsync(
      javaPath,
      ["-jar", installerPath, "install", "server", gameVersion, loaderVersion, `--install-dir=${serverDir}`],
      { cwd: serverDir, timeout: 300_000 }
    )
  } catch (err: any) {
    throw new Error(`Quilt installer failed: ${err.stderr?.toString() || err.message}`)
  } finally {
    try { fs.unlinkSync(installerPath) } catch {}
  }

  // 4. Проверяем что jar появился
  const jar = path.join(serverDir, "quilt-server-launch.jar")
  if (fs.existsSync(jar)) {
    onProgress?.({ phase: "done", percent: 100, message: "Готово!" })
    return jar
  }

  throw new Error("Quilt installer не создал server JAR")
}

// ── PaperMC Fill API (Paper, Folia, Velocity, Waterfall) ──

async function fetchPaperMCLatestBuild(project: string, version: string, buildVersion?: string): Promise<{ url: string; filename: string }> {
  const url = `https://fill.papermc.io/v3/projects/${project}/versions/${version}/builds`
  const res = await fetchJson(url)
  const builds: any[] = Array.isArray(res) ? res : res?.value || []

  let build: any
  if (buildVersion) {
    build = builds.find((b: any) => String(b.id) === buildVersion)
    if (!build) throw new Error(`Билд ${buildVersion} не найден для ${project} ${version}`)
  } else {
    build = builds.find((b: any) => b.channel === "STABLE") || builds[0]
    if (!build) throw new Error(`Нет стабильных билдов ${project} для версии ${version}`)
  }

  const dl = build.downloads?.["server:default"]
  if (!dl?.url) throw new Error(`Download URL не найден для ${project} ${version} build ${build.id}`)
  return { url: dl.url, filename: dl.name || `${project}-${version}-${build.id}.jar` }
}

async function installPaperMCProject(serverDir: string, project: string, gameVersion: string, buildVersion?: string, onProgress?: OnProgress): Promise<string> {
  onProgress?.({ phase: "resolving", message: `Получение информации о ${project}...` })
  const { url, filename } = buildVersion
    ? await fetchPaperMCLatestBuild(project, gameVersion, buildVersion)
    : await fetchPaperMCLatestBuild(project, gameVersion)
  const dest = path.join(serverDir, filename)
  await downloadFile(url, dest, onProgress)
  onProgress?.({ phase: "done", percent: 100, message: "Готово!" })
  return dest
}

// ── Purpur ────────────────────────────────────────────

async function installPurpur(serverDir: string, gameVersion: string, buildVersion?: string, onProgress?: OnProgress): Promise<string> {
  onProgress?.({ phase: "resolving", message: "Получение информации о Purpur..." })

  let downloadUrl: string
  let filename: string

  if (buildVersion) {
    downloadUrl = `https://api.purpurmc.org/v2/purpur/${gameVersion}/${buildVersion}/download`
    filename = `purpur-${gameVersion}-${buildVersion}.jar`
  } else {
    downloadUrl = `https://api.purpurmc.org/v2/purpur/${gameVersion}/latest/download`
    filename = `purpur-${gameVersion}-latest.jar`
  }

  const dest = path.join(serverDir, filename)
  await downloadFile(downloadUrl, dest, onProgress)
  onProgress?.({ phase: "done", percent: 100, message: "Готово!" })
  return dest
}

// ── Spigot ────────────────────────────────────────────

async function installSpigot(serverDir: string, gameVersion: string, javaPath: string, onProgress?: OnProgress): Promise<string> {
  // Spigot requires BuildTools to compile — download BuildTools and run it
  onProgress?.({ phase: "resolving", message: "Скачивание Spigot BuildTools..." })
  const buildToolsUrl = "https://hub.spigotmc.org/jenkins/job/BuildTools/lastSuccessfulBuild/artifact/target/BuildTools.jar"
  const buildToolsPath = path.join(serverDir, "BuildTools.jar")
  await downloadFile(buildToolsUrl, buildToolsPath, onProgress)

  onProgress?.({ phase: "extracting", message: "Компиляция Spigot (это может занять время)..." })
  try {
    await execFileAsync(
      javaPath,
      ["-jar", buildToolsPath, "--rev", gameVersion],
      { cwd: serverDir, timeout: 600_000 }
    )
  } catch (err: any) {
    throw new Error(`Spigot BuildTools failed: ${err.stderr?.toString() || err.message}`)
  } finally {
    try { fs.unlinkSync(buildToolsPath) } catch {}
  }

  const jar = path.join(serverDir, `spigot-${gameVersion}.jar`)
  if (fs.existsSync(jar)) {
    onProgress?.({ phase: "done", percent: 100, message: "Готово!" })
    return jar
  }

  throw new Error("Spigot BuildTools не создал server JAR")
}

// ── Bukkit (CraftBukkit via BuildTools) ──────────────

async function installBukkit(serverDir: string, gameVersion: string, javaPath: string, onProgress?: OnProgress): Promise<string> {
  onProgress?.({ phase: "resolving", message: "Скачивание BuildTools..." })
  const buildToolsUrl = "https://hub.spigotmc.org/jenkins/job/BuildTools/lastSuccessfulBuild/artifact/target/BuildTools.jar"
  const buildToolsPath = path.join(serverDir, "BuildTools.jar")
  await downloadFile(buildToolsUrl, buildToolsPath, onProgress)

  onProgress?.({ phase: "extracting", message: "Компиляция CraftBukkit (это может занять время)..." })
  try {
    await execFileAsync(
      javaPath,
      ["-jar", buildToolsPath, "--rev", gameVersion, "--compile", "craftbukkit"],
      { cwd: serverDir, timeout: 600_000 }
    )
  } catch (err: any) {
    throw new Error(`Bukkit BuildTools failed: ${err.stderr?.toString() || err.message}`)
  } finally {
    try { fs.unlinkSync(buildToolsPath) } catch {}
  }

  const jar = path.join(serverDir, `craftbukkit-${gameVersion}.jar`)
  if (fs.existsSync(jar)) {
    onProgress?.({ phase: "done", percent: 100, message: "Готово!" })
    return jar
  }

  throw new Error("BuildTools не создал CraftBukkit JAR")
}

// ── Sponge ────────────────────────────────────────────

export type SpongeType = "spongevanilla" | "spongeforge" | "spongeneo"

export async function getSpongeSupportedVersions(spongeType?: SpongeType): Promise<string[]> {
  try {
    const types: SpongeType[] = spongeType ? [spongeType] : ["spongevanilla", "spongeforge", "spongeneo"]
    const results = await Promise.all(
      types.map(async (t) => {
        const data = await fetchJson(`https://dl-api.spongepowered.org/v2/groups/org.spongepowered/artifacts/${t}`)
        const mcTags: string[] = data?.tags?.minecraft || []
        return mcTags
      })
    )
    const set = new Set<string>()
    for (const list of results) {
      for (const v of list) {
        set.add(v)
      }
    }
    return Array.from(set)
  } catch (err) {
    console.error(`[Sponge] Failed to fetch supported MC versions:`, err)
    return []
  }
}

export async function getSpongeBuilds(spongeType: SpongeType = "spongevanilla", gameVersion: string): Promise<LoaderVersionEntry[]> {
  try {
    const url = `https://dl-api.spongepowered.org/v2/groups/org.spongepowered/artifacts/${spongeType}/versions?tags=minecraft:${gameVersion}`
    const data = await fetchJson(url)
    const artifacts: Record<string, { recommended?: boolean; tagValues?: Record<string, string> }> = data?.artifacts || {}
    const entries: LoaderVersionEntry[] = []

    for (const [versionKey, info] of Object.entries(artifacts)) {
      const isRec = !!info.recommended
      const apiVer = info.tagValues?.api ? ` (API ${info.tagValues.api})` : ""
      const forgeVer = info.tagValues?.forge ? ` [Forge ${info.tagValues.forge}]` : ""
      entries.push({
        value: versionKey,
        label: `${versionKey}${apiVer}${forgeVer}${isRec ? " ★ Recommended" : ""}`,
        recommended: isRec,
        stable: isRec || !versionKey.includes("-RC"),
      })
    }

    return entries
  } catch (err) {
    console.error(`[Sponge] Failed to fetch builds for ${spongeType} on MC ${gameVersion}:`, err)
    return []
  }
}

async function installSponge(
  serverDir: string,
  gameVersion: string,
  spongeVersion?: string,
  spongeType: SpongeType = "spongevanilla",
  javaPath: string = "java",
  onProgress?: OnProgress
): Promise<string> {
  onProgress?.({ phase: "resolving", message: `Получение информации о ${spongeType}...` })

  let targetVersion = spongeVersion
  if (!targetVersion) {
    const builds = await getSpongeBuilds(spongeType, gameVersion)
    const rec = builds.find(b => b.recommended) || builds[0]
    if (!rec) throw new Error(`Версия Sponge (${spongeType}) не найдена для Minecraft ${gameVersion}`)
    targetVersion = rec.value
  }

  // Query artifact details to get actual download URL and metadata from Sponge API
  const versionUrl = `https://dl-api.spongepowered.org/v2/groups/org.spongepowered/artifacts/${spongeType}/versions/${targetVersion}`
  const verData = await fetchJson(versionUrl)
  const assets: Array<{ classifier: string; downloadUrl: string; extension: string }> = verData?.assets || []
  const tags: Record<string, string> = verData?.tags || {}

  // 1. SpongeForge: install Forge server, put spongeforge jar into mods/
  if (spongeType === "spongeforge") {
    // Find SpongeForge jar
    const sfAsset = assets.find(a => a.extension === "jar" && a.classifier === "universal")
      || assets.find(a => a.extension === "jar" && !a.classifier)
      || assets.find(a => a.extension === "jar" && !a.classifier?.includes("source"))
    if (!sfAsset) throw new Error(`JAR-файл не найден для SpongeForge ${targetVersion}`)

    // Determine matching Forge version from tags or version string
    // Tag example: tags.forge = "65.1.1" or "2838"
    let forgeVer = tags.forge
    if (!forgeVer) {
      // Version string format: MC-FORGE-API-BUILD (e.g. "1.12.2-2838-7.4.7" or "26.2-65.1.1-20.0.0-RC2703")
      const parts = targetVersion.split("-")
      if (parts.length >= 2) forgeVer = parts[1]
    }
    if (!forgeVer) {
      throw new Error(`Не удалось определить требуемую версию Forge для SpongeForge ${targetVersion}`)
    }

    onProgress?.({ phase: "resolving", message: `Установка основы Forge (${forgeVer})...` })
    const launchTarget = await installForge(serverDir, gameVersion, forgeVer, javaPath, onProgress)

    // Download SpongeForge mod jar to mods/
    const modsDir = path.join(serverDir, "mods")
    if (!fs.existsSync(modsDir)) {
      fs.mkdirSync(modsDir, { recursive: true })
    }
    const sfFilename = path.basename(new URL(sfAsset.downloadUrl).pathname) || `spongeforge-${targetVersion}.jar`
    const sfDest = path.join(modsDir, sfFilename)
    onProgress?.({ phase: "downloading", message: `Загрузка SpongeForge в mods/...` })
    await downloadFile(sfAsset.downloadUrl, sfDest, onProgress)

    onProgress?.({ phase: "done", percent: 100, message: "Готово!" })
    return launchTarget
  }

  // 2. SpongeNeo: install NeoForge server, put spongeneo jar into mods/
  if (spongeType === "spongeneo") {
    const snAsset = assets.find(a => a.extension === "jar" && a.classifier === "universal")
      || assets.find(a => a.extension === "jar" && !a.classifier)
      || assets.find(a => a.extension === "jar" && !a.classifier?.includes("source"))
    if (!snAsset) throw new Error(`JAR-файл не найден для SpongeNeo ${targetVersion}`)

    let neoVer = tags.neoforge
    if (!neoVer) {
      const parts = targetVersion.split("-")
      if (parts.length >= 2) neoVer = parts[1]
    }
    if (!neoVer) {
      throw new Error(`Не удалось определить требуемую версию NeoForge для SpongeNeo ${targetVersion}`)
    }

    onProgress?.({ phase: "resolving", message: `Установка основы NeoForge (${neoVer})...` })
    const launchTarget = await installNeoForge(serverDir, neoVer, javaPath, onProgress)

    // Download SpongeNeo mod jar to mods/
    const modsDir = path.join(serverDir, "mods")
    if (!fs.existsSync(modsDir)) {
      fs.mkdirSync(modsDir, { recursive: true })
    }
    const snFilename = path.basename(new URL(snAsset.downloadUrl).pathname) || `spongeneo-${targetVersion}.jar`
    const snDest = path.join(modsDir, snFilename)
    onProgress?.({ phase: "downloading", message: `Загрузка SpongeNeo в mods/...` })
    await downloadFile(snAsset.downloadUrl, snDest, onProgress)

    onProgress?.({ phase: "done", percent: 100, message: "Готово!" })
    return launchTarget
  }

  // 3. SpongeVanilla: standalone server
  // For modern SpongeVanilla (8+), prefer the executable installer.jar which contains InstallerMain.
  // For older SpongeVanilla (7.x and below), plain jar or universal jar is used.
  const installerAsset = assets.find(a => a.extension === "jar" && a.classifier === "installer")
  const jarAsset = installerAsset
    || assets.find(a => a.extension === "jar" && a.classifier === "universal")
    || assets.find(a => a.extension === "jar" && !a.classifier)
    || assets.find(a => a.extension === "jar" && !a.classifier?.includes("source"))

  if (!jarAsset) {
    throw new Error(`JAR-файл не найден для SpongeVanilla ${targetVersion}`)
  }

  const filename = path.basename(new URL(jarAsset.downloadUrl).pathname) || `${spongeType}-${targetVersion}.jar`
  const dest = path.join(serverDir, filename)
  await downloadFile(jarAsset.downloadUrl, dest, onProgress)
  onProgress?.({ phase: "done", percent: 100, message: "Готово!" })
  return dest
}

// ── BungeeCord ────────────────────────────────────────

async function installBungeeCord(serverDir: string, onProgress?: OnProgress): Promise<string> {
  onProgress?.({ phase: "resolving", message: "Скачивание BungeeCord..." })
  const url = "https://ci.md-5.net/job/BungeeCord/lastSuccessfulBuild/artifact/bootstrap/target/BungeeCord.jar"
  const dest = path.join(serverDir, "BungeeCord.jar")
  await downloadFile(url, dest, onProgress)
  onProgress?.({ phase: "done", percent: 100, message: "Готово!" })
  return dest
}

// ── Shared helpers ───────────────────────────────────

function findExistingJar(serverDir: string, modloader: string): string | null {
  if (!fs.existsSync(serverDir)) return null

  const files = fs.readdirSync(serverDir).filter(f => f.endsWith(".jar"))

  // Priority: modloader-specific names first, then server.jar
  const knownJars: string[] = []
  if (modloader === "fabric") {
    knownJars.push("fabric-server-launch.jar", "fabric-server-*.jar")
  } else if (modloader === "quilt") {
    knownJars.push("quilt-server-launch.jar", "quilt-server-*.jar")
  } else if (modloader === "forge") {
    knownJars.push("forge-*-shim.jar", "forge-*-server.jar", "forge-*-universal.jar")
  } else if (modloader === "neoforge") {
    knownJars.push("neoforge-*-server.jar")
  } else if (modloader === "paper") {
    knownJars.push("paper-*.jar")
  } else if (modloader === "folia") {
    knownJars.push("folia-*.jar")
  } else if (modloader === "purpur") {
    knownJars.push("purpur-*.jar")
  } else if (modloader === "spigot") {
    knownJars.push("spigot-*.jar")
  } else if (modloader === "bukkit") {
    knownJars.push("craftbukkit-*.jar")
  } else if (modloader === "sponge" || modloader === "spongevanilla") {
    knownJars.push("spongevanilla-*.jar")
  } else if (modloader === "spongeforge") {
    knownJars.push("spongeforge-*.jar")
  } else if (modloader === "spongeneo") {
    knownJars.push("spongeneo-*.jar")
  } else if (modloader === "velocity") {
    knownJars.push("velocity-*.jar")
  } else if (modloader === "waterfall") {
    knownJars.push("waterfall-*.jar")
  } else if (modloader === "bungeecord") {
    knownJars.push("BungeeCord.jar")
  }
  knownJars.push("server.jar")

  for (const name of knownJars) {
    if (name.includes("*")) {
      const [prefix, suffix] = name.split("*")
      const match = files.find(f => f.startsWith(prefix) && f.endsWith(suffix))
      if (match) return path.join(serverDir, match)
    } else {
      if (files.includes(name)) return path.join(serverDir, name)
    }
  }

  return null
}

// ── Version listing APIs ─────────────────────────────

export interface LoaderVersionEntry {
  value: string
  label: string
  stable?: boolean
  recommended?: boolean
}

export interface McVersionEntry {
  version: string
  stable?: boolean
}

// ── Paper supported MC versions ───────────────────────

export async function getPaperVersions(): Promise<McVersionEntry[]> {
  const res = await fetchJson("https://fill.papermc.io/v3/projects/paper")
  const versionsObj: Record<string, string[]> = res?.versions || {}
  const allVersions: string[] = []
  for (const group of Object.values(versionsObj)) {
    if (Array.isArray(group)) allVersions.push(...group)
  }
  return allVersions.map((v) => ({
    version: v,
    stable: !v.includes("rc") && !v.includes("pre"),
  }))
}

// ── Purpur supported MC versions ──────────────────────

export async function getPurpurVersions(): Promise<McVersionEntry[]> {
  const res = await fetchJson("https://api.purpurmc.org/v2/purpur")
  const versions: string[] = res?.versions || []
  return versions.map((v) => ({
    version: v,
    stable: true,
  }))
}

// ── Folia supported MC versions ───────────────────────

export async function getFoliaVersions(): Promise<McVersionEntry[]> {
  const res = await fetchJson("https://fill.papermc.io/v3/projects/folia")
  const versionsObj: Record<string, string[]> = res?.versions || {}
  const allVersions: string[] = []
  for (const group of Object.values(versionsObj)) {
    if (Array.isArray(group)) allVersions.push(...group)
  }
  return allVersions.map((v) => ({
    version: v,
    stable: !v.includes("rc") && !v.includes("pre"),
  }))
}

// ── Paper builds (loader versions) ────────────────────

export async function getPaperBuilds(gameVersion: string): Promise<LoaderVersionEntry[]> {
  const url = `https://fill.papermc.io/v3/projects/paper/versions/${gameVersion}/builds`
  const res = await fetchJson(url)
  const builds: any[] = Array.isArray(res) ? res : res?.value || []
  return builds.map((b: any) => {
    const isStable = b.channel === "STABLE"
    return {
      value: String(b.id),
      label: `Build ${b.id}${isStable ? " (stable)" : ""}`,
      stable: isStable,
      recommended: isStable,
    }
  })
}

// ── Purpur builds (loader versions) ───────────────────

export async function getPurpurBuilds(gameVersion: string): Promise<LoaderVersionEntry[]> {
  const res = await fetchJson(`https://api.purpurmc.org/v2/purpur/${gameVersion}`)
  const buildsList: string[] = res?.builds?.all || []
  const latestBuild = String(res?.builds?.latest || "")
  return buildsList.map((b: string) => ({
    value: b,
    label: `Build ${b}`,
    stable: true,
    recommended: b === latestBuild,
  })).reverse()
}

// ── Folia builds (loader versions) ────────────────────

export async function getFoliaBuilds(gameVersion: string): Promise<LoaderVersionEntry[]> {
  const url = `https://fill.papermc.io/v3/projects/folia/versions/${gameVersion}/builds`
  const res = await fetchJson(url)
  const builds: any[] = Array.isArray(res) ? res : res?.value || []
  return builds.map((b: any) => {
    const isStable = b.channel === "STABLE"
    return {
      value: String(b.id),
      label: `Build ${b.id}${isStable ? " (stable)" : ""}`,
      stable: isStable,
      recommended: isStable,
    }
  })
}

// ── Velocity versions (proxy, NOT tied to MC) ─────────

export async function getVelocityVersions(): Promise<McVersionEntry[]> {
  const res = await fetchJson("https://fill.papermc.io/v3/projects/velocity")
  const versionsObj: Record<string, string[]> = res?.versions || {}
  const allVersions: string[] = []
  for (const group of Object.values(versionsObj)) {
    if (Array.isArray(group)) allVersions.push(...group)
  }
  return allVersions.filter(v => !v.includes("SNAPSHOT")).map((v) => ({
    version: v,
    stable: true,
  }))
}

export async function getVelocityBuilds(velocityVersion: string): Promise<LoaderVersionEntry[]> {
  const url = `https://fill.papermc.io/v3/projects/velocity/versions/${velocityVersion}/builds`
  const res = await fetchJson(url)
  const builds: any[] = Array.isArray(res) ? res : res?.value || []
  return builds.map((b: any) => {
    const isStable = b.channel === "RECOMMENDED" || b.channel === "STABLE"
    return {
      value: String(b.id),
      label: `Build ${b.id}${isStable ? ` (${b.channel.toLowerCase()})` : ""}`,
      stable: isStable,
      recommended: b.channel === "RECOMMENDED",
    }
  })
}

// ── Waterfall versions (proxy, tied to MC) ────────────

export async function getWaterfallVersions(): Promise<McVersionEntry[]> {
  const res = await fetchJson("https://fill.papermc.io/v3/projects/waterfall")
  const versionsObj: Record<string, string[]> = res?.versions || {}
  const allVersions: string[] = []
  for (const group of Object.values(versionsObj)) {
    if (Array.isArray(group)) allVersions.push(...group)
  }
  return allVersions.map((v) => ({
    version: v,
    stable: true,
  }))
}

export async function getWaterfallBuilds(gameVersion: string): Promise<LoaderVersionEntry[]> {
  const url = `https://fill.papermc.io/v3/projects/waterfall/versions/${gameVersion}/builds`
  const res = await fetchJson(url)
  const builds: any[] = Array.isArray(res) ? res : res?.value || []
  return builds.map((b: any) => {
    const isStable = b.channel === "RECOMMENDED" || b.channel === "STABLE"
    return {
      value: String(b.id),
      label: `Build ${b.id}${isStable ? ` (${b.channel.toLowerCase()})` : ""}`,
      stable: isStable,
      recommended: b.channel === "RECOMMENDED",
    }
  })
}

// ── Main entry ───────────────────────────────────────

export async function ensureServerJar(
  serverDir: string,
  modloader: string,
  gameVersion: string,
  modloaderVersion: string | undefined,
  javaPath: string,
  onProgress?: OnProgress,
  customJarName?: string | null,
): Promise<string> {
  // Custom JAR has priority — use it directly instead of downloading
  if (customJarName) {
    const customPath = path.join(serverDir, customJarName)
    if (fs.existsSync(customPath)) {
      onProgress?.({ phase: "done", percent: 100, message: "Используется свой JAR" })
      return customPath
    }
  }

  // Check if JAR already exists
  const existing = findExistingJar(serverDir, modloader)
  if (existing) {
    onProgress?.({ phase: "done", percent: 100, message: "JAR уже загружен" })
    return existing
  }

  if (!fs.existsSync(serverDir)) {
    fs.mkdirSync(serverDir, { recursive: true })
  }

  switch (modloader) {
    case "vanilla":
      return await installVanilla(serverDir, gameVersion, onProgress)
    case "fabric":
      return await installFabric(serverDir, gameVersion, modloaderVersion || "0.16.14", onProgress)
    case "forge": {
      if (!modloaderVersion) {
        // Try to get latest forge version from promotions
        onProgress?.({ phase: "resolving", message: "Получение версии Forge..." })
        const meta = await fetchJson("https://files.minecraftforge.net/net/minecraftforge/forge/promotions_slim.json")
        modloaderVersion = meta?.promos?.[`${gameVersion}-latest`] || meta?.promos?.[`${gameVersion}-recommended`]
        if (!modloaderVersion) throw new Error(`Forge version not found for ${gameVersion}. Specify manually.`)
      }
      return await installForge(serverDir, gameVersion, modloaderVersion, javaPath, onProgress)
    }
    case "neoforge":
      if (!modloaderVersion) throw new Error("NeoForge requires a loader version")
      return await installNeoForge(serverDir, modloaderVersion, javaPath, onProgress)
    case "quilt":
      if (!modloaderVersion) throw new Error("Quilt requires a loader version")
      return await installQuilt(serverDir, gameVersion, modloaderVersion, javaPath, onProgress)
    case "paper":
      return await installPaperMCProject(serverDir, "paper", gameVersion, modloaderVersion, onProgress)
    case "folia":
      return await installPaperMCProject(serverDir, "folia", gameVersion, modloaderVersion, onProgress)
    case "velocity":
      return await installPaperMCProject(serverDir, "velocity", gameVersion, modloaderVersion, onProgress)
    case "waterfall":
      return await installPaperMCProject(serverDir, "waterfall", gameVersion, modloaderVersion, onProgress)
    case "purpur":
      return await installPurpur(serverDir, gameVersion, modloaderVersion, onProgress)
    case "spigot":
      return await installSpigot(serverDir, gameVersion, javaPath, onProgress)
    case "bukkit":
      return await installBukkit(serverDir, gameVersion, javaPath, onProgress)
    case "sponge":
    case "spongevanilla":
      return await installSponge(serverDir, gameVersion, modloaderVersion, "spongevanilla", javaPath, onProgress)
    case "spongeforge":
      return await installSponge(serverDir, gameVersion, modloaderVersion, "spongeforge", javaPath, onProgress)
    case "spongeneo":
      return await installSponge(serverDir, gameVersion, modloaderVersion, "spongeneo", javaPath, onProgress)
    case "bungeecord":
      return await installBungeeCord(serverDir, onProgress)
    default:
      throw new Error(`Unsupported modloader: ${modloader}`)
  }
}
