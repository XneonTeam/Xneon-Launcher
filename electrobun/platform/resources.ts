import path from "node:path"
import { existsSync } from "node:fs"

const applicationResources = path.resolve(path.dirname(process.execPath), "..", "Resources", "app")

export function bundledWorker(name: "minecraft-launch-worker" | "archive-worker") {
  const filename = name === "archive-worker" ? "archive.worker.js" : name + ".js"
  return path.join(applicationResources, "bun", "workers", filename)
}

export const launcherViewAssets = path.join(applicationResources, "views", "launcher")

/** В бандле не подменяем отсутствующую библиотеку копией из исходников или CWD. */
export function nativeFileDialogLibraryPath() {
  const target = `${process.platform}-${process.arch}`
  const libraries: Record<string, string> = {
    "win32-x64": "nfd.dll",
    "darwin-arm64": "libnfd.dylib",
    "darwin-x64": "libnfd.dylib",
    "linux-x64": "libnfd.so",
  }
  const filename = libraries[target]
  if (!filename) throw new Error("Unsupported native file dialog platform: " + target)
  const directory = existsSync(applicationResources)
    ? path.join(applicationResources, "native", "nfd")
    : path.resolve(import.meta.dir, "..", "..", "assets", "native", "nfd")
  return path.join(directory, target, filename)
}
