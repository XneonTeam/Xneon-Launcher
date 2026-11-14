import test from "node:test"
import assert from "node:assert/strict"
import fs from "node:fs"
import path from "node:path"
import vm from "node:vm"
import { transformSync } from "esbuild"
import { parseLinuxCmdline, parseDarwinProcArgs } from "../../electrobun/platform/unix-launcher-args.ts"

test("bootstrap использует общий адаптер аргументов launcher", () => {
  const source = fs.readFileSync(new URL("../../electrobun/main/bootstrap.ts", import.meta.url), "utf8")
  assert.equal(source.includes("await readLauncherArgs()"), true)
})

const argv = ["/app/launcher", "--launch", "Сборка с пробелами 尾", "", "--option"]
test("Linux cmdline сохраняет Unicode и пустые аргументы", () => {
  assert.deepEqual(parseLinuxCmdline(Buffer.from(argv.join("\0") + "\0")), argv.slice(1))
  assert.deepEqual(parseLinuxCmdline(Buffer.from("truncated")), [])
  assert.deepEqual(parseLinuxCmdline(Buffer.alloc(0)), [])
})

function macBuffer(argumentsList = argv) {
  const argc = Buffer.alloc(4)
  argc.writeInt32LE(argumentsList.length)
  return Buffer.concat([argc, Buffer.from("/app/launcher\0\0\0\0"), Buffer.from(argumentsList.join("\0") + "\0"), Buffer.from("PRIVATE_ENV=not-an-argument\0")])
}

test("KERN_PROCARGS2: argc, executable, padding, Unicode, пустой аргумент; без env", () => {
  assert.deepEqual(parseDarwinProcArgs(macBuffer()), argv.slice(1))
  assert.deepEqual(parseDarwinProcArgs(macBuffer(["/app/launcher"])), [])
  const bad = macBuffer()
  bad.writeInt32LE(-1)
  assert.deepEqual(parseDarwinProcArgs(bad), [])
  assert.deepEqual(parseDarwinProcArgs(macBuffer().subarray(0, 10)), [])
})

for (const platform of ["linux", "darwin"]) {
  for (const matched of [true, false]) {
    test(`parent ${platform}: подтверждён=${matched}`, () => {
      const source = fs.readFileSync(new URL("../../electrobun/platform/unix-launcher-args.ts", import.meta.url), "utf8")
      const module = { exports: {} }
      let commandRead = false
      vm.runInNewContext(transformSync(source, { loader: "ts", format: "cjs" }).code, {
        module, Buffer, process: { platform, ppid: 123, execPath: "/app/bun" }, require: name => {
          if (name === "node:path") return path.posix
          if (name === "node:fs") return {
            realpathSync: value => value,
            readlinkSync: () => matched ? "/app/launcher" : "/app/other",
            readFileSync: () => { commandRead = true; return Buffer.from(argv.join("\0") + "\0") },
          }
          return { ptr: value => value, dlopen: file => ({ close() {}, symbols: file.includes("libproc") ? {
            proc_pidpath: (pid, buffer) => { assert.equal(pid, 123); return buffer.write(matched ? "/app/launcher" : "/app/other") },
          } : {
            sysctl: (mib, count, buffer, size) => {
              commandRead = true
              assert.deepEqual([...mib], [1, 49, 123]); assert.equal(count, 3)
              const data = macBuffer()
              size[0] = BigInt(data.length)
              if (buffer) data.copy(buffer)
              return 0
            },
          } }) }
        },
      })
      assert.deepEqual([...module.exports.readUnixLauncherArgs()], matched ? argv.slice(1) : [])
      assert.equal(commandRead, matched)
    })
  }
}
