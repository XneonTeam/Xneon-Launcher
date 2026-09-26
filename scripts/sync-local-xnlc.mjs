import { spawnSync } from "node:child_process"
import { existsSync, lstatSync, mkdirSync, readFileSync, readlinkSync, rmSync, symlinkSync } from "node:fs"
import path from "node:path"

const rootDir = process.cwd()
const npmCommand = process.platform === "win32"
  ? { command: "cmd.exe", args: ["/d", "/s", "/c", "pnpm", "run", "build"] }
  : { command: "pnpm", args: ["run", "build"] }

const localPackages = [
  "xnlc-core",
  "xnlc-mods",
  "xnlc-nbt",
  "xnlc-servers",
  "xnlc-skins",
  "xnlc-types",
]

function linkPackage(targetDir, sourceDir, label) {
  const linkType = process.platform === "win32" ? "junction" : "dir"
  const relativeTarget = path.relative(path.dirname(targetDir), sourceDir)
  try {
    if (existsSync(targetDir)) {
      const stat = lstatSync(targetDir)
      if (stat.isSymbolicLink()) {
        const currentTarget = readlinkSync(targetDir)
        const normalizedCurrent = path.resolve(path.dirname(targetDir), currentTarget)
        if (normalizedCurrent === path.normalize(sourceDir)) {
          return false // already correct
        }
        console.log(`[sync-local-xnlc] ${label} symlink points to ${currentTarget}, replacing with local package`)
      }
      rmSync(targetDir, { recursive: true, force: true })
    } else {
      mkdirSync(path.dirname(targetDir), { recursive: true })
    }
    symlinkSync(relativeTarget, targetDir, linkType)
  } catch (err) {
    console.warn(`[sync-local-xnlc] Could not link ${label}:`, err)
  }
  return true
}

// Phase 1: Link all packages and their cross-deps BEFORE building
for (const packageDirName of localPackages) {
  const packageDir = path.join(rootDir, "packages", packageDirName)
  const manifestPath = path.join(packageDir, "package.json")
  if (!existsSync(manifestPath)) continue

  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"))
  const packageName = manifest.name
  if (!packageName) throw new Error(`Package ${packageDirName} is missing "name"`)

  // Link into root node_modules
  const targetDir = path.join(rootDir, "node_modules", ...packageName.split("/"))
  const changed = linkPackage(targetDir, packageDir, packageName)
  if (changed) console.log(`[sync-local-xnlc] ${packageName} symlinked`)
  else console.log(`[sync-local-xnlc] ${packageName} symlink already points to local package, skipping`)

  // Link cross-deps into this package's own node_modules
  const deps = { ...manifest.dependencies, ...manifest.devDependencies }
  for (const [depName] of Object.entries(deps)) {
    if (!depName.startsWith("@xnlc/") || depName === packageName) continue
    const localDepDirName = depName.replace("@xnlc/", "xnlc-")
    const localDepDir = path.join(rootDir, "packages", localDepDirName)
    if (!existsSync(path.join(localDepDir, "package.json"))) continue
    const depTarget = path.join(packageDir, "node_modules", ...depName.split("/"))
    if (linkPackage(depTarget, localDepDir, `${depName} inside ${packageName}`)) {
      console.log(`[sync-local-xnlc]   → linked ${depName} inside ${packageName}`)
    }
  }
}

// Phase 2: Build each package
for (const packageDirName of localPackages) {
  const packageDir = path.join(rootDir, "packages", packageDirName)
  const manifestPath = path.join(packageDir, "package.json")
  if (!existsSync(manifestPath)) continue

  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"))
  const packageName = manifest.name

  const buildResult = spawnSync(npmCommand.command, npmCommand.args, {
    cwd: packageDir,
    stdio: "inherit",
  })

  if (buildResult.error) {
    console.warn(`[sync-local-xnlc] Build failed for ${packageName}:`, buildResult.error)
    continue
  }
  if (buildResult.status !== 0) {
    console.warn(`[sync-local-xnlc] Build failed for ${packageName} (exit code ${buildResult.status ?? 1})`)
    continue
  }

  console.log(`[sync-local-xnlc] Built ${packageName}`)
}
