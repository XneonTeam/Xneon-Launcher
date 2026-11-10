import path from "node:path"

const applicationResources = path.resolve(path.dirname(process.execPath), "..", "Resources", "app")

export function bundledWorker(name: "minecraft-launch-worker" | "scan-worker" | "upload-worker") {
  return path.join(applicationResources, "bun", "workers", name + ".js")
}

export const launcherViewAssets = path.join(applicationResources, "views", "launcher")
