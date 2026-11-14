import test from "node:test"
import assert from "node:assert/strict"
import fs from "node:fs"
import vm from "node:vm"
import { transformSync } from "esbuild"
import path from "node:path"
import os from "node:os"
import { fileURLToPath } from "node:url"

test("Unix-блокировка и CLI не являются win32-заглушками", () => {
  const lock = fs.readFileSync(new URL("../../electrobun/platform/instance-lock.ts", import.meta.url), "utf8")
  const boot = fs.readFileSync(new URL("../../electrobun/main/bootstrap.ts", import.meta.url), "utf8")
  assert.equal(lock.includes("acquireUnixFileLock"), true)
  assert.equal(boot.includes('primary && process.platform === "win32"'), false)
})

for (const scenario of ["missing", "socket", "file", "symlink", "foreign", "unlocked"]) {
  test(`осиротевший сокет: ${scenario}`, () => {
    const source = fs.readFileSync(new URL("../../electrobun/platform/unix-socket.ts", import.meta.url), "utf8")
    const module = { exports: {} }
    const removed = []
    vm.runInNewContext(transformSync(source, { loader: "ts", format: "cjs" }).code, {
      module, process: { getuid: () => 1000 }, require: () => ({
        lstatSync: () => {
          if (scenario === "missing") throw Object.assign(new Error("absent"), { code: "ENOENT" })
          return { isSocket: () => scenario !== "file", isSymbolicLink: () => scenario === "symlink", uid: scenario === "foreign" ? 999 : 1000 }
        },
        unlinkSync: file => removed.push(file),
      }),
    })
    const run = () => module.exports.removeStaleUnixSocket("/private/launcher.sock", scenario !== "unlocked")
    if (["file", "symlink", "foreign", "unlocked"].includes(scenario)) assert.throws(run, /Refusing/)
    else run()
    assert.equal(removed.length, scenario === "socket" ? 1 : 0)
  })
}

for (const platform of ["darwin", "linux"]) {
  for (const mode of ["success", "busy", "error"]) {
    test(`flock ${platform}: ${mode}, дескриптор закрывается ровно один раз`, () => {
      const source = fs.readFileSync(new URL("../../electrobun/platform/unix-file-lock.ts", import.meta.url), "utf8")
      const module = { exports: {} }
      let closed = 0
      let unloaded = 0
      const operations = []
      const errno = Buffer.alloc(4)
      errno.writeInt32LE(mode === "busy" ? (platform === "darwin" ? 35 : 11) : 9)
      vm.runInNewContext(transformSync(source, { loader: "ts", format: "cjs" }).code, {
        module, process: { platform, getuid: () => 1000 }, require: name => {
          if (name === "node:path") return path.posix
          if (name === "bun:ffi") return { read: { i32: data => data.readInt32LE(0) }, dlopen: () => ({ close: () => unloaded++, symbols: {
            flock: (fd, flags) => { assert.equal(fd, 42); operations.push(flags); return mode === "success" || flags === 8 ? 0 : -1 },
            __error: () => errno, __errno_location: () => errno,
          } }) }
          return { constants: {}, mkdirSync() {}, openSync: () => 42, closeSync: () => closed++, fstatSync: () => ({ isFile: () => true, uid: 1000 }) }
        },
      })
      if (mode === "error") assert.throws(() => module.exports.acquireUnixFileLock("/profile.lock"), /errno 9/)
      else {
        const unlock = module.exports.acquireUnixFileLock("/profile.lock")
        if (mode === "busy") assert.equal(unlock, null)
        else { assert.equal(closed, 0); unlock(); unlock(); assert.deepEqual(operations, [6, 8]) }
      }
      assert.equal(closed, 1)
      assert.equal(unloaded, 1)
    })
  }
}

test("Unix: второй процесс не владеет flock; stale socket удаляется новым владельцем", { skip: process.platform === "win32" }, async () => {
  const { lockLauncherProfile, unlockLauncherProfile } = await import("../../electrobun/platform/instance-lock.ts")
  const { startCliListener, launcherCliEndpoint, forwardCli, cli } = await import("../../electrobun/main/cli.ts")
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "xneon-ipc-"))
  const profile = path.join(root, "profile.json")
  let server
  const endpoint = launcherCliEndpoint(profile)
  try {
    const child = Bun.spawnSync([process.execPath, "--no-env-file", "-e", `import net from 'node:net'; net.createServer().listen(${JSON.stringify(endpoint.pipe)},()=>process.kill(process.pid,'SIGKILL'))`])
    assert.notEqual(child.exitCode, 0)
    assert.ok(fs.lstatSync(endpoint.pipe).isSocket())
    await assert.rejects(startCliListener(profile), /profile lock/)
    assert.equal(lockLauncherProfile(profile), true)
    const lockModule = fileURLToPath(new URL("../../electrobun/platform/instance-lock.ts", import.meta.url))
    const contender = Bun.spawnSync([process.execPath, "--no-env-file", "-e", `const {lockLauncherProfile}=await import(${JSON.stringify(lockModule)}); console.log(lockLauncherProfile(${JSON.stringify(profile)}))`])
    assert.equal(contender.stdout.toString().trim(), "false")
    server = await startCliListener(profile)
    assert.equal(fs.statSync(endpoint.pipe).mode & 0o777, 0o600)
    let focused = 0
    cli.attach(() => focused++, () => {})
    await forwardCli(profile, null)
    assert.equal(focused, 1)
  } finally {
    cli.detach(-1)
    if (server) await new Promise(resolve => server.close(resolve))
    unlockLauncherProfile()
    try { fs.unlinkSync(endpoint.pipe) } catch {}
    fs.rmSync(root, { recursive: true, force: true })
  }
})
