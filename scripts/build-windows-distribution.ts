import assert from "node:assert/strict"
import { existsSync, readdirSync } from "node:fs"
import { createHash } from "node:crypto"
import { cp, mkdir, readFile, readdir, rm, stat, writeFile } from "node:fs/promises"
import path from "node:path"
import packageJson from "../package.json"
import { appIdentifier } from "../electrobun/main/app-identity"
import { writeBlockMap, writeLatestFile } from "./release-metadata"
import { windowsX64 } from "./windows-candidate-validation"

/**
 * Собирает Windows-артефакты, как electron-builder в Electron-сборке:
 *
 *   xneon-launcher-<version>-win-x64.exe  — NSIS-установщик (per-user,
 *     %LOCALAPPDATA%\Programs\xneon-launcher, ярлыки, «Установленные приложения»,
 *     тихая установка через /S, свой деинсталлятор);
 *   xneon-launcher-<version>-win-x64.zip  — распакованное приложение
 *     (unpacked, как zip-таргет electron-builder): разархивировал и запускаешь
 *     bin\launcher.exe, без установки.
 *
 * Полезная нагрузка берётся из уже собранного канала Electrobun
 * (build-electrobun/<channel>-win-x64): архив <hash>.tar.zst распаковывается
 * в staging, откуда build/installer.nsi забирает бандл app\, а zip собирается
 * из того же staging без обёртки установщика.
 */

const channel = Bun.argv[2] ?? "stable"
assert.ok(channel === "stable" || channel === "canary" || channel === "dev", "Invalid build channel: " + channel)
assert.equal(process.platform, "win32", "Windows packaging requires Windows")
assert.equal(process.arch, "x64", "Windows packaging requires x64")
assert.equal(Bun.version, "1.4.4", "Windows packaging requires Bun 1.4.4")

const root = path.resolve(import.meta.dir, "..")
const version = packageJson.version
const channelBuild = path.join(root, "build-electrobun", `${channel}-win-x64`)
const metadataPath = path.join(channelBuild, "XneonLauncher", "Resources", "metadata.json")
assert.ok(existsSync(metadataPath), "Сначала соберите канал: bun run build (" + metadataPath + ")")
const metadata = JSON.parse(await readFile(metadataPath, "utf8")) as { identifier?: string; channel?: string; hash?: string; name?: string }
assert.equal(metadata.identifier, appIdentifier, "Unexpected installer identity")
assert.equal(metadata.channel, channel, "Unexpected build channel")
assert.ok(/^[a-z0-9]+$/.test(metadata.hash ?? ""), "Unexpected build hash")

const archivePath = path.join(channelBuild, "XneonLauncher", "Resources", `${metadata.hash}.tar.zst`)
assert.ok(existsSync(archivePath), "Missing application archive: " + archivePath)

const staging = path.join(root, "build-electrobun", "windows-staging")
await rm(staging, { recursive: true, force: true })
await mkdir(staging, { recursive: true })
const tarPath = path.join(staging, "payload.tar")
await writeFile(tarPath, Bun.zstdDecompressSync(await readFile(archivePath)))
const extracted = path.join(staging, "extracted")
await mkdir(extracted)
const tar = Bun.spawnSync(["tar.exe", "-xf", tarPath, "-C", extracted], { stderr: "inherit" })
assert.equal(tar.exitCode, 0, "Failed to extract the application archive")
const bundles = (await readdir(extracted, { withFileTypes: true })).filter(entry => entry.isDirectory())
assert.equal(bundles.length, 1, "Unexpected application archive layout")
await cp(path.join(extracted, bundles[0].name), path.join(staging, "app"), { recursive: true })
await rm(extracted, { recursive: true, force: true })
await rm(tarPath, { force: true })

const app = path.join(staging, "app")
const local = JSON.parse(await readFile(path.join(app, "Resources", "version.json"), "utf8")) as Record<string, unknown>
assert.equal(local.identifier, metadata.identifier)
assert.equal(local.version, version)
assert.equal(local.channel, channel)
assert.equal(local.hash, metadata.hash)
assert.ok(existsSync(path.join(app, "bin", "launcher.exe")), "Packaged launcher is missing")
// Встроенный менеджер обновлений Electrobun: SDK использует его как fallback,
// когда в каталоге канала нет отдельного uninstall.exe.
assert.ok(existsSync(path.join(app, "Resources", "uninstall")), "Bundled update manager is missing")

const releaseRoot = path.join(root, "release-electrobun", channel)
await mkdir(releaseRoot, { recursive: true })

const installer = path.join(releaseRoot, `xneon-launcher-${version}-win-x64.exe`)
await rm(installer, { force: true })
const fileVersion = `${version.split(/[-+]/, 1)[0]}.0`
const makensis = findMakensis()
const result = Bun.spawnSync([
  makensis,
  "/V2",
  "/NOCD",
  // Скрипт хранится в UTF-8 (в нём русские строки), системная ANSI-кодировка
  // на машинах сборки другая — кодировку задаём явно.
  "/INPUTCHARSET",
  "UTF8",
  `/DOUTFILE=${installer}`,
  `/DSTAGING=${staging}`,
  `/DAPP_ICON=${path.join(root, "build", "icon.ico")}`,
  `/DAPP_VERSION=${version}`,
  `/DAPP_FILE_VERSION=${fileVersion}`,
  `/DAPP_ID=${metadata.identifier}`,
  `/DCHANNEL=${channel}`,
  path.join(root, "build", "installer.nsi"),
], { cwd: path.join(root, "build"), stdout: "inherit", stderr: "inherit" })
assert.equal(result.exitCode, 0, "makensis failed")

const installerInfo = await stat(installer)
assert.ok(installerInfo.isFile() && installerInfo.size > 1024 ** 2, "Installer was not produced")
const installerBytes = await readFile(installer)
assert.ok(installerBytes.includes("NullsoftInst"), "Installer is not an NSIS package")

// ---------------------------------------------------------------------------
// Распакованное приложение: содержимое бандла лежит в корне архива
// (bin\ + Resources\), как zip-таргет electron-builder. Установка не нужна,
// данные — в обычном %APPDATA%\xneonlauncher.
// ---------------------------------------------------------------------------
const unpacked = path.join(releaseRoot, `xneon-launcher-${version}-win-x64.zip`)
await rm(unpacked, { force: true })
const zip = Bun.spawnSync(["tar.exe", "-a", "-cf", unpacked, "-C", app, "bin", "Resources"], { stderr: "inherit" })
assert.equal(zip.exitCode, 0, "Failed to create the unpacked archive")

const entries = listZip(unpacked)
assert.deepEqual([...new Set(entries)].sort(), entries, "Duplicate entries in unpacked archive")
for (const entry of entries) {
  assert.ok(
    (entry === "bin/" || entry === "Resources/" || entry.startsWith("bin/") || entry.startsWith("Resources/")) &&
      !/(?:^|\/)\.\.(?:\/|$)|[\\:\u0000-\u001f]/.test(entry) &&
      !/(?:^|\/)(?:\.env(?:[./]|$)|\.npmrc$|node_modules(?:\/|$)|credentials(?:\.generated)?\.(?:ts|json)$)|\.(?:db(?:-wal|-shm)?|sqlite3?|pdb|map|log|tmp|bak)$/i.test(entry),
    "Unexpected member in unpacked archive: " + entry,
  )
}
assert.ok(entries.includes("bin/launcher.exe"), "Unpacked archive has no launcher")
assert.ok(entries.includes("Resources/version.json"), "Unpacked archive has no version.json")
windowsX64(await readFile(path.join(app, "bin", "launcher.exe")))
windowsX64(await readFile(path.join(app, "bin", "bun.exe")))

const unpackedBytes = await readFile(unpacked)
assert.ok(unpackedBytes.length > 1024 ** 2, "Unpacked archive was not produced")

const sha256 = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex")
const installerArtifact = writeBlockMap(installer)
const unpackedArtifact = writeBlockMap(unpacked)
const latest = writeLatestFile(releaseRoot, "win", version, [installerArtifact, unpackedArtifact], path.basename(installer))
console.log("NSIS installer:      " + installer)
console.log("  SHA-256:           " + sha256(installerBytes))
console.log("Unpacked app:        " + unpacked)
console.log("  SHA-256:           " + sha256(unpackedBytes))
console.log("Block maps:          " + installerArtifact.blockMapSize + " / " + unpackedArtifact.blockMapSize + " bytes")
console.log("Update metadata:     " + latest)

/** Список записей zip через bsdtar (он же tar.exe в Windows). */
function listZip(file: string): string[] {
  const listing = Bun.spawnSync(["tar.exe", "-tf", file], { stdout: "pipe", stderr: "pipe" })
  assert.equal(listing.exitCode, 0, "Failed to inspect the unpacked archive")
  return listing.stdout.toString().split(/\r?\n/).map(line => line.trim()).filter(Boolean).sort()
}

function findMakensis(): string {
  const configured = process.env.XNEON_MAKENSIS
  if (configured) {
    assert.ok(existsSync(configured), "XNEON_MAKENSIS does not exist: " + configured)
    return configured
  }
  const onPath = Bun.which("makensis")
  if (onPath) return onPath
  for (const candidate of [
    path.join(process.env.ProgramFiles ?? "C:\\Program Files", "NSIS", "makensis.exe"),
    path.join(process.env["ProgramFiles(x86)"] ?? "C:\\Program Files (x86)", "NSIS", "makensis.exe"),
  ]) if (existsSync(candidate)) return candidate

  // Кэш electron-builder: NSIS 3.0.4.1 уже распакован на машинах, где собирали Electron.
  const cache = path.join(process.env.LOCALAPPDATA ?? "", "electron-builder", "Cache")
  for (const entry of readdirSyncSafe(cache)) {
    const name = entry.name.toLowerCase()
    if (!entry.isDirectory() || !name.startsWith("nsis-") || name.startsWith("nsis-resources")) continue
    const directory = path.join(cache, entry.name)
    const direct = path.join(directory, "makensis.exe")
    if (existsSync(direct)) return direct
    const nested = findInTree(directory, "makensis.exe", 3)
    if (nested) return nested
  }
  throw new Error("makensis not found. Install NSIS 3 (choco install nsis) or set XNEON_MAKENSIS.")
}

function findInTree(directory: string, name: string, depth: number): string | undefined {
  if (depth < 0 || !existsSync(directory)) return undefined
  for (const entry of readdirSyncSafe(directory)) {
    const full = path.join(directory, entry.name)
    if (entry.isFile() && entry.name.toLowerCase() === name.toLowerCase()) return full
  }
  for (const entry of readdirSyncSafe(directory)) {
    if (!entry.isDirectory()) continue
    const found = findInTree(path.join(directory, entry.name), name, depth - 1)
    if (found) return found
  }
  return undefined
}

function readdirSyncSafe(directory: string) {
  try {
    return readdirSync(directory, { withFileTypes: true })
  } catch {
    return []
  }
}
