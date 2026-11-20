import { expect, test } from "bun:test"
import { mkdtemp, mkdir, rm, symlink } from "node:fs/promises"
import path from "node:path"
import os from "node:os"
import { assertUnixUpdateStorageOutsideInstallation } from "../../electrobun/main/unix-update-storage"

async function fixture(action: (root: string) => Promise<void>) {
  const root = await mkdtemp(path.join(os.tmpdir(), "xneon-update-storage-"))
  try { await action(root) } finally { await rm(root, { recursive: true, force: true }) }
}
test("профиль и перенесённые данные не могут находиться внутри заменяемого app", () => fixture(async root => {
  const app = path.join(root, "Launcher.app"), outside = path.join(root, "profile"), inside = path.join(app, "data")
  await mkdir(inside, { recursive: true }); await mkdir(outside)
  for (const [profile, data] of [[inside, outside], [outside, inside], [app, outside], [outside, app]]) {
    await expect(assertUnixUpdateStorageOutsideInstallation([app], profile, data)).rejects.toThrow(/update-storage-inside-installation/)
  }
}))
test("symlink снаружи не скрывает данные внутри app; mounted AppImage тоже защищён", () => fixture(async root => {
  const app = path.join(root, "AppDir"), data = path.join(app, "data"), profile = path.join(root, "profile"), alias = path.join(root, "alias")
  await mkdir(data, { recursive: true }); await mkdir(profile)
  await symlink(data, alias, process.platform === "win32" ? "junction" : "dir")
  await expect(assertUnixUpdateStorageOutsideInstallation([app], profile, alias)).rejects.toThrow(/update-storage-inside-installation/)
}))
test("соседний prefix и app внутри общего data-root допустимы", () => fixture(async root => {
  const app = path.join(root, "app"), profile = path.join(root, "app-profile")
  await mkdir(app); await mkdir(profile)
  await assertUnixUpdateStorageOutsideInstallation([app], profile, root)
  // При package recovery target может быть временно удалён менеджером пакетов.
  await assertUnixUpdateStorageOutsideInstallation([path.join(root, "removed-app")], profile, root)
  await expect(assertUnixUpdateStorageOutsideInstallation([app], profile, path.join(root, "missing"))).rejects.toThrow()
}))
