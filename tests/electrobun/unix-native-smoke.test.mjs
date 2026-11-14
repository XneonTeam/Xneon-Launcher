import test from "node:test"
import assert from "node:assert/strict"
import fs from "node:fs"
import path from "node:path"
import os from "node:os"
import { spawnSync } from "node:child_process"
import { fileURLToPath } from "node:url"
import { createConnection } from "node:net"
import { lockLauncherProfile, unlockLauncherProfile } from "../../electrobun/platform/instance-lock.ts"
import { startCliListener, launcherCliEndpoint, forwardCli, cli } from "../../electrobun/main/cli.ts"

const unix = process.platform === "linux" || process.platform === "darwin"

test("native Unix: flock, stale socket, права 0600 и пересылка CLI", { skip: !unix }, async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "xneon-native-ipc-"))
  const profile = path.join(root, "profile.json")
  const endpoint = launcherCliEndpoint(profile)
  let server
  try {
    const crash = spawnSync(process.execPath, ["--no-env-file", "-e", `import net from 'node:net'; net.createServer().listen(${JSON.stringify(endpoint.pipe)},()=>process.kill(process.pid,'SIGKILL'))`], { timeout: 5000 })
    assert.notEqual(crash.status, 0)
    assert.ok(fs.lstatSync(endpoint.pipe).isSocket())
    await assert.rejects(startCliListener(profile), /profile lock/)
    assert.equal(lockLauncherProfile(profile), true)
    const module = fileURLToPath(new URL("../../electrobun/platform/instance-lock.ts", import.meta.url))
    const contend = spawnSync(process.execPath, ["--no-env-file", "-e", `const m=await import(${JSON.stringify(module)}); console.log(m.lockLauncherProfile(${JSON.stringify(profile)}))`], { encoding: "utf8", timeout: 5000 })
    assert.equal(contend.status, 0, contend.stderr)
    assert.equal(contend.stdout.trim(), "false")
    server = await startCliListener(profile)
    assert.equal(fs.statSync(endpoint.pipe).mode & 0o777, 0o600)
    assert.equal(fs.statSync(endpoint.tokenPath).mode & 0o777, 0o600)
    let focused = 0
    cli.attach(() => focused++, () => {})
    const denial = await new Promise((resolve, reject) => {
      const socket = createConnection(endpoint.pipe)
      socket.setTimeout(3000, () => socket.destroy(new Error("Authentication test timed out")))
      socket.on("error", reject)
      socket.on("connect", () => socket.write(JSON.stringify({ token: "invalid-token", build: null }) + "\n"))
      socket.on("data", data => { socket.destroy(); resolve(JSON.parse(data.toString())) })
    })
    assert.equal(denial.error, "Invalid launcher command")
    assert.equal(focused, 0)
    await forwardCli(profile, null)
    assert.equal(focused, 1)
    unlockLauncherProfile()
    const reacquire = spawnSync(process.execPath, ["--no-env-file", "-e", `const m=await import(${JSON.stringify(module)}); console.log(m.lockLauncherProfile(${JSON.stringify(profile)})); m.unlockLauncherProfile()`], { encoding: "utf8", timeout: 5000 })
    assert.equal(reacquire.stdout.trim(), "true")
  } finally {
    cli.detach(-1)
    if (server) await new Promise(resolve => server.close(resolve))
    unlockLauncherProfile()
    try { fs.unlinkSync(endpoint.pipe) } catch {}
    fs.rmSync(root, { recursive: true, force: true })
  }
})

test("native Linux: libsecret без D-Bus отказывает без plaintext-фолбэка", { skip: process.platform !== "linux" }, () => {
  const module = fileURLToPath(new URL("../../electrobun/platform/unix-safe-storage.ts", import.meta.url))
  const code = `const {unixSafeStorage:s}=await import(${JSON.stringify(module)}); const available=s.isEncryptionAvailable(); let rejected=false; try{s.encryptString('test-only')}catch{rejected=true} console.log(JSON.stringify({available,rejected}))`
  const result = spawnSync(process.execPath, ["--no-env-file", "-e", code], {
    env: { ...process.env, DBUS_SESSION_BUS_ADDRESS: "unix:path=/nonexistent-xneon-test-bus", DISPLAY: "", WAYLAND_DISPLAY: "" },
    encoding: "utf8", timeout: 10000,
  })
  assert.equal(result.status, 0, result.stderr)
  assert.deepEqual(JSON.parse(result.stdout), { available: false, rejected: true })
})

test("native Linux: аргументы подтверждённого родительского launcher", { skip: process.platform !== "linux" }, () => {
  const root = fs.mkdtempSync(path.join(path.dirname(process.execPath), "xneon-native-args-"))
  try {
    const childBun = path.join(root, "bun")
    const launcher = path.join(root, "launcher")
    fs.linkSync(process.execPath, childBun)
    fs.linkSync(process.execPath, launcher)
    const module = fileURLToPath(new URL("../../electrobun/platform/unix-launcher-args.ts", import.meta.url))
    const child = `const m=await import(${JSON.stringify(module)}); console.log(JSON.stringify(m.readUnixLauncherArgs()))`
    const parent = `const r=Bun.spawnSync([${JSON.stringify(childBun)},'--no-env-file','-e',${JSON.stringify(child)}]); process.stdout.write(r.stdout); process.exit(r.exitCode)`
    const result = spawnSync(launcher, ["--no-env-file", "-e", parent, "--", "--launch", "Сборка с пробелами 尾"], { encoding: "utf8", timeout: 5000 })
    assert.equal(result.status, 0, result.stderr)
    assert.deepEqual(JSON.parse(result.stdout).slice(-2), ["--launch", "Сборка с пробелами 尾"])
  } finally { fs.rmSync(root, { recursive: true, force: true }) }
})
