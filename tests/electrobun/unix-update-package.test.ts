import { expect, test } from "bun:test"
import { mkdtemp, writeFile, rm } from "node:fs/promises"
import path from "node:path"
import os from "node:os"
import { verifyUnixPackageMetadata, installUnixPackage } from "../../electrobun/main/unix-update-package"

const metadata = {
  deb: "Package: xneon-launcher\nVersion: 1.0.9~pre1\nArchitecture: amd64\n",
  rpm: "xneon-launcher\n1.0.9\n0.pre1\nx86_64\n",
  pacman: "pkgname = xneon-launcher\npkgver = 1.0.9pre1-1\narch = x86_64\ndepend = gtk3\n",
}
for (const kind of ["deb", "rpm", "pacman"] as const) test(`metadata ${kind} проверяется до privileged install`, async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "xneon-package-test-")), file = path.join(directory, `package.${kind}`)
  try {
    const bytes = Buffer.alloc(128)
    if (kind === "deb") bytes.write("!<arch>\ndebian-binary")
    else bytes.writeUInt32BE(kind === "rpm" ? 0xedabeedb : 0x28b52ffd)
    await writeFile(file, bytes)
    await verifyUnixPackageMetadata(file, kind, "1.0.9-pre1", async (program, args) => {
      expect(program).toBe(kind === "deb" ? "/usr/bin/dpkg-deb" : kind === "rpm" ? "/usr/bin/rpm" : "/usr/bin/bsdtar")
      expect(args).toContain(file)
      return metadata[kind]
    })
    for (const changed of [metadata[kind].replace("xneon-launcher", "other-package"), metadata[kind].replace(/amd64|x86_64/, "aarch64"), metadata[kind].replace("1.0.9", "1.0.8")]) {
      await expect(verifyUnixPackageMetadata(file, kind, "1.0.9-pre1", async () => changed)).rejects.toThrow()
    }
  } finally { await rm(directory, { recursive: true, force: true }) }
})
test("установка использует только фиксированный polkit argv; отмена и ошибка не становятся успехом", async () => {
  await installUnixPackage("deb", "/cache/package.deb", false, async command => {
    expect(command).toEqual({ program: "/usr/bin/pkexec", args: ["/usr/bin/apt-get", "install", "--yes", "--", "/cache/package.deb"] })
    return 0
  })
  for (const code of [1, 126, 127]) await expect(installUnixPackage("rpm", "/cache/package.rpm", true, async () => code)).rejects.toThrow()
})
