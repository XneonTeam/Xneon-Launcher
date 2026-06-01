import { spawnSync } from "node:child_process"
import { existsSync, lstatSync, readFileSync, rmSync, symlinkSync } from "node:fs"
import path from "node:path"

const rootDir = process.cwd()
const npmCommand = process.platform === "win32"
  ? { command: "cmd.exe", args: ["/d", "/s", "/c", "npm", "run", "build"] }
  : { command: "npm", args: ["run", "build"] }

const localPackages = [
  "xnlc-core",
  "xnlc-mods",
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
    throw buildResult.error
  }

  if (buildResult.status !== 0) {
    process.exit(buildResult.status ?? 1)
  }

  const targetDir = path.join(rootDir, "node_modules", ...packageName.split("/"))
  if (existsSync(targetDir)) {
    try {
      if (!lstatSync(targetDir).isSymbolicLink()) {
        rmSync(targetDir, { recursive: true, force: true })
        const relativeTarget = path.relative(path.dirname(targetDir), packageDir)
        symlinkSync(relativeTarget, targetDir, "dir")
      }
    } catch (err) {
      console.warn(`[sync-local-xnlc] Could not relink ${packageName}:`, err)
    }
  }

  console.log(`[sync-local-xnlc] Synced ${packageName}`)
}
