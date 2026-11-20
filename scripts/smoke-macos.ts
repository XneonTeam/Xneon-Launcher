import assert from "node:assert/strict"
import { spawn, spawnSync } from "node:child_process"
import { randomBytes } from "node:crypto"
import { mkdtemp, mkdir, readdir, readFile, writeFile } from "node:fs/promises"
import path from "node:path"
import os from "node:os"
import { inspectUnixBundle } from "./unix-native-preflight"
import { stopUnixProcessGroup } from "./unix-process-cleanup"

function run(program: string, args: string[]) {
  const result = spawnSync(program, args, { encoding: "utf8" })
  assert.equal(result.status, 0, result.stderr || result.error?.message || "Native command failed")
  return result.stdout
}

async function runBundle(bundle: string, output: string, profile: string) {
  await mkdir(output, { recursive: true })
  await inspectUnixBundle(bundle)
  const nonce = randomBytes(16).toString("hex")
  let report: any
  const server = Bun.serve({ hostname: "127.0.0.1", port: 0, async fetch(request) {
    const headers = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "content-type", "Access-Control-Allow-Methods": "POST,OPTIONS" }
    if (request.method === "OPTIONS") return new Response(null, { headers })
    if (request.method !== "POST" || new URL(request.url).pathname !== "/" + nonce) return new Response(null, { status: 404 })
    const bytes = await request.text()
    if (bytes.length > 8192) return new Response(null, { status: 413 })
    const value = JSON.parse(bytes)
    if (value.nonce !== nonce) return new Response(null, { status: 403 })
    report = value
    return new Response("ok", { headers })
  } })
  let logs = ""
  const executable = path.join(bundle, "Contents/MacOS/launcher")
  const child = spawn(executable, [], { cwd: path.dirname(executable), detached: true, env: { ...process.env, XNEON_BUN_DATA_DIR: profile, XNLC_LIVEOPS_URL: "", XNLC_NATIVE_E2E_NONCE: nonce, XNLC_NATIVE_E2E_ENDPOINT: `http://127.0.0.1:${server.port}/${nonce}` }, stdio: ["ignore", "pipe", "pipe"] })
  child.stdout.on("data", chunk => { logs = (logs + chunk).slice(-2 * 1024 ** 2) })
  child.stderr.on("data", chunk => { logs = (logs + chunk).slice(-2 * 1024 ** 2) })
  let failure: Error | undefined
  child.on("error", error => { failure = error })
  try {
    const deadline = Date.now() + 90000
    while (!report && Date.now() < deadline) { if (failure) throw failure; assert.equal(child.exitCode, null, "Native application exited before renderer/IPC evidence"); await Bun.sleep(250) }
    assert.equal(report?.status, "PASS", JSON.stringify(report) || "Native renderer timed out")
    assert.match(report.userAgent, /AppleWebKit/)
    await writeFile(path.join(output, "renderer.json"), JSON.stringify({ ...report, gatekeeperDownloadedApp: "NOT RUN", updates: "NOT RUN" }, null, 2))
    run("screencapture", ["-x", path.join(output, "desktop.png")])
    const assessment = spawnSync("spctl", ["--assess", "--type", "execute", "--verbose=2", bundle], { encoding: "utf8" })
    await writeFile(path.join(output, "gatekeeper.txt"), `exit=${assessment.status}\n${assessment.stdout}\n${assessment.stderr}\nUnsigned and not notarized; direct CI execution does not reproduce a quarantined browser download.\n`)
  } finally {
    await writeFile(path.join(output, "processes.txt"), run("ps", ["-axo", "pid,ppid,pgid,command"]))
    try {
      if (child.pid) {
        const cleanup = await stopUnixProcessGroup(child.pid)
        await writeFile(path.join(output, "shutdown.json"), JSON.stringify(cleanup))
        assert.ok(!cleanup.forced, "Native launch required SIGKILL")
      }
    } finally {
      await writeFile(path.join(output, "launcher.log"), logs)
      server.stop(true)
    }
  }
}

if (import.meta.main) {
  assert.equal(process.platform, "darwin"); assert.equal(process.arch, "arm64")
  const [input, output] = Bun.argv.slice(2)
  assert.ok(input && output, "Usage: smoke-macos <artifacts> <evidence>")
  await mkdir(output, { recursive: true })
  const work = await mkdtemp(path.join(os.tmpdir(), "xneon-macos-e2e-"))
  const files = await readdir(input)
  for (const extension of [".zip", ".dmg"]) {
    const artifacts = files.filter(file => file.endsWith(extension))
    assert.equal(artifacts.length, 1)
    const mount = path.join(work, extension.slice(1))
    await mkdir(mount)
    if (extension === ".zip") run("ditto", ["-x", "-k", path.resolve(input, artifacts[0]), mount])
    else run("hdiutil", ["attach", "-readonly", "-nobrowse", "-mountpoint", mount, path.resolve(input, artifacts[0])])
    try {
      const apps = (await readdir(mount)).filter(file => file.endsWith(".app"))
      assert.equal(apps.length, 1)
      const profile = path.join(work, "profile-" + extension.slice(1))
      await mkdir(profile)
      for (let pass = 1; pass <= 2; pass++) await runBundle(path.join(mount, apps[0]), path.resolve(output, `${extension.slice(1)}-${pass}`), profile)
    } finally { if (extension === ".dmg") run("hdiutil", ["detach", mount]) }
  }
}
