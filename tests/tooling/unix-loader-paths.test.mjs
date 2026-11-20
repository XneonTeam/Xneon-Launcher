import test from "node:test"
import assert from "node:assert/strict"
import fs from "node:fs"
import path from "node:path"
import vm from "node:vm"
import { transformSync } from "esbuild"

test("ldd использует абсолютный ELF path и search path после смены cwd", async () => {
  const source = fs.readFileSync(new URL("../../scripts/unix-native-preflight.ts", import.meta.url), "utf8")
  const code = transformSync(source.slice(0, source.indexOf("if (import.meta.main)")), { loader: "ts", format: "cjs" }).code
  const module = { exports: {} }
  let inspected = false
  const mocks = {
    "node:assert/strict": assert,
    "node:path": path,
    "node:fs/promises": { lstat: async () => ({ isFile: () => true, mode: 0o755 }), readFile: async () => Buffer.alloc(64), readdir: async () => ["bin/bun"] },
    "node:child_process": { spawnSync(program, args, options) {
      if (program === "ldd") {
        inspected = true
        assert.equal(args[0], path.resolve("native-payload/XneonLauncher/bin/bun"))
        assert.ok(path.isAbsolute(options.cwd))
        assert.equal(options.env.LD_LIBRARY_PATH, [options.cwd, path.join(options.cwd, "cef")].join(":"))
        assert.equal(options.env.LD_PRELOAD, undefined)
      }
      return { status: 0, stdout: program === "readelf" && args[0] === "--dynamic" ? "(NEEDED)" : "", stderr: "" }
    } },
    "./electrobun-artifacts": { validateNativeExecutable() {} },
    "./artifact-checksums": {},
    "../package.json": {},
    "../electrobun/platform/linux-cef": { assertLinuxCefRuntime: bin => ({ libcef: path.join(bin, "libcef.so"), helper: path.join(bin, "bun Helper") }) },
  }
  vm.runInNewContext(code, { module, exports: module.exports, Buffer,
    process: { platform: "linux", arch: "x64", env: { LD_PRELOAD: "/untrusted.so" } },
    Bun: { file: () => ({ slice: () => ({ arrayBuffer: async () => Buffer.from("7f454c46", "hex") }) }) },
    require: name => { assert.ok(Object.hasOwn(mocks, name), name); return mocks[name] },
  })
  await module.exports.inspectUnixBundle("native-payload/XneonLauncher")
  assert.ok(inspected)
})
