// Linux-пакеты: нативные версии, проверка metadata до privileged install,
// фиксированный argv, проверка установленного состояния и транзакция пакета.
import { expect, test } from "bun:test"
import { mkdtemp, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { verifyUnixPackageMetadata, verifyInstalledUnixPackage, installUnixPackage } from "../../electrobun/main/unix-update-package"
import { linuxPackageVersion } from "../../electrobun/main/unix-package-version"
import { applyUnixPackageTransaction, type UnixPackageTransactionPorts } from "../../electrobun/main/unix-package-transaction"

const metadata = {
  deb: "Package: xneon-launcher\nVersion: 1.0.9~pre1\nArchitecture: amd64\n",
  rpm: "xneon-launcher\n1.0.9\n0.pre1\nx86_64\n",
  pacman: "pkgname = xneon-launcher\npkgver = 1.0.9pre1-1\narch = x86_64\ndepend = gtk3\n",
}

test("stable/pre/beta выражаются нативными версиями пакетных менеджеров, невалидная версия отвергается", () => {
  expect(linuxPackageVersion("1.0.9")).toEqual({ deb: "1.0.9", rpmVersion: "1.0.9", rpmRelease: "1", pacmanVersion: "1.0.9", pacmanRelease: "1" })
  expect(linuxPackageVersion("1.0.9-pre2")).toEqual({ deb: "1.0.9~pre2", rpmVersion: "1.0.9", rpmRelease: "0.pre2", pacmanVersion: "1.0.9pre2", pacmanRelease: "1" })
  expect(linuxPackageVersion("1.0.9-beta1").deb).toBe("1.0.9~beta1")
  for (const version of ["1.0.9;id", "../1.0.9", "1.0.9-pre0", "1.0.9-rc1", "01.0.9"]) expect(() => linuxPackageVersion(version)).toThrow()
})

test("metadata deb/rpm/pacman проверяется до privileged install: пакет, архитектура и версия", async () => {
  for (const kind of ["deb", "rpm", "pacman"] as const) {
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
  }
})

test("установка использует только фиксированный polkit argv; отмена и ошибка не становятся успехом", async () => {
  await installUnixPackage("deb", "/cache/package.deb", false, async command => {
    expect(command).toEqual({ program: "/usr/bin/pkexec", args: ["/usr/bin/apt-get", "install", "--yes", "--", "/cache/package.deb"] })
    return 0
  })
  for (const code of [1, 126, 127]) await expect(installUnixPackage("rpm", "/cache/package.rpm", true, async () => code)).rejects.toThrow()
})

test("успешный exit manager не заменяет проверку установленной версии и configured state", async () => {
  await verifyInstalledUnixPackage("deb", "1.0.9-pre1", async (program, args) => {
    expect(program).toBe("/usr/bin/dpkg-query"); expect(args).toContain("xneon-launcher")
    return metadata.deb + "Status: install ok installed\n"
  })
  await expect(verifyInstalledUnixPackage("deb", "1.0.9-pre1", async () => metadata.deb + "Status: install ok half-configured\n")).rejects.toThrow()
  await verifyInstalledUnixPackage("rpm", "1.0.9-pre1", async () => metadata.rpm)
  await verifyInstalledUnixPackage("pacman", "1.0.9-pre1", async () => "xneon-launcher 1.0.9pre1-1\n")
  await expect(verifyInstalledUnixPackage("pacman", "1.0.9-pre1", async () => "xneon-launcher 1.0.8-1\n")).rejects.toThrow()
})

function packageFixture(patch: Partial<UnixPackageTransactionPorts> = {}) {
  const events: string[] = []
  const step = (name: string) => async () => { events.push(name) }
  const ports: UnixPackageTransactionPorts = { verifyNextPackage: step("verify-file-B"), ready: step("ready"),
    waitForParentExit: step("exit-A"), backupProfile: step("backup-db"), installNext: step("install-B"), verifyNextInstalled: step("verify-B"),
    startNext: async () => { events.push("start-B"); return { pid: 100 } }, waitHealthy: async () => { events.push("health-B"); return true }, stopNext: step("stop-B"),
    record: async phase => { events.push("phase:" + phase) }, ...patch }
  return { events, ports }
}

test("пакет B ставится только после проверки файла и выхода A, затем проверяется и подтверждается", async () => {
  const app = packageFixture()
  expect((await applyUnixPackageTransaction(app.ports)).status).toBe("committed")
  expect(app.events.indexOf("verify-file-B")).toBeLessThan(app.events.indexOf("ready"))
  expect(app.events.indexOf("exit-A")).toBeLessThan(app.events.indexOf("install-B"))
  expect(app.events.indexOf("backup-db")).toBeLessThan(app.events.indexOf("install-B"))
  expect(app.events.indexOf("health-B")).toBeLessThan(app.events.indexOf("phase:committed"))
})

test("неудачный B, отмена polkit и сбой до установки фиксируют failed без автоматического отката", async () => {
  const cases: Array<[string, Partial<UnixPackageTransactionPorts>, RegExp]> = [
    ["нездоровый B", { waitHealthy: async () => false }, /update-startup-failed/],
    ["отмена polkit", { installNext: async () => { throw new Error("update-install-cancelled") } }, /update-install-cancelled/],
    ["сбой snapshot", { backupProfile: async () => { throw new Error("database snapshot failed") } }, /database snapshot failed/],
  ]
  for (const [name, patch, error] of cases) {
    const app = packageFixture(patch)
    await expect(applyUnixPackageTransaction(app.ports), name).rejects.toThrow(error)
    expect(app.events).not.toContain("phase:rolling-back")
    expect(app.events).not.toContain("phase:rolled-back")
    expect(app.events).not.toContain("phase:recovery-required")
    expect(app.events.at(-1)).toBe("phase:failed")
  }
  const unhealthy = packageFixture({ waitHealthy: async () => false })
  await expect(applyUnixPackageTransaction(unhealthy.ports)).rejects.toThrow()
  expect(unhealthy.events.indexOf("stop-B")).toBeLessThan(unhealthy.events.indexOf("phase:failed"))
})