import assert from "node:assert/strict"
import { realpath } from "node:fs/promises"
import path from "node:path"

async function installationPath(file: string): Promise<string> {
  try { return await realpath(file) } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error
    const parent = path.dirname(file)
    assert.notEqual(parent, file, "Invalid update installation root")
    return path.join(await installationPath(parent), path.basename(file))
  }
}

/** Проверяем реальные пути до ready: runtime, snapshot и данные не должны исчезнуть вместе с app/mount. */
export async function assertUnixUpdateStorageOutsideInstallation(roots: string[], profile: string, data: string) {
  assert.ok(roots.length > 0, "Missing update installation root")
  const storage = await Promise.all([profile, data].map(file => realpath(file)))
  for (const root of roots) {
    assert.ok(path.isAbsolute(root), "Invalid update installation root")
    const canonical = await installationPath(root)
    for (const file of storage) {
      const relative = path.relative(canonical, file)
      assert.ok(relative && (relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)), "update-storage-inside-installation")
    }
  }
}
