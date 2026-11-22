import { expect, test } from "bun:test"
import { detectUnixInstallation, selectUnixUpdateArtifact, unixPackageCommand, type InstallationProbe } from "../../electrobun/main/unix-update-installation"
import { appIdentifier } from "../../electrobun/main/app-identity"

const identity = { identifier: appIdentifier, version: "1.0.8", channel: "stable" as const, hash: "old123" }
const header = Buffer.alloc(64); header.write("\x7fELF"); header[4] = 2; header[5] = 1; header.writeUInt16LE(62, 18); header.write("AI\x02", 8)
function probe(overrides: Partial<InstallationProbe> = {}): InstallationProbe {
  return { canonical: async value => value, readIdentity: async () => identity,
    readMarker: async () => null, header: async () => header, packageOwners: async () => [], writable: async () => true, ...overrides }
}
const linux = { platform: "linux" as const, arch: "x64" as const, executable: "/opt/xneon-launcher/bin/bun", home: "/home/test", environment: {}, identity }
test("AppImage определяется только по согласованным APPIMAGE/APPDIR и ELF type2", async () => {
  const context = { ...linux, executable: "/tmp/.mount_xneon/opt/xneon-launcher/bin/bun", environment: { APPIMAGE: "/home/test/Xneon.AppImage", APPDIR: "/tmp/.mount_xneon" } }
  expect((await detectUnixInstallation(context, probe())).kind).toBe("appimage")
  await expect(detectUnixInstallation({ ...context, environment: { ...context.environment, APPDIR: "/elsewhere" } }, probe())).rejects.toThrow()
  await expect(detectUnixInstallation(context, probe({ header: async () => Buffer.alloc(64) }))).rejects.toThrow()
  await expect(detectUnixInstallation(context, probe({ writable: async () => false }))).rejects.toThrow(/update-no-permission/)
})
test("владение файлом определяет системный пакет deb/rpm/pacman, даже без права записи", async () => {
  for (const kind of ["deb", "rpm", "pacman"] as const) {
    const installed = await detectUnixInstallation(linux, probe({ packageOwners: async () => [kind], writable: async () => false }))
    expect(installed.kind).toBe(kind)
    expect(installed.target).toBe("/opt/xneon-launcher")
  }
})
test("несколько владельцев и чужая bundled identity не допускаются", async () => {
  await expect(detectUnixInstallation(linux, probe({ packageOwners: async () => ["deb", "rpm"] }))).rejects.toThrow()
  await expect(detectUnixInstallation(linux, probe({ readIdentity: async () => ({ ...identity, identifier: "other.app" }) }))).rejects.toThrow()
})
test("TAR.XZ из /opt не становится portable; пользовательский FHS требует marker", async () => {
  expect((await detectUnixInstallation(linux, probe())).kind).toBe("manual")
  const user = { ...linux, executable: "/home/test/Xneon/opt/xneon-launcher/bin/bun" }
  expect((await detectUnixInstallation(user, probe())).kind).toBe("manual")
  const marked = probe({ readMarker: async () => ({ schemaVersion: 1, identifier: appIdentifier, format: "tar-xz" }) })
  expect((await detectUnixInstallation(user, marked)).kind).toBe("directory")
  expect((await detectUnixInstallation(linux, marked)).kind).toBe("manual")
})
test("управляемый каталог сохраняет auto-update после смены stable → canary на том же месте", async () => {
  const next = { ...identity, channel: "canary" as const, version: "1.0.9-pre1" }
  const context = { ...linux, identity: next, executable: `/home/test/.local/share/${appIdentifier}/stable/app/bin/bun` }
  expect((await detectUnixInstallation(context, probe({ readIdentity: async () => next }))).kind).toBe("directory")
})
test("macOS находит реальный app root и не обходит read-only/translocation", async () => {
  const context = { ...linux, platform: "macos" as const, arch: "arm64" as const, executable: "/Applications/Xneon Launcher.app/Contents/MacOS/bun" }
  const installed = await detectUnixInstallation(context, probe())
  expect(installed.kind).toBe("app-bundle")
  expect(installed.target).toBe("/Applications/Xneon Launcher.app")
  await expect(detectUnixInstallation(context, probe({ writable: async () => false }))).rejects.toThrow(/update-no-permission/)
  await expect(detectUnixInstallation({ ...context, executable: "/private/AppTranslocation/abc/Xneon.app/Contents/MacOS/bun" }, probe())).rejects.toThrow()
})
test("команды пакетов фиксированы, пути не интерпретируются shell", () => {
  expect(unixPackageCommand("deb", "/private/a b.deb", false)).toEqual({ program: "/usr/bin/pkexec", args: ["/usr/bin/apt-get", "install", "--yes", "--", "/private/a b.deb"] })
  expect(unixPackageCommand("deb", "/private/a.deb", true).args).toContain("--allow-downgrades")
  expect(unixPackageCommand("rpm", "/private/a.rpm", true).args.slice(0, 2)).toEqual(["/usr/bin/dnf", "downgrade"])
  expect(unixPackageCommand("pacman", "/private/a.pacman", false).args).toEqual(["/usr/bin/pacman", "-U", "--noconfirm", "--", "/private/a.pacman"])
  for (const file of ["--evil.deb", "relative.deb", "/bad\u0000.deb", "/wrong.rpm"]) expect(() => unixPackageCommand("deb", file, false)).toThrow()
})
test("стратегия получает только свой подписанный формат", () => {
  const artifact = { file: "native.tar.zst", format: "electrobun-tar-zstd", downloadSize: 1, downloadSha256: "a".repeat(64) }
  const appimage = { ...artifact, file: "new.AppImage", format: "appimage" }
  const manifest: any = { platform: "linux", arch: "x64", artifact, distributions: { appimage } }
  expect(selectUnixUpdateArtifact({ kind: "appimage", platform: "linux", target: "/a" }, manifest)).toEqual(appimage)
  expect(() => selectUnixUpdateArtifact({ kind: "deb", platform: "linux", target: "/a" }, manifest)).toThrow()
  expect(() => selectUnixUpdateArtifact({ kind: "app-bundle", platform: "macos", target: "/a" }, manifest)).toThrow()
})
