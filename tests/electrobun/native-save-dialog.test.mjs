import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import fs from "node:fs"
import path from "node:path"
import test from "node:test"
import vm from "node:vm"
import { transformSync } from "esbuild"

const root = path.resolve(import.meta.dir, "../..")
const source = fs.readFileSync(path.join(root, "electrobun/platform/windows-native.ts"), "utf8")
const saveSource = source.match(/export async function saveFile\([\s\S]*?\n\}/)?.[0]
assert.ok(saveSource)
const saveCode = transformSync(saveSource + "\nmodule.exports = saveFile", { loader: "ts", format: "cjs" }).code

function fixture({ selected = "C:\\Экспорт\\мир.zip", backend = "ffi", exists = true, error } = {}) {
  const calls = []
  const errors = []
  const file = "C:\\bundle\\Resources\\app\\native\\nfd\\win32-x64\\nfd.dll"
  const module = { exports: {} }
  vm.runInNewContext(saveCode, {
    module, exports: module.exports, path: path.win32,
    process: { platform: "win32" },
    nativeFileDialogLibraryPath: () => file,
    existsSync: name => { assert.equal(name, file); return exists },
    console: { error: (...args) => errors.push(args) },
    nfd: {
      setLibraryPath: directory => calls.push(["library", directory]),
      getBackendName: () => { calls.push(["backend"]); return backend },
      saveFile: async options => { calls.push(["save", options]); if (error) throw error; return selected },
    },
    powershell: "powershell.exe", startup: [],
    exec: () => { throw new Error("PowerShell save dialog must not be used") },
  })
  return { save: module.exports, calls, errors, file }
}

test("сохранение использует FFI и сохраняет контракт пути, имени и фильтров", async () => {
  const f = fixture()
  const filters = [{ name: "Архив", extensions: ["zip", "mrpack"] }]
  const result = await f.save("C:\\Экспорт\\сборка.zip", filters)
  assert.deepEqual({ ...result }, { canceled: false, filePath: "C:\\Экспорт\\мир.zip" })
  assert.deepEqual(f.calls.slice(0, 2), [["library", path.win32.dirname(f.file)], ["backend"]])
  assert.deepEqual({ ...f.calls[2][1] }, { defaultPath: "C:\\Экспорт", defaultName: "сборка.zip", filters })
})

test("отмена нативного диалога возвращает прежний canceled/filePath", async () => {
  const f = fixture({ selected: null })
  assert.deepEqual({ ...await f.save("theme.xntheme") }, { canceled: true, filePath: undefined })
  assert.equal(f.calls[2][1].defaultName, "theme.xntheme")
  assert.equal(f.calls[2][1].defaultPath, undefined)
})

test("вызов без параметров не подставляет имя или фильтр", async () => {
  const f = fixture()
  await f.save()
  assert.deepEqual({ ...f.calls[2][1] }, { defaultPath: undefined, defaultName: undefined, filters: undefined })
})

test("отсутствующий бинарник запрещает инициализацию и тихий фолбэк", async () => {
  const f = fixture({ exists: false })
  await assert.rejects(f.save("test.zip"), /Native file dialog library is missing/)
  assert.deepEqual(f.calls, [])
  assert.equal(f.errors.length, 1)
})

for (const backend of ["windows", "macos", "linux", "unknown"]) {
  test(`бэкенд ${backend} не открывает скриптовый диалог`, async () => {
    const f = fixture({ backend })
    await assert.rejects(f.save("test.zip"), /Native file dialog FFI backend is unavailable/)
    assert.equal(f.calls.some(([name]) => name === "save"), false)
    assert.equal(f.errors.length, 1)
  })
}

test("ошибка нативной библиотеки логируется и передаётся вызывающему коду", async () => {
  const error = new Error("NFD failed")
  const f = fixture({ error })
  await assert.rejects(f.save(), candidate => candidate === error)
  assert.equal(f.errors.length, 1)
})

function resourcesFixture(platform, arch, packaged) {
  const p = platform === "win32" ? path.win32 : path.posix
  const execPath = platform === "win32" ? "C:\\bundle\\bin\\bun.exe"
    : platform === "darwin" ? "/bundle/Contents/MacOS/bun" : "/bundle/bin/bun"
  const moduleDirectory = platform === "win32" ? "C:\\repo\\electrobun\\platform" : "/repo/electrobun/platform"
  const resources = p.resolve(p.dirname(execPath), "..", "Resources", "app")
  const module = { exports: {} }
  const resourceSource = fs.readFileSync(path.join(root, "electrobun/platform/resources.ts"), "utf8")
    .replaceAll("import.meta.dir", JSON.stringify(moduleDirectory))
  const code = transformSync(resourceSource, { loader: "ts", format: "cjs" }).code
  vm.runInNewContext(code, { module, exports: module.exports,
    require: name => name === "node:path" ? p : { existsSync: file => packaged && file === resources },
    process: { platform, arch, execPath },
  })
  assert.equal(typeof module.exports.nativeFileDialogLibraryPath, "function")
  return { resolve: module.exports.nativeFileDialogLibraryPath, resources, moduleDirectory, p }
}

for (const [platform, arch, filename] of [["win32", "x64", "nfd.dll"], ["darwin", "arm64", "libnfd.dylib"], ["darwin", "x64", "libnfd.dylib"], ["linux", "x64", "libnfd.so"]]) {
  for (const packaged of [true, false]) {
    test(`${platform}-${arch}: путь к библиотеке в ${packaged ? "бандле" : "исходниках"}`, () => {
      const f = resourcesFixture(platform, arch, packaged)
      const base = packaged ? f.p.join(f.resources, "native/nfd") : f.p.resolve(f.moduleDirectory, "../../assets/native/nfd")
      assert.equal(f.resolve(), f.p.join(base, `${platform}-${arch}`, filename))
    })
  }
}

test("неподдерживаемая архитектура не переключается на скриптовый бэкенд", () => {
  const f = resourcesFixture("linux", "arm64", false)
  assert.throws(f.resolve, /Unsupported native file dialog platform/)
})

test("все вендоренные бинарники совпадают с SHA-256 релиза", () => {
  const directory = path.join(root, "assets/native/nfd")
  const manifest = JSON.parse(fs.readFileSync(path.join(directory, "manifest.json"), "utf8"))
  assert.equal(manifest.version, "0.3.2")
  assert.equal(manifest.files.length, 4)
  for (const entry of manifest.files) {
    assert.equal(createHash("sha256").update(fs.readFileSync(path.join(directory, entry.path))).digest("hex"), entry.sha256)
  }
})

test("Electrobun копирует вендоренный каталог в Resources/app/native/nfd", () => {
  const code = transformSync(fs.readFileSync(path.join(root, "electrobun.config.ts"), "utf8"), { loader: "ts", format: "cjs" }).code
  const module = { exports: {} }
  vm.runInNewContext(code, { module, exports: module.exports, process: { platform: "win32", arch: "x64", env: {} }, require: name => {
    if (name === "./package.json") return { version: "1.0.8", description: "test" }
    if (name.endsWith("app-identity")) return { appIdentifier: "test", portableAppIdentifier: "test.portable" }
    throw new Error("Unexpected dependency: " + name)
  } })
  assert.equal(module.exports.default.build.copy["assets/native/nfd"], "native/nfd")
})
