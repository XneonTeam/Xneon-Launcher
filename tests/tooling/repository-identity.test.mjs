import { describe, expect, test } from "bun:test"
import fs from "node:fs"
import path from "node:path"
import { loadReactModule } from "../helpers/react-module.mjs"

const root = path.resolve(import.meta.dir, "../..")
const OFFICIAL = "XneonTeam/Xneon-Launcher"
const PERSONAL_FORK = "MAINER4IK/Xneon-Launcher-bun"
const ARBITRARY_FORK = "someone/xneon-launcher-fork"
/** Публичный RetroAuth — внешняя зависимость с закреплённым SHA-256, не репозиторий сборки. */
const RETRO_AUTH = "MAINER4IK/RetroAuth-injector"

const urls = repository => ({
  stable: `https://github.com/${repository}/releases/latest/download`,
  canary: `https://github.com/${repository}/releases/download/canary`,
})

function walk(directory) {
  const output = []
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name === ".git" || entry.name.startsWith("dist")) continue
    const full = path.join(directory, entry.name)
    if (entry.isDirectory()) output.push(...walk(full))
    else output.push(full)
  }
  return output
}

const productionFiles = [
  ...walk(path.join(root, "electrobun")),
  ...walk(path.join(root, "components")),
  ...walk(path.join(root, "lib")),
  ...walk(path.join(root, "src")),
  ...walk(path.join(root, "scripts")),
  ...walk(path.join(root, "docs")),
  ...walk(path.join(root, ".github")),
  ...walk(path.join(root, "packages")),
  path.join(root, "README.md"),
  path.join(root, "package.json"),
  path.join(root, "AGENTS.md"),
]

/** Загружает release-пайплайн с подменённым окружением, как это делает GitHub Actions. */
function pipelineFor(repository) {
  return loadReactModule(new URL("../../scripts/ci-pipeline.ts", import.meta.url), {
    "../package.json": { version: "1.2.3" },
  }, { Bun, Buffer, process: { env: repository ? { GITHUB_REPOSITORY: repository } : {} } })
}

describe("repository identity: чистые правила", () => {
  test("нормализация owner/repo отвергает мусор и лишние сегменты", async () => {
    const { normalizeRepositoryIdentity } = await import("../../lib/repository-identity.ts")
    expect(normalizeRepositoryIdentity("Owner/Repo")).toBe("Owner/Repo")
    expect(normalizeRepositoryIdentity("/Owner/Repo.git/")).toBe("Owner/Repo")
    for (const value of ["", "owner", "owner/repo/extra", "../evil", "owner/..", 42, null]) {
      expect(() => normalizeRepositoryIdentity(value)).toThrow()
    }
  })

  test("GitHub remote разбирается из HTTPS, SSH и SCP-подобного вида", async () => {
    const { repositoryFromGitRemoteUrl } = await import("../../lib/repository-identity.ts")
    expect(repositoryFromGitRemoteUrl("https://github.com/Owner/Repo.git")).toBe("Owner/Repo")
    expect(repositoryFromGitRemoteUrl("git@github.com:Owner/Repo.git")).toBe("Owner/Repo")
    expect(repositoryFromGitRemoteUrl("ssh://git@github.com/Owner/Repo.git")).toBe("Owner/Repo")
    expect(repositoryFromGitRemoteUrl("https://gitlab.com/Owner/Repo.git")).toBeNull()
    expect(repositoryFromGitRemoteUrl("https://github.com/Owner")).toBeNull()
    expect(repositoryFromGitRemoteUrl("not a remote")).toBeNull()
  })

  test("Stable и Canary строятся от переданного репозитория, а не от константы", async () => {
    const { updateBaseUrlsFor, expectedUpdateBaseUrlFor, releaseDownloadPathFor } = await import("../../lib/repository-identity.ts")
    for (const repository of [OFFICIAL, PERSONAL_FORK, ARBITRARY_FORK]) {
      expect(updateBaseUrlsFor(repository)).toEqual(urls(repository))
      expect(expectedUpdateBaseUrlFor(repository, "stable")).toBe(urls(repository).stable)
      expect(expectedUpdateBaseUrlFor(repository, "canary")).toBe(urls(repository).canary)
      expect(releaseDownloadPathFor(repository)).toBe(`/${repository}/releases/download/`)
    }
    expect(updateBaseUrlsFor(OFFICIAL).stable).not.toBe(updateBaseUrlsFor(PERSONAL_FORK).stable)
  })

  test("allowlist редиректов разрешает только репозиторий текущей сборки", async () => {
    const { isAllowedUpdateRedirectFor } = await import("../../lib/repository-identity.ts")
    const officialRelease = `https://github.com/${OFFICIAL}/releases/download/v1.0.10/stable-win-x64-update-v2.json`
    expect(isAllowedUpdateRedirectFor(new URL(officialRelease), OFFICIAL)).toBe(true)
    expect(isAllowedUpdateRedirectFor(new URL(officialRelease), PERSONAL_FORK)).toBe(false)
    expect(isAllowedUpdateRedirectFor(new URL(`https://github.com/${ARBITRARY_FORK}/releases/download/v1/x.json`), ARBITRARY_FORK)).toBe(true)
    expect(isAllowedUpdateRedirectFor(new URL(officialRelease), ARBITRARY_FORK)).toBe(false)

    const assets = [
      "https://release-assets.githubusercontent.com/github-production-release-asset/1/2?sp=r",
      "https://objects.githubusercontent.com/x",
    ]
    for (const url of assets) expect(isAllowedUpdateRedirectFor(new URL(url), OFFICIAL)).toBe(true)

    const rejected = [
      `http://github.com/${OFFICIAL}/releases/download/v1/x.json`,
      `https://github.com:8443/${OFFICIAL}/releases/download/v1/x.json`,
      `https://github.com/${OFFICIAL}/releases/latest/download/x.json`,
      "https://github.com/other/repo/releases/download/v1/x.json",
      "https://evil.example/x.json",
      "https://github.com.evil.example/XneonTeam/Xneon-Launcher/releases/download/v1/x.json",
    ]
    for (const url of rejected) expect(isAllowedUpdateRedirectFor(new URL(url), OFFICIAL)).toBe(false)
  })
})

describe("repository identity: разрешение источника сборки", () => {
  test("GITHUB_REPOSITORY имеет приоритет над XNLC_REPOSITORY и git remote", async () => {
    const { repositoryFromEnvironment, resolveRepositoryIdentity } = await import("../../scripts/repository-identity.ts")
    expect(repositoryFromEnvironment({ GITHUB_REPOSITORY: OFFICIAL, XNLC_REPOSITORY: ARBITRARY_FORK })).toBe(OFFICIAL)
    expect(resolveRepositoryIdentity({ env: { GITHUB_REPOSITORY: OFFICIAL }, fromGit: () => PERSONAL_FORK })).toBe(OFFICIAL)
  })

  test("без GITHUB_REPOSITORY используется XNLC_REPOSITORY, затем git remote", async () => {
    const { repositoryFromEnvironment, resolveRepositoryIdentity } = await import("../../scripts/repository-identity.ts")
    expect(repositoryFromEnvironment({})).toBeNull()
    expect(repositoryFromEnvironment({ GITHUB_REPOSITORY: "not a repo", XNLC_REPOSITORY: ARBITRARY_FORK })).toBe(ARBITRARY_FORK)
    expect(resolveRepositoryIdentity({ env: { XNLC_REPOSITORY: ARBITRARY_FORK }, fromGit: () => OFFICIAL })).toBe(ARBITRARY_FORK)
    expect(resolveRepositoryIdentity({ env: {}, fromGit: () => PERSONAL_FORK })).toBe(PERSONAL_FORK)
    expect(() => resolveRepositoryIdentity({ env: {}, fromGit: () => null })).toThrow(/GITHUB_REPOSITORY or XNLC_REPOSITORY/)
  })

  test("git remote текущей копии определяется без сети и без GitHub CLI", async () => {
    const { repositoryFromGit, gitRemoteNames } = await import("../../scripts/repository-identity.ts")
    // В рабочем дереве есть хотя бы один GitHub remote; резолвер не должен падать.
    expect(Array.isArray(gitRemoteNames())).toBe(true)
    const resolved = repositoryFromGit()
    if (resolved) expect(resolved).toMatch(/^[\w.-]+\/[\w.-]+$/)
  })
})

describe("repository identity: официальный репозиторий и форки", () => {
  test("runtime-фасад строит Stable/Canary URL от идентичности этой сборки", async () => {
    const { repository, updateBaseUrls, expectedUpdateBaseUrl } = await import("../../electrobun/main/repository-identity.ts")
    const { updateBaseUrlsFor } = await import("../../lib/repository-identity.ts")
    const { resolveRepositoryIdentity } = await import("../../scripts/repository-identity.ts")
    // Идентичность встроена генератором из окружения/git, поэтому тест не зависит от владельца.
    expect(repository).toBe(resolveRepositoryIdentity())
    expect(updateBaseUrls).toEqual(updateBaseUrlsFor(repository))
    expect(expectedUpdateBaseUrl("stable")).toBe(updateBaseUrls.stable)
    expect(expectedUpdateBaseUrl("canary")).toBe(updateBaseUrls.canary)
    expect(Object.isFrozen(updateBaseUrls)).toBe(true)
    expect(() => expectedUpdateBaseUrl("beta")).toThrow()
  })

  test("личный и произвольный форк собирают собственные URL, а не официальные", async () => {
    const { updateBaseUrlsFor } = await import("../../lib/repository-identity.ts")
    for (const fork of [PERSONAL_FORK, ARBITRARY_FORK]) {
      const forkUrls = updateBaseUrlsFor(fork)
      expect(forkUrls).toEqual(urls(fork))
      expect(forkUrls.stable).not.toBe(urls(OFFICIAL).stable)
      expect(forkUrls.canary).not.toBe(urls(OFFICIAL).canary)
    }
  })

  test("releaseIdentity проходит для своего репозитория и отвергает чужой", () => {
    for (const repository of [OFFICIAL, PERSONAL_FORK, ARBITRARY_FORK]) {
      const release = pipelineFor(repository)
      expect(release.releaseIdentity("refs/tags/v1.2.3", "1.2.3", repository))
        .toEqual({ tag: "v1.2.3", version: "1.2.3", prerelease: false })
      expect(release.releaseIdentity("refs/tags/v1.2.3-pre2", "1.2.3-pre2", repository).prerelease).toBe(true)
      expect(() => release.releaseIdentity("refs/tags/v1.2.3", "1.2.3", "foreign/repo")).toThrow(/belongs to/)
    }
  })

  test("release notes строят ссылки от переданного репозитория", async () => {
    const { releaseNotes } = await import("../../scripts/release-notes.ts")
    for (const repository of [OFFICIAL, PERSONAL_FORK, ARBITRARY_FORK]) {
      const body = releaseNotes("1.2.3", ["fix: fixture"], repository)
      expect(body).toContain(`https://github.com/${repository}/releases/download/v1.2.3/`)
      for (const other of [OFFICIAL, PERSONAL_FORK, ARBITRARY_FORK].filter(item => item !== repository)) {
        expect(body).not.toContain(`https://github.com/${other}/releases/download/`)
      }
    }
  })

  test("сгенерированный runtime-модуль содержит идентичность именно этой сборки", async () => {
    const { renderRepositoryIdentityModule } = await import("../../scripts/repository-identity.ts")
    const rendered = renderRepositoryIdentityModule(ARBITRARY_FORK)
    expect(rendered).toContain('repositoryIdentity = "someone/xneon-launcher-fork"')
    expect(rendered).not.toContain(OFFICIAL)
    expect(rendered).not.toContain(PERSONAL_FORK)
  })
})

describe("repository identity: границы runtime и CI", () => {
  test("runtime не зависит от Git и Git CLI", () => {
    const runtimeFiles = [
      "lib/repository-identity.ts",
      "lib/repository-identity.generated.ts",
      "electrobun/main/repository-identity.ts",
    ]
    for (const file of runtimeFiles) {
      const source = fs.readFileSync(path.join(root, file), "utf8")
      expect(source).not.toMatch(/node:child_process/)
      expect(source).not.toMatch(/\b(?:execFileSync|execSync|spawnSync|spawn|execFile)\b/)
    }
  })

  test("runtime не содержит чужого owner/repo, а RetroAuth остаётся внешней зависимостью", async () => {
    const { resolveRepositoryIdentity } = await import("../../scripts/repository-identity.ts")
    const current = resolveRepositoryIdentity()
    // Чужой — любой известный slug, кроме идентичности этой сборки. Свой slug живёт только в сгенерированном файле.
    const foreign = [OFFICIAL, PERSONAL_FORK].filter(slug => slug !== current)
    const offenders = []
    for (const file of productionFiles) {
      if (!fs.existsSync(file) || !fs.statSync(file).isFile()) continue
      const text = fs.readFileSync(file, "utf8")
      for (const slug of foreign) if (text.includes(slug)) offenders.push(`${path.relative(root, file)}: ${slug}`)
    }
    expect(offenders).toEqual([])
    // RetroAuth — внешняя зависимость с закреплённым SHA-256, а не идентичность сборки.
    expect(fs.readFileSync(path.join(root, "packages/xnlc-core/src/launch-utils.ts"), "utf8")).toContain(RETRO_AUTH)
  })

  test("ключевые runtime-модули не хардкодят официальный owner/repo", () => {
    const runtimeFiles = [
      "electrobun/main/repository-identity.ts",
      "electrobun/main/verified-update-feed.ts",
      "electrobun/main/unix-update-feed.ts",
      "electrobun/main/unix-update-job.ts",
      "electrobun/main/unix-update-state.ts",
      "electrobun/main/updater.ts",
      "electrobun/main/ai-agent.ts",
      "electrobun/main/update-public-keys.ts",
      "electrobun/main/channel-switch.ts",
      "electrobun.config.ts",
      "components/launcher/settings/settings-language-about.tsx",
    ]
    for (const file of runtimeFiles) {
      const source = fs.readFileSync(path.join(root, file), "utf8")
      expect(source).not.toContain(OFFICIAL)
      expect(source).not.toContain(PERSONAL_FORK)
    }
  })

  test("workflow не содержит хардкода репозитория и собирает релизы из любого форка", () => {
    for (const file of ["release.yml", "pre-release.yml"]) {
      const source = fs.readFileSync(path.join(root, ".github/workflows", file), "utf8")
      expect(source).not.toContain(PERSONAL_FORK)
      expect(source).not.toMatch(/github\.repository\s*==/)
      expect(source).not.toContain(OFFICIAL)
      const doc = Bun.YAML.parse(source)
      for (const job of ["tests", "build", "build-linux", "build-macos", "release"]) expect(doc.jobs[job]).toBeDefined()
      for (const job of ["build", "build-linux", "build-macos", "release"]) {
        expect(String(doc.jobs[job].if ?? "")).toContain("refs/tags/v")
      }
      const guard = doc.jobs.tests.steps.find(step => step.name === "Check version tag and main ancestry before the protected release")
      expect(guard).toBeDefined()
      expect(String(guard.if)).toContain("refs/tags/v")
    }
    const ci = fs.readFileSync(path.join(root, ".github/workflows/ci.yml"), "utf8")
    expect(ci).not.toContain(PERSONAL_FORK)
  })

  test("метаданные проекта не фиксируют владельца репозитория сборки", () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"))
    expect(pkg.repository).toBeUndefined()
    expect(pkg.private).toBe(true)
    const readme = fs.readFileSync(path.join(root, "README.md"), "utf8")
    expect(readme).not.toContain(PERSONAL_FORK)
    const guide = fs.readFileSync(path.join(root, "docs/integration-guide.md"), "utf8")
    expect(guide).not.toContain(PERSONAL_FORK)
  })
})
