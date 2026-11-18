import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { writeFile } from "node:fs/promises"
import packageJson from "../package.json"
import { publicationNames } from "./ci-pipeline"

const repository = "MAINER4IK/Xneon-Launcher-bun"
// Simple Icons больше не отдаёт логотип Windows по имени; встраиваем SVG в Shields.
const windowsLogo = encodeURIComponent('data:image/svg+xml;base64,' + Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path fill="white" d="M1 1h10v10H1zm12 0h10v10H13zM1 13h10v10H1zm12 0h10v10H13z"/></svg>').toString('base64'))

/** Ссылки только на allowlist текущего канала, а не на предполагаемые имена файлов. */
export function releaseNotes(version: string, subjects: string[]): string {
  const names = publicationNames(version)
  const base = `https://github.com/${repository}/releases/download/v${version}/`
  const groups: Record<string, string[]> = { Windows: [], macOS: [], Linux: [] }
  const technical: string[] = []
  const ordered = [...names].sort((a, b) => Number(!a.endsWith('.exe')) - Number(!b.endsWith('.exe')) || a.localeCompare(b))
  for (const file of ordered) {
    if ((file.endsWith('-setup.zip') || file.endsWith('-setup.tar.gz')) && !version.includes('-')) {
      technical.push(file)
      continue
    }
    let platform: string, label: string, logo: string
    if (file.endsWith("-win-x64.exe")) [platform, label, logo] = ["Windows", "Setup-x64", windowsLogo]
    else if (file.endsWith("-portable.zip")) [platform, label, logo] = ["Windows", "Portable-x64", windowsLogo]
    else if (file.includes("win-x64") && file.endsWith(".zip")) [platform, label, logo] = ["Windows", "SDK_Setup-x64", windowsLogo]
    else if (file.endsWith(".dmg")) [platform, label, logo] = ["macOS", `DMG-${file.includes("arm64") ? "Apple_Silicon" : "Intel_x64"}`, "apple"]
    else if (/\.(?:deb|rpm|pacman|AppImage|xz)$/.test(file)) [platform, label, logo] = ["Linux", `${file.endsWith('.tar.xz') ? 'tar.xz' : file.split('.').pop()}-x64`, "linux"]
    else if (file.endsWith("-setup.tar.gz")) [platform, label, logo] = ["Linux", "SDK_Setup-x64", "linux"]
    else { technical.push(file); continue }
    groups[platform].push(`[![${label}](https://img.shields.io/badge/${label}-2d7d9a?logo=${logo})](${base}${file})`)
  }
  const entries = (type: string) => subjects.filter(subject => new RegExp(`^${type}(?:\\([^)]*\\))?!?:`).test(subject))
    .map(subject => `- ${subject.replace(/^[^:]+:\s*/, "").replace(/\s*\((?:GREEN|RED)\)$/, "")}`).join("\n") || "- Нет изменений в этой категории."
  return `## Downloads\n\n${Object.entries(groups).filter(([, badges]) => badges.length).map(([name, badges]) => `### ${name}\n${badges.join(" ")}`).join("\n\n")}\n\n### Features\n${entries("feat")}\n\n### Bug Fixes\n${entries("fix")}\n\n<details>\n<summary>Служебные файлы и дополнительные SDK-установщики</summary>\n\n${[...technical, 'SHA256SUMS.txt'].map(file => `- [${file}](${base}${file})`).join('\n')}\n\n</details>\n`
}

if (import.meta.main) {
  const output = Bun.argv[2]
  assert.ok(output, "Usage: release-notes.ts <output.md>")
  const git = (args: string[]) => {
    const result = spawnSync("git", args, { encoding: "utf8" })
    assert.equal(result.status, 0, result.stderr)
    return result.stdout.trim()
  }
  const previous = spawnSync("git", ["describe", "--tags", "--abbrev=0", "--match", "v*", "HEAD^"], { encoding: "utf8" })
  // После очистки тегов первый релиз использует всю достижимую историю.
  const range = previous.status === 0 ? `${previous.stdout.trim()}..HEAD` : "HEAD"
  const subjects = git(["log", "--format=%s", range]).split("\n")
  await writeFile(output, releaseNotes(packageJson.version, subjects))
}
