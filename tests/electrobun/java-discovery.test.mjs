import test from "node:test"
import assert from "node:assert/strict"
import fs from "node:fs"
import path from "node:path"
import os from "node:os"
import vm from "node:vm"
import { transformSync } from "esbuild"
import { findExecutablesInPath } from "../../electrobun/platform/executable-path.ts"
import { readJavaHomesFromRegistry } from "../../electrobun/platform/java-registry.ts"
import { execFile } from "node:child_process"

const helperSource = fs.readFileSync(new URL("../../electrobun/main/import/helpers.ts", import.meta.url), "utf8")
const helperBody = helperSource.match(/export function execFileAsync\([\s\S]*?\n\}/)?.[0]
const helperCode = transformSync(helperBody + "\nmodule.exports = execFileAsync", { loader: "ts", format: "cjs" }).code
const helperModule = { exports: {} }
vm.runInNewContext(helperCode, { module: helperModule, execFile })
const run = helperModule.exports

function javaParser(execute = run) {
  const source = fs.readFileSync(new URL("../../electrobun/main/system.ts", import.meta.url), "utf8")
  const body = source.slice(source.indexOf("async function getJavaVersion"), source.indexOf("function makeJavaLabel"))
  return vm.runInNewContext(transformSync(body, { loader: "ts" }).code + "\ngetJavaInstallationInfo", { execFileAsync: execute })
}

test("поиск Java и NSIS не запускает where/which", () => {
  const source = fs.readFileSync(new URL("../../electrobun/main/system.ts", import.meta.url), "utf8")
  assert.equal(/execAsync\("(?:where|which)|execFileSync\("where"/.test(source), false)
  const build = fs.readFileSync(new URL("../../scripts/build-windows-distribution.ts", import.meta.url), "utf8")
  assert.equal(build.includes('Bun.spawnSync(["where.exe"'), false)
})
test("PATH: все совпадения, PATHEXT, пробелы/кириллица и удаление дублей", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "java-path-"))
  try {
    const directories = ["Java папка 1", "Java папка 2"].map(name => path.join(root, name))
    for (const dir of directories) {
      fs.mkdirSync(dir)
      fs.writeFileSync(path.join(dir, "java.EXE"), "fixture", { mode: 0o755 })
    }
    const name = process.platform === "win32" ? "java" : "java.EXE"
    const found = findExecutablesInPath(name, { PATH: [...directories, directories[0]].join(path.delimiter), PATHEXT: ".EXE;.CMD" })
    assert.deepEqual(found.map(file => path.dirname(file)), directories)
  } finally { fs.rmSync(root, { recursive: true, force: true }) }
})

test("проверка Java не использует shell-перенаправления или CP866", () => {
  const source = fs.readFileSync(new URL("../../electrobun/main/system.ts", import.meta.url), "utf8")
  const code = source.slice(source.indexOf("async function getJavaVersion"), source.indexOf("function makeJavaLabel"))
  assert.equal(/2>&1|cp866|execAsync\(/.test(code), false)
})
test("реестр Java не читается через reg.exe или shell", () => {
  const source = fs.readFileSync(new URL("../../electrobun/main/system.ts", import.meta.url), "utf8")
  assert.equal(/reg query|execAsync\(/.test(source), false)
})

test("прямой запуск: Unicode/пробелы в пути, отдельные потоки, shell-символы в аргументе", async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "Ява с пробелами-"))
  try {
    const executable = path.join(directory, process.platform === "win32" ? "java.exe" : "java")
    fs.linkSync(process.execPath, executable)
    const argument = 'кириллица & | > ; $() 尾'
    const result = await run(executable, ["-e", 'process.stdout.write(process.argv.at(-1)); process.stderr.write("version from stderr")', "--", argument], { timeout: 4000 })
    assert.equal(result.stdout, argument)
    assert.equal(result.stderr, "version from stderr")
    await assert.rejects(run(executable, ["-e", "setInterval(()=>{},1000)"], { timeout: 150 }))
    await assert.rejects(run(executable, ["-e", "process.exit(3)"], { timeout: 4000 }))
  } finally { fs.rmSync(directory, { recursive: true, force: true }) }
})

test("Java: разбор stderr/stdout и fallback -version", async () => {
  for (const stream of ["stdout", "stderr"]) {
    const parse = javaParser(async (_file, args) => {
      assert.deepEqual([...args], ["-XshowSettings:properties", "-version"])
      return { stdout: "", stderr: "", [stream]: ' java.version = 21.0.1\n java.vendor = Тестовый поставщик\n sun.arch.data.model = 64\n' }
    })
    assert.deepEqual({ ...await parse("C:\\Ява с пробелами\\java.exe") }, { version: "21.0.1", fullVersion: "21.0.1", vendor: "Тестовый поставщик", arch: "64" })
  }
  const calls = []
  const parse = javaParser(async (_file, args) => {
    calls.push([...args])
    return { stdout: "", stderr: args.length === 1 ? 'openjdk version "17.0.2"' : "no properties" }
  })
  assert.equal((await parse("java")).version, "17.0.2")
  assert.deepEqual(calls, [["-XshowSettings:properties", "-version"], ["-version"]])
})

test("реестр: оба WOW64-представления, Unicode и закрытие ключей при ошибке", () => {
  const source = fs.readFileSync(new URL("../../electrobun/platform/java-registry.ts", import.meta.url), "utf8")
  const code = transformSync(source, { loader: "ts", format: "cjs" }).code
  for (const fail of [false, true]) {
    let next = 1n
    const open = new Map()
    const views = new Set()
    let closed = 0
    const symbols = {
      RegOpenKeyExW: (parent, name, _options, flags, output) => {
        const key = name.toString("utf16le").replace(/\0$/, "")
        if (parent === 0xffffffff80000002n && !key.endsWith("\\JDK")) return 2
        const view = flags & 0x300
        assert.equal(flags & 0x20019, 0x20019)
        views.add(view)
        output[0] = next++
        open.set(output[0], { child: parent !== 0xffffffff80000002n, view })
        return 0
      },
      RegGetValueW: (key, _subkey, name, flags, _type, data, size) => {
        if (fail) throw new Error("simulated registry failure")
        const entry = open.get(key)
        if (!entry.child || name.toString("utf16le") !== "JavaHome\0") return 2
        assert.equal(flags, 6)
        const value = Buffer.from(`C:\\Ява с пробелами ${entry.view}\0`, "utf16le")
        size[0] = value.length
        if (data) value.copy(data)
        return 0
      },
      RegEnumKeyExW: (key, index, name, length) => {
        if (open.get(key).child || index > 0) return 259
        name.write("версия", "utf16le"); length[0] = 6; return 0
      },
      RegCloseKey: key => { assert.ok(open.delete(key)); closed++; return 0 },
    }
    let unloaded = false
    const module = { exports: {} }
    vm.runInNewContext(code, { module, Buffer, process: { platform: "win32" }, require: () => ({ ptr: value => value, dlopen: () => ({ symbols, close: () => { unloaded = true } }) }) })
    if (fail) assert.throws(module.exports.readJavaHomesFromRegistry, /simulated/)
    else {
      assert.deepEqual([...module.exports.readJavaHomesFromRegistry()], ["C:\\Ява с пробелами 256", "C:\\Ява с пробелами 512"])
      assert.deepEqual([...views], [0x100, 0x200])
    }
    assert.equal(open.size, 0)
    assert.ok(closed > 0)
    assert.equal(unloaded, true)
  }
})

test("реальная Windows: обнаруженные JDK из реестра и PATH запускаются напрямую", { skip: process.platform !== "win32" }, async () => {
  const homes = readJavaHomesFromRegistry()
  const candidates = [...homes.map(home => path.join(home, "bin/java.exe")), ...findExecutablesInPath("java")]
  const versions = []
  for (const file of new Set(candidates)) {
    if (!fs.existsSync(file) || !file.toLowerCase().endsWith(".exe")) continue
    const info = await javaParser()(file)
    if (info) versions.push(info.version)
  }
  console.log(`Java: реестр=${homes.length}, PATH=${findExecutablesInPath("java").length}, проверенные версии=${versions.join(", ") || "нет установленных JDK"}`)
  if (candidates.some(file => fs.existsSync(file) && file.toLowerCase().endsWith(".exe"))) assert.ok(versions.length > 0)
})

test("NSIS: переменная окружения важнее Bun.which, резервные пути сохранены", () => {
  const source = fs.readFileSync(new URL("../../scripts/build-windows-distribution.ts", import.meta.url), "utf8")
  const code = transformSync(source.slice(source.indexOf("function findMakensis")), { loader: "ts" }).code
  const f = (env, onPath = "path.exe") => vm.runInNewContext(code + "\nfindMakensis()", {
    process: { env }, assert, path, existsSync: file => file === "custom.exe" || file.endsWith("NSIS\\makensis.exe"),
    Bun: { which: () => onPath }, readdirSyncSafe: () => [],
  })
  assert.equal(f({ XNEON_MAKENSIS: "custom.exe" }), "custom.exe")
  assert.equal(f({}), "path.exe")
  assert.equal(f({}, null), path.join("C:\\Program Files", "NSIS", "makensis.exe"))
  assert.throws(() => f({ XNEON_MAKENSIS: "missing.exe" }), /does not exist/)
})

test("реальный JDK запускается через путь с пробелами и кириллицей", { skip: process.platform !== "win32" }, async context => {
  const home = readJavaHomesFromRegistry().find(home => fs.existsSync(path.join(home, "bin/java.exe")))
  if (!home) { context.skip("Нет установленного JDK в реестре"); return }
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "java-unicode-"))
  const link = path.join(directory, "Java кириллица с пробелами 尾")
  try {
    fs.symlinkSync(home, link, "junction")
    const info = await javaParser()(path.join(link, "bin/java.exe"))
    assert.ok(info?.version)
    console.log(`Настоящая Java через Unicode-путь: ${info.version}`)
  } finally {
    if (fs.existsSync(link)) fs.unlinkSync(link) // Удаляем только тестовую ссылку, не целевой JDK.
    fs.rmdirSync(directory)
  }
})
