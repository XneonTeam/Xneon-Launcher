import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { writeFile } from "node:fs/promises"
import packageJson from "../package.json"
import { publicationNames } from "./ci-pipeline"

const repository = "MAINER4IK/Xneon-Launcher-bun"

/** Ссылки только на allowlist текущего канала, а не на предполагаемые имена файлов. */
export function releaseNotes(version: string, subjects: string[]): string {
  const names = publicationNames(version)
  const base = `https://github.com/${repository}/releases/download/v${version}/`
  const groups: Record<string, string[]> = { Windows: [], macOS: [], Linux: [] }
  for (const file of names) {
    let platform: string, label: string, logo: string
    if (file.endsWith("-win-x64.exe")) [platform, label, logo] = ["Windows", "Setup-x64", "windows"]
    else if (file.endsWith("-portable.zip")) [platform, label, logo] = ["Windows", "Portable-x64", "windows"]
    else if (file.includes("win-x64") && file.endsWith(".zip")) [platform, label, logo] = ["Windows", "SDK_Setup-x64", "windows"]
    else if (file.endsWith(".dmg")) [platform, label, logo] = ["macOS", `DMG-${file.includes("arm64") ? "Apple_Silicon" : "Intel_x64"}`, "apple"]
    else if (/\.(?:deb|rpm|pacman|AppImage|xz)$/.test(file)) [platform, label, logo] = ["Linux", `${file.endsWith('.tar.xz') ? 'tar.xz' : file.split('.').pop()}-x64`, "linux"]
    else if (file.endsWith("-Setup.tar.gz")) [platform, label, logo] = ["Linux", "SDK_Setup-x64", "linux"]
    else continue
    groups[platform].push(`[![${label}](https://img.shields.io/badge/${label}-2d7d9a?logo=${logo})](${base}${file})`)
  }
  const entries = (type: string) => subjects.filter(subject => new RegExp(`^${type}(?:\\([^)]*\\))?!?:`).test(subject))
    .map(subject => `- ${subject.replace(/^[^:]+:\s*/, "")}`).join("\n") || "- Нет изменений в этой категории."
  return `### Features\n${entries("feat")}\n\n### Bug Fixes\n${entries("fix")}\n\n## Downloads\n\n${Object.entries(groups).map(([name, badges]) => `### ${name}\n${badges.join(" ")}`).join("\n\n")}\n\n[SHA256SUMS.txt](${base}SHA256SUMS.txt)\n`
}

if (import.meta.main) {
  const output = Bun.argv[2]
  assert.ok(output, "Usage: release-notes.ts <output.md>")
  const git = (args: string[]) => {
    const result = spawnSync("git", args, { encoding: "utf8" })
    assert.equal(result.status, 0, result.stderr)
    return result.stdout.trim()
  }
  const previous = git(["describe", "--tags", "--abbrev=0", "--match", "v*", "HEAD^"])
  const subjects = git(["log", "--format=%s", `${previous}..HEAD`]).split("\n")
  await writeFile(output, releaseNotes(packageJson.version, subjects))
}
