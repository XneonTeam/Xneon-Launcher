import { spawnSync } from "node:child_process"
import { existsSync, lstatSync, mkdirSync, readFileSync, rmSync, symlinkSync } from "node:fs"
import path from "node:path"

const rootDir = process.cwd()
const npmCommand = process.platform === "win32"
  ? { command: "cmd.exe", args: ["/d", "/s", "/c", "pnpm", "run", "build"] }
  : { command: "pnpm", args: ["run", "build"] }

const localPackages = [
  "xnlc-core",
  "xnlc-mods",
  "xnlc-nbt",
  "xnlc-p2p",
  "xnlc-types",
]

for (const packageDirName of localPackages) {
  const packageDir = path.join(rootDir, "packages", packageDirName)
  const manifestPath = path.join(packageDir, "package.json")

  if (!existsSync(manifestPath)) {
    continue
  }

  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"))
  const packageName = manifest.name

  if (!packageName) {
    throw new Error(`Package ${packageDirName} is missing "name" in package.json`)
  }

  const buildResult = spawnSync(npmCommand.command, npmCommand.args, {
    cwd: packageDir,
    stdio: "inherit",
  })

  if (buildResult.error) {
    console.warn(`[sync-local-xnlc] Build failed for ${packageName}:`, buildResult.error)
    console.warn(`[sync-local-xnlc] Skipping ${packageName} (existing build output is kept).`)
    continue
  }

  if (buildResult.status !== 0) {
    console.warn(`[sync-local-xnlc] Build failed for ${packageName} (exit code ${buildResult.status ?? 1})`)
    console.warn(`[sync-local-xnlc] Skipping ${packageName} (existing build output is kept).`)
    continue
  }

  const targetDir = path.join(rootDir, "node_modules", ...packageName.split("/"))
  const relativeTarget = path.relative(path.dirname(targetDir), packageDir)
  const linkType = process.platform === "win32" ? "junction" : "dir"
  try {
    if (existsSync(targetDir)) {
      const stat = lstatSync(targetDir)
      if (!stat.isSymbolicLink()) {
        rmSync(targetDir, { recursive: true, force: true })
      } else {
        throw new Error("skip")
      }
    } else {
      mkdirSync(path.dirname(targetDir), { recursive: true })
    }
    symlinkSync(relativeTarget, targetDir, linkType)
  } catch (err) {
    if (err.message !== "skip") {
      console.warn(`[sync-local-xnlc] Could not link ${packageName}:`, err)
    }
  }

  console.log(`[sync-local-xnlc] Synced ${packageName}`)
}
