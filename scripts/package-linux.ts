// Linux-пакеты (deb/rpm/pacman/AppImage/tar.xz) из штатного Linux update archive.
//
// Источник — `stable-linux-x64-XneonLauncher.tar.zst`, который уже проверен
// `electrobun-artifacts.ts` (identity, ELF, payload). Здесь payload только
// раскладывается по FHS и заворачивается в системные форматы: бинарники не
// пересобираются и не меняются.
import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import { spawnSync } from "node:child_process"
import { copyFile, cp, lstat, mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from "node:fs/promises"
import path from "node:path"
import packageJson from "../package.json"
import { APP_NAME } from "../lib/app-meta"
import { checksumText } from "./artifact-checksums"

/** Короткое описание: то же, что Windows получает как `app.description`. */
const summary = packageJson.description
const maintainer = `${APP_NAME} <${packageJson.author.email}>`
/** Лицензия самого лаунчера (`LICENSE`, README): GPL-3.0, без «or later». */
const license = "GPL-3.0-only"
const desktopName = "xneon-launcher"
const installRoot = "opt/xneon-launcher"
const appImageTool = {
  version: "1.9.1",
  url: "https://github.com/AppImage/appimagetool/releases/download/1.9.1/appimagetool-x86_64.AppImage",
  sha256: "ed4ce84f0d9caff66f50bcca6ff6f35aae54ce8135408b3fa33abfc3cb384eb0",
  size: 15092216,
  runtime: {
    url: "https://github.com/AppImage/type2-runtime/releases/download/20251108/runtime-x86_64",
    sha256: "2fca8b443c92510f1483a883f60061ad09b46b978b2631c807cd873a47ec260d",
    size: 944632,
  },
}

type Built = { file: string; magic: (bytes: Buffer) => void }

const startedAt = Date.now()
/** Живой прогресс: job долго молчит, иначе не видно, какой формат сейчас собирается. */
function progress(message: string) {
  const seconds = Math.round((Date.now() - startedAt) / 1000)
  console.log(`[${String(seconds).padStart(4)}s] ${message}`)
}

const asMegabytes = (bytes: number) => `${(bytes / 1024 ** 2).toFixed(1)} MiB`

export function linuxPackageNames(version: string): string[] {
  return [
    `xneon-launcher-${version}-amd64.deb`,
    `xneon-launcher-${version}-x86_64.rpm`,
    `xneon-launcher-${version}-x86_64.pacman`,
    `xneon-launcher-${version}-x86_64.AppImage`,
    `xneon-launcher-${version}-x64.tar.xz`,
  ].sort()
}

function run(command: string, args: string[], options: { cwd?: string; env?: Record<string, string> } = {}): string {
  const result = spawnSync(command, args, {
    cwd: options.cwd,
    env: { ...process.env, ...options.env },
    maxBuffer: 64 * 1024 * 1024,
  })
  assert.equal(result.status, 0, `${command} ${args.join(" ")} failed: ${result.stderr?.toString() ?? result.error?.message ?? ""}`)
  return result.stdout.toString()
}

async function sha256(file: string): Promise<string> {
  const hash = createHash("sha256")
  for await (const chunk of Bun.file(file).stream()) hash.update(chunk)
  return hash.digest("hex")
}

async function sizeOf(directory: string): Promise<number> {
  let total = 0
  for (const entry of await readdir(directory, { recursive: true })) {
    const info = await lstat(path.join(directory, entry))
    if (info.isFile()) total += info.size
  }
  return total
}

const desktopEntry = `[Desktop Entry]
Type=Application
Name=${APP_NAME}
Comment=${summary}
Exec=/${installRoot}/bin/launcher %U
Icon=${desktopName}
Terminal=false
Categories=Game;
StartupWMClass=${desktopName}
`

const appRun = `#!/bin/sh
HERE="$(dirname "$(readlink -f "$0")")"
exec "$HERE/${installRoot}/bin/launcher" "$@"
`

/** Раскладывает проверенный payload в дерево установки и служебные файлы. */
async function stageRoot(extracted: string, work: string, app: string) {
  const root = path.join(work, "root")
  const application = path.join(extracted, app)
  for (const entry of ["bin/launcher", "bin/bun", "Resources/version.json"]) {
    assert.ok((await lstat(path.join(application, entry))).isFile(), "Missing native payload entry: " + entry)
  }
  await cp(application, path.join(root, installRoot), { recursive: true })
  await mkdir(path.join(root, "usr/bin"), { recursive: true })
  await symlink(`/${installRoot}/bin/launcher`, path.join(root, "usr/bin", desktopName))
  await mkdir(path.join(root, "usr/share/applications"), { recursive: true })
  await writeFile(path.join(root, "usr/share/applications", `${desktopName}.desktop`), desktopEntry)
  await mkdir(path.join(root, "usr/share/icons/hicolor/512x512/apps"), { recursive: true })
  await copyFile(path.resolve("build/icon.png"), path.join(root, "usr/share/icons/hicolor/512x512/apps", `${desktopName}.png`))
  await mkdir(path.join(root, "usr/share/licenses", desktopName), { recursive: true })
  await copyFile(path.resolve("LICENSE"), path.join(root, "usr/share/licenses", desktopName, "LICENSE"))
  return root
}

/**
 * Текст `DEBIAN/control`: вынесен из сборки, чтобы тот же текст читала проверка
 * собранных пакетов.
 */
function debControl(version: string, installedSize: number): string {
  return [
    "Package: xneon-launcher",
    `Version: ${version}`,
    "Section: games",
    "Priority: optional",
    "Architecture: amd64",
    `Maintainer: ${maintainer}`,
    `Installed-Size: ${installedSize}`,
    "Depends: libgtk-3-0, libwebkit2gtk-4.1-0, libayatana-appindicator3-1, libsecret-1-0, libnotify4, libxss1",
    `Description: ${APP_NAME}`,
    ` ${summary}.`,
    "",
  ].join("\n")
}

async function buildDeb(root: string, output: string, version: string): Promise<Built> {
  const stage = path.join(path.dirname(root), "deb")
  await cp(root, stage, { recursive: true, verbatimSymlinks: true })
  // Debian ждёт лицензию в copyright, а не в /usr/share/licenses.
  await rm(path.join(stage, "usr/share/licenses"), { recursive: true, force: true })
  await mkdir(path.join(stage, "usr/share/doc", desktopName), { recursive: true })
  await copyFile(path.resolve("LICENSE"), path.join(stage, "usr/share/doc", desktopName, "copyright"))
  const installedSize = Math.ceil((await sizeOf(root)) / 1024)
  await mkdir(path.join(stage, "DEBIAN"))
  await writeFile(path.join(stage, "DEBIAN/control"), debControl(version, installedSize))
  const file = path.join(output, `xneon-launcher-${version}-amd64.deb`)
  progress("deb: dpkg-deb -Zxz")
  run("dpkg-deb", ["--root-owner-group", "-Zxz", "--build", stage, file])
  const contents = run("dpkg-deb", ["--contents", file])
  assert.ok(contents.includes(`./${installRoot}/bin/launcher`), "deb is missing the launcher payload")
  return { file: path.basename(file), magic: bytes => { assert.equal(bytes.subarray(0, 21).toString(), "!<arch>\ndebian-binary") } }
}

async function buildRpm(root: string, work: string, output: string, version: string): Promise<Built> {
  const top = path.join(work, "rpm")
  for (const directory of ["BUILD", "RPMS", "SOURCES", "SPECS", "SRPMS"]) await mkdir(path.join(top, directory), { recursive: true })
  const spec = path.join(top, "SPECS/xneon-launcher.spec")
  const [base, prerelease] = version.split("-")
  await writeFile(spec, `Name: xneon-launcher
Version: ${base}
Release: ${prerelease ? "0." + prerelease : "1"}
Summary: ${APP_NAME} — ${summary}
License: ${license}
URL: https://xneon.org
Packager: ${maintainer}
BuildArch: x86_64
AutoReqProv: no
Requires: gtk3
Requires: webkit2gtk4.1
Requires: libayatana-appindicator-gtk3
Requires: libsecret
Requires: libnotify
Requires: libXScrnSaver

%description
${APP_NAME} — ${summary}.

%prep

%build

%install
mkdir -p %{buildroot}
cp -a %{_staging}/. %{buildroot}/

%files
/${installRoot}
/usr/bin/${desktopName}
/usr/share/applications/${desktopName}.desktop
/usr/share/icons/hicolor/512x512/apps/${desktopName}.png
%license /usr/share/licenses/${desktopName}/LICENSE

%changelog
`)
  progress("rpm: rpmbuild")
  run("rpmbuild", ["-bb", "--define", `_topdir ${top}`, "--define", `_staging ${root}`, "--define", "_build_id_links none", spec])
  const built = (await readdir(path.join(top, "RPMS", "x86_64"))).find(name => name.endsWith(".rpm"))
  assert.ok(built, "rpmbuild produced no package")
  const file = path.join(output, `xneon-launcher-${version}-x86_64.rpm`)
  await copyFile(path.join(top, "RPMS", "x86_64", built), file)
  const files = run("rpm", ["-qlp", file])
  assert.ok(files.includes(`/${installRoot}/bin/launcher`), "rpm is missing the launcher payload")
  return { file: path.basename(file), magic: bytes => { assert.deepEqual([...bytes.subarray(0, 4)], [0xed, 0xab, 0xee, 0xdb]) } }
}

async function buildPacman(root: string, work: string, output: string, version: string): Promise<Built> {
  const stage = path.join(work, "pacman")
  await cp(root, stage, { recursive: true, verbatimSymlinks: true })
  const size = await sizeOf(root)
  await writeFile(path.join(stage, ".PKGINFO"), `pkgname = xneon-launcher
pkgbase = xneon-launcher
pkgver = ${version.replace(/-/g, "_")}-1
pkgdesc = ${APP_NAME} — ${summary}
url = https://xneon.org
builddate = ${Math.floor(Date.now() / 1000)}
packager = ${maintainer}
size = ${size}
arch = x86_64
license = ${license}
depend = gtk3
depend = webkit2gtk-4.1
depend = libayatana-appindicator
depend = libsecret
depend = libnotify
depend = libxss
`)
  run("bsdtar", ["-czf", ".MTREE", "--format=mtree", "--options=!all,use-set,type,uid,gid,mode,time,size,md5,sha256,link", ".PKGINFO", "opt", "usr"], { cwd: stage })
  const file = path.join(output, `xneon-launcher-${version}-x86_64.pacman`)
  const plain = path.join(work, "pacman.tar")
  run("tar", ["-cf", plain, ".PKGINFO", ".MTREE", "opt", "usr"], { cwd: stage })
  progress("pacman: zstd -19")
  run("zstd", ["-19", "-T0", "-q", "-f", plain, "-o", file])
  const entries = run("bsdtar", ["-tf", file])
  assert.ok(entries.includes(`.PKGINFO`) && entries.includes(`${installRoot}/bin/launcher`), "pacman archive is missing the payload")
  return { file: path.basename(file), magic: bytes => { assert.deepEqual([...bytes.subarray(0, 4)], [0x28, 0xb5, 0x2f, 0xfd]) } }
}

async function buildAppImage(root: string, work: string, output: string, version: string): Promise<Built> {
  const stage = path.join(work, "AppDir")
  await mkdir(stage, { recursive: true })
  await cp(path.join(root, installRoot), path.join(stage, installRoot), { recursive: true, verbatimSymlinks: true })
  await mkdir(path.join(stage, "usr/share"), { recursive: true })
  await cp(path.join(root, "usr/share/licenses"), path.join(stage, "usr/share/licenses"), { recursive: true, verbatimSymlinks: true })
  await writeFile(path.join(stage, "AppRun"), appRun, { mode: 0o755 })
  await symlink("AppRun", path.join(stage, desktopName))
  await copyFile(path.resolve("build/icon.png"), path.join(stage, `${desktopName}.png`))
  await writeFile(path.join(stage, `${desktopName}.desktop`), desktopEntry.replace(`Exec=/${installRoot}/bin/launcher`, `Exec=${desktopName}`))
  const tool = path.join(work, "appimagetool-x86_64.AppImage")
  const runtime = path.join(work, "runtime-x86_64")
  for (const [target, download] of [[tool, appImageTool], [runtime, appImageTool.runtime]] as const) {
    progress(`AppImage: загрузка ${path.basename(target)} (${asMegabytes(download.size)})`)
    const response = await fetch(download.url)
    assert.ok(response.ok, "Cannot download AppImage build dependency " + download.url)
    const bytes = Buffer.from(await response.arrayBuffer())
    assert.equal(bytes.length, download.size, "Unexpected AppImage dependency size")
    assert.equal(createHash("sha256").update(bytes).digest("hex"), download.sha256, "AppImage dependency checksum mismatch")
    await writeFile(target, bytes, { mode: 0o755 })
  }
  const file = path.join(output, `xneon-launcher-${version}-x86_64.AppImage`)
  progress("AppImage: appimagetool (squashfs)")
  run(tool, ["--no-appstream", "--runtime-file", runtime, stage, file], { env: { ARCH: "x86_64", APPIMAGE_EXTRACT_AND_RUN: "1" } })
  const header = (await readFile(file)).subarray(0, 11)
  assert.equal(header.subarray(1, 4).toString(), "ELF", "AppImage is not an ELF runtime")
  assert.deepEqual([...header.subarray(8, 11)], [0x41, 0x49, 0x02], "AppImage type-2 magic missing")
  return { file: path.basename(file), magic: bytes => { assert.equal(bytes.subarray(1, 4).toString(), "ELF"); assert.deepEqual([...bytes.subarray(8, 11)], [0x41, 0x49, 0x02]) } }
}

async function buildTarXz(root: string, output: string, version: string): Promise<Built> {
  const file = path.join(output, `xneon-launcher-${version}-x64.tar.xz`)
  progress("tar.xz: xz")
  run("tar", ["-cJf", file, "-C", root, "opt", "usr"])
  const entries = run("tar", ["-tJf", file])
  assert.ok(entries.includes(`${installRoot}/bin/launcher`), "tar.xz is missing the payload")
  return { file: path.basename(file), magic: bytes => { assert.deepEqual([...bytes.subarray(0, 6)], [0xfd, 0x37, 0x7a, 0x58, 0x5a, 0x00]) } }
}

/**
 * Читает метаданные уже собранных пакетов теми инструментами, которыми их
 * увидит пользователь (`dpkg-deb`, `rpm`, распаковка pacman/AppImage), и сверяет
 * имя продукта и лицензию с исходниками. Ловит расхождение в самом артефакте,
 * а не только в упаковщике.
 */
async function verifyLinuxPackageMetadata(output: string, version: string) {
  const deb = path.join(output, `xneon-launcher-${version}-amd64.deb`)
  const control = run("dpkg-deb", ["-f", deb, "Maintainer", "Description"])
  const [maintainerLine, descriptionLine] = control.split(/\r?\n/)
  assert.equal(maintainerLine, `Maintainer: ${maintainer}`, "Unexpected deb Maintainer: " + control)
  assert.equal(descriptionLine, `Description: ${APP_NAME}`, "Unexpected deb Description: " + control)
  assert.ok(control.includes(` ${summary}.`), "Unexpected deb extended description: " + control)
  // Один файл из data.tar без распаковки всего пакета в каталог.
  const debFile = (name: string) => run("sh", ["-c", "dpkg-deb --fsys-tarfile \"$1\" | tar -xJO \"$2\"", "sh", deb, name])
  assert.equal(debFile(`./usr/share/applications/${desktopName}.desktop`), desktopEntry, "Unexpected deb desktop entry")
  assert.match(debFile(`./usr/share/doc/${desktopName}/copyright`), /GNU GENERAL PUBLIC LICENSE/, "deb is missing the project license")

  const rpm = path.join(output, `xneon-launcher-${version}-x86_64.rpm`)
  const [rpmSummary, rpmDescription] = run("rpm", ["-qp", "--qf", "%{SUMMARY}\n%{DESCRIPTION}\n", rpm]).trimEnd().split(/\r?\n/)
  assert.equal(rpmSummary, `${APP_NAME} — ${summary}`, "Unexpected rpm Summary")
  assert.equal(rpmDescription, `${APP_NAME} — ${summary}.`, "Unexpected rpm Description")
  assert.equal(run("rpm", ["-qp", "--qf", "%{LICENSE}", rpm]), license, "Unexpected rpm License")
  assert.ok(run("rpm", ["-qlp", rpm]).includes(`/usr/share/licenses/${desktopName}/LICENSE`), "rpm is missing the project license")

  const pacman = path.join(output, `xneon-launcher-${version}-x86_64.pacman`)
  const pkgInfo = run("bsdtar", ["-xOf", pacman, ".PKGINFO"])
  assert.ok(pkgInfo.includes(`pkgdesc = ${APP_NAME} — ${summary}`), "Unexpected pacman pkgdesc: " + pkgInfo)
  assert.ok(pkgInfo.includes(`license = ${license}`), "Unexpected pacman license: " + pkgInfo)
  assert.ok(run("bsdtar", ["-tf", pacman]).includes(`usr/share/licenses/${desktopName}/LICENSE`), "pacman is missing the project license")

  const appImage = path.resolve(output, `xneon-launcher-${version}-x86_64.AppImage`)
  const offset = run(appImage, ["--appimage-offset"], { env: { APPIMAGE_EXTRACT_AND_RUN: "1" } }).trim()
  assert.match(offset, /^\d+$/, "Cannot read AppImage squashfs offset")
  assert.equal(run("unsquashfs", ["-o", offset, "-cat", appImage, `${desktopName}.desktop`]), desktopEntry, "Unexpected AppImage desktop entry")
  assert.match(run("unsquashfs", ["-o", offset, "-cat", appImage, `usr/share/licenses/${desktopName}/LICENSE`]), /GNU GENERAL PUBLIC LICENSE/, "AppImage is missing the project license")
}

export async function packageLinux(input: string, output: string) {
  assert.equal(process.platform, "linux", "Linux packages are built on a native Linux runner")
  assert.equal(process.arch, "x64", "Linux packages are built for x64 only")
  const version = packageJson.version
  assert.match(version, /^\d+\.\d+\.\d+(?:-pre[1-9]\d*)?$/, "Use a stable version or <version>-preN")
  const channel = version.includes("-") ? "canary" : "stable"
  const app = "XneonLauncher" + (channel === "stable" ? "" : "-canary")
  const archive = `${channel}-linux-x64-${app}.tar.zst`
  assert.ok((await readdir(input)).includes(archive), "Missing native Linux update archive: " + archive)
  assert.ok(!(await readdir(output).catch(() => [] as string[])).length, "Output directory must be empty")

  const work = await mkdtemp(path.resolve(".tmp/ci-linux-packages-"))
  try {
    progress(`распаковка ${archive}`)
    const extracted = path.join(work, "native")
    await mkdir(extracted)
    const tarFile = path.join(work, "application.tar")
    await writeFile(tarFile, Buffer.from(Bun.zstdDecompressSync(await readFile(path.join(input, archive)))))
    run("tar", ["-xf", tarFile, "-C", extracted])
    const root = await stageRoot(extracted, work, app)
    await mkdir(output, { recursive: true })
    progress(`payload разложен: /${installRoot} (${asMegabytes(await sizeOf(root))})`)

    const steps: Array<[string, () => Promise<Built>]> = [
      ["deb", () => buildDeb(root, output, version)],
      ["rpm", () => buildRpm(root, work, output, version)],
      ["pacman", () => buildPacman(root, work, output, version)],
      ["AppImage", () => buildAppImage(root, work, output, version)],
      ["tar.xz", () => buildTarXz(root, output, version)],
    ]
    const built: Built[] = []
    for (const [label, build] of steps) {
      progress(`${label}: сборка`)
      const entry = await build()
      progress(`${label}: готово ${entry.file} (${asMegabytes((await lstat(path.join(output, entry.file))).size)})`)
      built.push(entry)
    }
    const names = linuxPackageNames(version)
    assert.deepEqual(built.map(entry => entry.file).sort(), names, "Unexpected Linux package names")
    for (const entry of built) {
      const bytes = await readFile(path.join(output, entry.file))
      assert.ok(bytes.length > 1024 ** 2, "Linux package is too small: " + entry.file)
      entry.magic(bytes)
      assert.equal(await sha256(path.join(output, entry.file)), createHash("sha256").update(bytes).digest("hex"))
    }
    await writeFile(path.join(output, "SHA256SUMS.txt"), await checksumText(output, names), { flag: "wx" })
    progress("проверка пользовательских метаданных пакетов")
    await verifyLinuxPackageMetadata(output, version)
    console.log("Built Linux packages:\n" + names.join("\n"))
    return names
  } finally {
    await rm(work, { recursive: true, force: true })
  }
}

if (import.meta.main) {
  const [input, output] = Bun.argv.slice(2)
  assert.ok(input && output, "Usage: package-linux.ts <checked-native> <output>")
  await packageLinux(path.resolve(input), path.resolve(output))
}
