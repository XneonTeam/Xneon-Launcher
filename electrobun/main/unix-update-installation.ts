import assert from "node:assert/strict"
import { constants } from "node:fs"
import { access, lstat, open, readFile, realpath } from "node:fs/promises"
import { execFile } from "node:child_process"
import { promisify } from "node:util"
import path from "node:path"
import { appIdentifier } from "./app-identity"
import type { UnixUpdateManifest } from "./update-manifest"

export type PackageKind = "deb" | "rpm" | "pacman"
type InstalledIdentity = { identifier: string; version: string; channel: "stable" | "canary"; hash: string }
export type UnixInstallation = { kind: "appimage" | "directory" | "app-bundle" | PackageKind | "manual"; platform: "linux" | "macos"; target: string }
export type InstallationProbe = {
  canonical: (file: string) => Promise<string>
  readIdentity: (file: string) => Promise<InstalledIdentity>
  readMarker: (file: string) => Promise<Record<string, unknown> | null>
  header: (file: string) => Promise<Buffer>
  packageOwners: (file: string) => Promise<PackageKind[]>
  writable: (file: string) => Promise<boolean>
}
const p = path.posix
const execute = promisify(execFile)
async function jsonFile(file: string) {
  const info = await lstat(file)
  assert.ok(info.isFile() && info.size > 0 && info.size <= 64 * 1024, "Invalid update installation metadata")
  return JSON.parse(await readFile(file, "utf8"))
}
export const nativeInstallationProbe: InstallationProbe = {
  canonical: realpath, readIdentity: jsonFile,
  readMarker: file => jsonFile(file).catch(error => { if (error.code === "ENOENT") return null; throw error }),
  header: async file => {
    const handle = await open(file, "r")
    try { const bytes = Buffer.alloc(64); assert.equal((await handle.read(bytes, 0, 64, 0)).bytesRead, 64, "Truncated AppImage"); return bytes }
    finally { await handle.close() }
  },
  writable: file => access(file, constants.W_OK).then(() => true, () => false),
  packageOwners: async file => {
    const owners: PackageKind[] = []
    for (const [kind, executable, args] of [
      ["deb", "/usr/bin/dpkg-query", ["--search", file]],
      ["rpm", "/usr/bin/rpm", ["-qf", "--qf", "%{NAME}\n", file]],
      ["pacman", "/usr/bin/pacman", ["-Qoq", file]],
    ] as const) {
      try {
        const result = await execute(executable, [...args], { encoding: "utf8", timeout: 3000, maxBuffer: 8192 })
        const output = result.stdout.trim()
        if (kind === "deb" ? /^xneon-launcher(?::[a-z0-9_-]+)?: /m.test(output) : output === "xneon-launcher") owners.push(kind)
      } catch (error) {
        // Отсутствующий менеджер/отсутствие владельца — не определённый пакет.
        const code = (error as NodeJS.ErrnoException & { code?: string | number }).code
        if (code !== "ENOENT" && typeof code !== "number") throw error
      }
    }
    return owners
  },
}
const within = (root: string, file: string) => { const relative = p.relative(root, file); return !!relative && !relative.startsWith("../") && relative !== ".." && !p.isAbsolute(relative) }
async function writable(probe: InstallationProbe, target: string, file = false) {
  if (!await probe.writable(p.dirname(target)) || file && !await probe.writable(target)) throw new Error("update-no-permission")
}

/** Окружение само по себе не определяет формат: сверяем путь, payload identity и владельца. */
export async function detectUnixInstallation(context: { platform: "linux" | "macos"; arch: "x64" | "arm64"; executable: string;
  home: string; environment: Readonly<Record<string, string | undefined>>; identity: InstalledIdentity }, probe = nativeInstallationProbe): Promise<UnixInstallation> {
  assert.ok(context.identity.identifier === appIdentifier && (context.identity.channel === "stable" || context.identity.channel === "canary"), "Invalid installed identity")
  assert.ok(context.platform === "linux" && context.arch === "x64" || context.platform === "macos" && context.arch === "arm64", "Unsupported update target")
  assert.ok(p.isAbsolute(context.executable) && p.isAbsolute(context.home), "Invalid installation path")
  const executable = await probe.canonical(context.executable)
  const home = await probe.canonical(context.home)
  let target: string
  if (context.platform === "macos") {
    assert.ok(!executable.includes("/AppTranslocation/"), "update-read-only-installation")
    assert.ok(/\.app\/Contents\/MacOS\/(?:bun|launcher)$/.test(executable), "update-unsupported-installation")
    target = p.dirname(p.dirname(p.dirname(executable)))
  } else {
    assert.ok(/\/bin\/(?:bun|launcher)$/.test(executable), "update-unsupported-installation")
    target = p.dirname(p.dirname(executable))
  }
  const resources = p.join(target, context.platform === "macos" ? "Contents/Resources" : "Resources")
  const identity = await probe.readIdentity(p.join(resources, "version.json"))
  for (const key of ["identifier", "version", "channel", "hash"] as const) assert.equal(identity[key], context.identity[key], "Installed payload identity mismatch")
  if (context.platform === "macos") {
    await writable(probe, target)
    return { kind: "app-bundle", platform: "macos", target }
  }
  const { APPIMAGE: image, APPDIR: mount } = context.environment
  if (image || mount) {
    assert.ok(image && mount && p.isAbsolute(image) && p.isAbsolute(mount), "Invalid AppImage environment")
    const appdir = await probe.canonical(mount)
    assert.equal(target, p.join(appdir, "opt/xneon-launcher"), "AppImage mount does not contain this launcher")
    const destination = await probe.canonical(image)
    const bytes = await probe.header(destination)
    assert.ok(bytes.length >= 64 && bytes.toString("hex", 0, 4) === "7f454c46" && bytes[4] === 2 && bytes[5] === 1 &&
      bytes.readUInt16LE(18) === 62 && bytes.toString("hex", 8, 11) === "414902", "Invalid AppImage runtime")
    await writable(probe, destination, true)
    return { kind: "appimage", platform: "linux", target: destination }
  }
  const owners = await probe.packageOwners(executable)
  assert.ok(owners.length <= 1, "Ambiguous package ownership")
  if (owners.length) return { kind: owners[0], platform: "linux", target }
  const marker = await probe.readMarker(p.join(resources, "update-installation.json"))
  const fhs = target.endsWith("/opt/xneon-launcher") && marker?.schemaVersion === 1 && marker.identifier === appIdentifier && marker.format === "tar-xz"
  const data = context.environment.XDG_DATA_HOME && p.isAbsolute(context.environment.XDG_DATA_HOME) ? context.environment.XDG_DATA_HOME : p.join(home, ".local/share")
  const managed = ["stable", "canary"].some(channel => target === p.join(data, appIdentifier, channel, "app"))
  if (within(home, target) && (fhs || managed)) {
    await writable(probe, target)
    return { kind: "directory", platform: "linux", target }
  }
  return { kind: "manual", platform: "linux", target }
}

export function selectUnixUpdateArtifact(installation: UnixInstallation, manifest: UnixUpdateManifest) {
  assert.equal(installation.platform, manifest.platform, "Update installation platform mismatch")
  if (installation.kind === "manual") throw new Error("update-unsupported-installation")
  if (installation.kind === "directory" || installation.kind === "app-bundle") return manifest.artifact
  const artifact = manifest.distributions[installation.kind]
  assert.ok(artifact, "Signed update does not contain this installation format")
  return artifact
}

/** Только фиксированные argv для polkit; renderer не может передать программу или shell. */
export function unixPackageCommand(kind: PackageKind, file: string, allowDowngrade: boolean) {
  const suffix = { deb: ".deb", rpm: ".rpm", pacman: ".pacman" }[kind]
  assert.ok(p.isAbsolute(file) && !/[\u0000-\u001f\\]/.test(file) && suffix && file.endsWith(suffix), "Invalid package update path")
  const args = kind === "deb" ? ["/usr/bin/apt-get", "install", "--yes", ...(allowDowngrade ? ["--allow-downgrades"] : []), "--", file]
    : kind === "rpm" ? ["/usr/bin/dnf", allowDowngrade ? "downgrade" : "install", "--assumeyes", "--", file]
      : ["/usr/bin/pacman", "-U", "--noconfirm", "--", file]
  return { program: "/usr/bin/pkexec", args }
}
