import assert from "node:assert/strict"
import { execFile, spawn } from "node:child_process"
import { lstat } from "node:fs/promises"
import path from "node:path"
import { promisify } from "node:util"
import { linuxPackageVersion } from "./unix-package-version"
import { unixPackageCommand, type PackageKind } from "./unix-update-installation"
import { UPDATE_MAX_BYTES } from "./update-manifest"

type Command = { program: string; args: string[] }
type Query = (program: string, args: string[]) => Promise<string>
type Runner = (command: Command) => Promise<number>
const execute = promisify(execFile)
const query: Query = async (program, args) => {
  const env = { ...process.env }
  for (const key of Object.keys(env)) if (/^(?:LD_|DYLD_)/.test(key)) delete env[key]
  const result = await execute(program, args, { encoding: "utf8", env, timeout: 60_000, maxBuffer: 64 * 1024 })
  return result.stdout
}
function fields(text: string, separator: ":" | "=", required: string[]) {
  const result: Record<string, string> = {}
  for (const line of text.split(/\r?\n/)) {
    const position = line.indexOf(separator)
    if (position < 0) continue
    const key = line.slice(0, position).trim()
    if (!required.includes(key)) continue
    assert.ok(!Object.hasOwn(result, key), "Duplicate package identity field")
    result[key] = line.slice(position + 1).trim()
  }
  assert.ok(required.every(key => Object.hasOwn(result, key)), "Missing package identity metadata")
  return result
}

/** Вызывается только после SHA/Ed25519 проверки файла; query ничего не распаковывает в систему. */
export async function verifyUnixPackageMetadata(file: string, kind: PackageKind, version: string, read: Query = query) {
  assert.ok(path.isAbsolute(file) && !/[\u0000-\u001f]/.test(file), "Invalid package metadata path")
  const info = await lstat(file)
  assert.ok(info.isFile() && info.size > 32 && info.size <= UPDATE_MAX_BYTES, "Invalid package metadata file")
  const header = Buffer.from(await Bun.file(file).slice(0, 32).arrayBuffer()), native = linuxPackageVersion(version)
  if (kind === "deb") {
    assert.equal(header.toString("ascii", 0, 21), "!<arch>\ndebian-binary", "Invalid DEB package header")
    const value = fields(await read("/usr/bin/dpkg-deb", ["--field", file, "Package", "Version", "Architecture"]), ":", ["Package", "Version", "Architecture"])
    assert.ok(value.Package === "xneon-launcher" && value.Version === native.deb && value.Architecture === "amd64", "DEB identity/version/architecture mismatch")
  } else if (kind === "rpm") {
    assert.equal(header.readUInt32BE(0), 0xedabeedb, "Invalid RPM package header")
    const values = (await read("/usr/bin/rpm", ["-qp", "--qf", "%{NAME}\n%{VERSION}\n%{RELEASE}\n%{ARCH}\n", file])).trim().split(/\r?\n/)
    assert.deepEqual(values, ["xneon-launcher", native.rpmVersion, native.rpmRelease, "x86_64"], "RPM identity/version/architecture mismatch")
  } else {
    assert.equal(kind, "pacman", "Unsupported package manager")
    assert.equal(header.readUInt32BE(0), 0x28b52ffd, "Invalid Pacman package header")
    const value = fields(await read("/usr/bin/bsdtar", ["-xOf", file, ".PKGINFO"]), "=", ["pkgname", "pkgver", "arch"])
    assert.ok(value.pkgname === "xneon-launcher" && value.pkgver === `${native.pacmanVersion}-${native.pacmanRelease}` && value.arch === "x86_64", "Pacman identity/version/architecture mismatch")
  }
}

async function privileged(command: Command, logFd?: number): Promise<number> {
  assert.equal(process.platform, "linux", "Native Linux package host required")
  const env: NodeJS.ProcessEnv = { PATH: "/usr/sbin:/usr/bin:/sbin:/bin" }
  for (const key of ["HOME", "LANG", "LC_ALL", "DISPLAY", "WAYLAND_DISPLAY", "XAUTHORITY", "DBUS_SESSION_BUS_ADDRESS", "XDG_RUNTIME_DIR"]) {
    if (process.env[key]) env[key] = process.env[key]
  }
  return new Promise<number>((resolve, reject) => {
    const child = spawn(command.program, command.args, { env, stdio: ["ignore", logFd ?? "ignore", logFd ?? "ignore"] })
    child.once("error", () => reject(new Error("update-privileges-required")))
    // После начала root-транзакции не убиваем manager по таймауту, оставляя полуустановленный пакет.
    child.once("close", (code, signal) => signal || code === null ? reject(new Error("update-package-manager-failed")) : resolve(code))
  })
}
export async function installUnixPackage(kind: PackageKind, file: string, allowDowngrade: boolean, runner?: Runner, logFd?: number) {
  const command = unixPackageCommand(kind, file, allowDowngrade)
  const status = await (runner ?? (value => privileged(value, logFd)))(command)
  if (status === 126) throw new Error("update-install-cancelled")
  if (status === 127) throw new Error("update-privileges-required")
  if (status !== 0) throw new Error("update-package-manager-failed")
}

export async function verifyInstalledUnixPackage(kind: PackageKind, version: string, read: Query = query) {
  const native = linuxPackageVersion(version)
  if (kind === "deb") {
    const output = await read("/usr/bin/dpkg-query", ["--show", "--showformat", "Package: ${Package}\nVersion: ${Version}\nArchitecture: ${Architecture}\nStatus: ${Status}\n", "xneon-launcher"])
    const value = fields(output, ":", ["Package", "Version", "Architecture", "Status"])
    assert.ok(value.Package === "xneon-launcher" && value.Version === native.deb && value.Architecture === "amd64" && value.Status === "install ok installed", "Installed DEB is not the configured signed version")
  } else if (kind === "rpm") {
    const output = await read("/usr/bin/rpm", ["-q", "--qf", "%{NAME}\n%{VERSION}\n%{RELEASE}\n%{ARCH}\n", "xneon-launcher"])
    assert.deepEqual(output.trim().split(/\r?\n/), ["xneon-launcher", native.rpmVersion, native.rpmRelease, "x86_64"], "Installed RPM differs from signed version")
  } else {
    assert.equal(kind, "pacman", "Unsupported package manager")
    const output = await read("/usr/bin/pacman", ["-Q", "xneon-launcher"])
    assert.equal(output.trim(), `xneon-launcher ${native.pacmanVersion}-${native.pacmanRelease}`, "Installed Pacman package differs from signed version")
  }
}
