import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { lstat, readdir, readFile, writeFile, mkdir } from "node:fs/promises"
import path from "node:path"
import { validateNativeExecutable } from "./electrobun-artifacts"
import { checksumText } from "./artifact-checksums"
import packageJson from "../package.json"
import { assertLinuxCefRuntime } from "../electrobun/platform/linux-cef"

/** Это проверка payload, а не доказательство успешного запуска CEF. */
export async function validateCefPayload(root: string) {
  const checked = assertLinuxCefRuntime(path.join(root, "bin"))
  return { libcef: path.relative(root, checked.libcef).replaceAll("\\", "/"), resources: "bin", helper: path.relative(root, checked.helper) }
}

function run(program: string, args: string[]) {
  const result = spawnSync(program, args, { encoding: "utf8", maxBuffer: 16 * 1024 ** 2 })
  assert.equal(result.status, 0, `${program} failed: ${result.stderr || result.error?.message}`)
  return result.stdout
}

export async function inspectUnixBundle(root: string) {
  root = path.resolve(root)
  const linux = process.platform === "linux"
  assert.ok(linux && process.arch === "x64" || process.platform === "darwin" && process.arch === "arm64", "Native Linux x64 or macOS arm64 runner required")
  const bin = path.join(root, linux ? "bin" : "Contents/MacOS")
  const binaries = ["launcher", "bun"]
  for (const name of binaries) {
    const file = path.join(bin, name)
    const info = await lstat(file)
    assert.ok(info.isFile() && (info.mode & 0o111), "Missing executable permission: " + file)
    validateNativeExecutable(await readFile(file), linux ? "linux" : "macos", linux ? "x64" : "arm64")
  }
  let cef: Awaited<ReturnType<typeof validateCefPayload>> | undefined
  if (linux) {
    cef = await validateCefPayload(root)
    // Проверяем не только launcher: libcef и прочие ELF зависят от системных библиотек.
    const files = await readdir(root, { recursive: true })
    for (const name of files) {
      const file = path.join(root, name)
      if (!(await lstat(file)).isFile()) continue
      const head = Buffer.from(await Bun.file(file).slice(0, 4).arrayBuffer())
      if (head.toString("hex") !== "7f454c46") continue
      validateNativeExecutable(await readFile(file), "linux", "x64")
      if (/\(NEEDED\)/.test(run("readelf", ["--dynamic", file]))) {
        const environment: NodeJS.ProcessEnv = { ...process.env, LD_LIBRARY_PATH: `${bin}:${path.join(bin, "cef")}` }
        delete environment.LD_PRELOAD
        const linked = spawnSync("ldd", [file], { encoding: "utf8", env: environment, cwd: bin })
        assert.equal(linked.status, 0, "ldd failed: " + file + "\n" + linked.stderr)
        const result = linked.stdout
        assert.ok(!result.includes("not found"), "Unresolved runtime dependency: " + file + "\n" + result)
      }
      const versions = run("readelf", ["--version-info", file])
      for (const [family, maximum] of [["GLIBC", [2, 39]], ["GLIBCXX", [3, 4, 32]], ["CXXABI", [1, 3, 14]]] as const) {
        for (const match of versions.matchAll(new RegExp(`\\b${family}_(\\d+(?:\\.\\d+)+)`, "g"))) {
          const parts = match[1].split(".").map(Number)
          let comparison = 0
          for (let i = 0; i < Math.max(parts.length, maximum.length) && !comparison; i++) comparison = (parts[i] ?? 0) - (maximum[i] ?? 0)
          assert.ok(comparison <= 0, `Unsupported ABI ${match[0]} in ${file}`)
        }
      }
    }
  } else {
    const plist = path.join(root, "Contents/Info.plist")
    const executable = run("/usr/libexec/PlistBuddy", ["-c", "Print CFBundleExecutable", plist]).trim()
    assert.ok(executable && !executable.includes("/"), "Unsafe CFBundleExecutable")
    assert.equal(run("lipo", ["-archs", path.join(bin, executable)]).trim(), "arm64")
    run("otool", ["-L", path.join(bin, executable)])
  }
  return { platform: linux ? "linux" : "macos", arch: process.arch, cef, fileValidation: "passed", e2e: "not-run", updates: "not-run" }
}

if (import.meta.main) {
  const [root, output, channel] = Bun.argv.slice(2)
  assert.ok(root && output && (channel === "stable" || channel === "canary"), "Usage: unix-native-preflight <bundle> <new-output> <stable|canary>")
  const report = await inspectUnixBundle(root)
  await mkdir(output)
  const names: string[] = []
  if (process.platform === "darwin") {
    const name = `xneon-launcher-${packageJson.version}-mac-arm64.zip`
    // ditto сохраняет симлинки, executable bits и структуру настоящего .app.
    run("ditto", ["-c", "-k", "--sequesterRsrc", "--keepParent", root, path.resolve(output, name)])
    run("unzip", ["-t", path.resolve(output, name)])
    names.push(name)
    const dmg = `xneon-launcher-${packageJson.version}-mac-arm64.dmg`
    run("hdiutil", ["create", "-format", "UDZO", "-srcfolder", root, path.resolve(output, dmg)])
    run("hdiutil", ["verify", path.resolve(output, dmg)])
    names.push(dmg)
  }
  await writeFile(path.join(output, "native-validation.json"), JSON.stringify({ version: packageJson.version, channel, ...report }, null, 2) + "\n")
  names.push("native-validation.json")
  await writeFile(path.join(output, "SHA256SUMS.txt"), await checksumText(output, names))
  console.log(JSON.stringify(report))
}
