import { expect, test } from "bun:test"
import fs from "node:fs/promises"
import path from "node:path"
import { tmpdir } from "node:os"
import { createHash } from "node:crypto"
import { unlinkSync } from "node:fs"
import { recoverModpackInstall, stageModpackInstall, writeModpackDownload, validateModpackPaths } from "../../electrobun/main/builds/modpack-install"
import { createArchive } from "../../electrobun/main/cloud/archive-builder"
import { listArchiveEntries } from "../../packages/xnlc-archives/src/index"
import { excluded } from "../../packages/xnlc-share/src/manifest"
import { packArchiveSync } from "../../packages/xnlc-archives/src/index"

const hash = (value: string) => createHash("sha256").update(value).digest("hex")

test("дубли нормализованных путей и file/directory конфликты отсекаются до записи", () => {
  for (const paths of [["mods/a.jar", "Mods/A.jar"], ["config/é.json", "config/e\u0301.json"], ["mods/a.jar", "mods/a.jar/child"], ["mods/a.jar/child", "mods/a.jar"]]) {
    expect(() => validateModpackPaths(paths)).toThrow()
  }
  expect(() => validateModpackPaths(["mods/a.jar", "mods/b.jar", "config/settings.json"])).not.toThrow()
})

test("повторные обновления сохраняют disabled layout и каноническое имя прежнего файла", () => fixture(async root => {
  await install(root, { "mods/Case.jar": "one" })
  await fs.rename(path.join(root, "mods/Case.jar"), path.join(root, "mods/Case.jar.disabled"))
  await install(root, { "mods/case.jar": "two" })
  await install(root, { "mods/CASE.jar": "three" })
  expect(await fs.readdir(path.join(root, "mods"))).toEqual(["Case.jar.disabled"])
  expect(await fs.readFile(path.join(root, "mods/Case.jar.disabled"), "utf8")).toBe("three")
}))

test("новое имя версии управляемого мода наследует disabled по точной metadata identity", () => fixture(async root => {
  const archives = new Map(["1", "2"].map(version => [version, packArchiveSync({ "fabric.mod.json": Buffer.from(JSON.stringify({ id: "demo", name: "Demo", version })) })]))
  const jar = (version: string) => archives.get(version)!
  for (const [relative, version] of [["mods/demo-1.jar", "1"], ["mods/demo-2.jar", "2"]]) {
    const operation = await stageModpackInstall(root)
    try {
      await fs.mkdir(path.join(operation.directory, "mods"))
      await fs.writeFile(path.join(operation.directory, relative), jar(version))
      await operation.apply(async () => {})
    } finally { await operation.close() }
    if (version === "1") await fs.rename(path.join(root, relative), path.join(root, relative + ".disabled"))
  }
  expect(await fs.readdir(path.join(root, "mods"))).toEqual(["demo-2.jar.disabled"])
  expect(await fs.readFile(path.join(root, "mods/demo-2.jar.disabled"))).toEqual(jar("2"))
}))

test("legacy disabled переносит состояние, но неизвестные пользовательские байты не удаляются", () => fixture(async root => {
  const previous = packArchiveSync({ "fabric.mod.json": Buffer.from('{"id":"legacy","version":"1"}') })
  const incoming = packArchiveSync({ "fabric.mod.json": Buffer.from('{"id":"legacy","version":"2"}') })
  await fs.mkdir(path.join(root, "mods"))
  await fs.writeFile(path.join(root, "mods/user-original.jar.disabled"), previous)
  const operation = await stageModpackInstall(root)
  try {
    await fs.mkdir(path.join(operation.directory, "mods"))
    await fs.writeFile(path.join(operation.directory, "mods/new-version.jar"), incoming)
    await operation.apply(async () => {})
    expect((await fs.readdir(path.join(root, "mods"))).sort()).toEqual(["new-version.jar.disabled", "user-original.jar.disabled"])
    expect(await fs.readFile(path.join(root, "mods/user-original.jar.disabled"))).toEqual(previous)
    expect(await fs.readFile(path.join(root, "mods/new-version.jar.disabled"))).toEqual(incoming)
  } finally { await operation.close() }
}))

test("rollback переименованной disabled-версии восстанавливает прежний layout", () => fixture(async root => {
  const archives = ["1", "2"].map(version => packArchiveSync({ "fabric.mod.json": Buffer.from(JSON.stringify({ id: "rollback", version })) }))
  const first = await stageModpackInstall(root)
  try {
    await fs.mkdir(path.join(first.directory, "mods"))
    await fs.writeFile(path.join(first.directory, "mods/old.jar"), archives[0])
    await first.apply(async () => {})
  } finally { await first.close() }
  await fs.rename(path.join(root, "mods/old.jar"), path.join(root, "mods/old.jar.disabled"))
  const second = await stageModpackInstall(root)
  try {
    await fs.mkdir(path.join(second.directory, "mods"))
    await fs.writeFile(path.join(second.directory, "mods/new.jar"), archives[1])
    await expect(second.apply(async () => { throw new Error("scan failure") })).rejects.toThrow("scan failure")
    expect(await fs.readdir(path.join(root, "mods"))).toEqual(["old.jar.disabled"])
    expect(await fs.readFile(path.join(root, "mods/old.jar.disabled"))).toEqual(archives[0])
  } finally { await second.close() }
}))

test("legacy active JAR с тем же modId блокирует неоднозначную замену до изменения установленного пака", () => fixture(async root => {
  const previous = packArchiveSync({ "fabric.mod.json": Buffer.from('{"id":"legacy","version":"1"}') })
  const incoming = packArchiveSync({ "fabric.mod.json": Buffer.from('{"id":"legacy","version":"2"}') })
  await fs.mkdir(path.join(root, "mods"))
  await fs.writeFile(path.join(root, "mods/user-owned.jar"), previous)
  const operation = await stageModpackInstall(root)
  try {
    await fs.mkdir(path.join(operation.directory, "mods"))
    await fs.writeFile(path.join(operation.directory, "mods/new-version.jar"), incoming)
    await expect(operation.apply(async () => {})).rejects.toMatchObject({ code: "UNMANAGED_MOD_CONFLICT" })
    expect(await fs.readdir(path.join(root, "mods"))).toEqual(["user-owned.jar"])
    expect(await fs.readFile(path.join(root, "mods/user-owned.jar"))).toEqual(previous)
  } finally { await operation.close() }
}))

test("ENOSPC при применении после backup восстанавливает прежние файлы и manifest", () => fixture(async root => {
  await install(root, { "mods/test.jar": "old" })
  const previous = await fs.readFile(path.join(root, ".xnlc-modpack/managed.json"), "utf8")
  const operation = await stageModpackInstall(root)
  const rename = fs.rename
  try {
    const source = path.join(operation.directory, "mods/test.jar")
    await put(operation.directory, "mods/test.jar", "new")
    fs.rename = async (from, to) => {
      if (from === source) throw Object.assign(new Error("No space left on device"), { code: "ENOSPC" })
      return rename(from, to)
    }
    await expect(operation.apply(async () => {})).rejects.toMatchObject({ code: "ENOSPC" })
    expect(await fs.readFile(path.join(root, "mods/test.jar"), "utf8")).toBe("old")
    expect(await fs.readFile(path.join(root, ".xnlc-modpack/managed.json"), "utf8")).toBe(previous)
  } finally { fs.rename = rename; await operation.close() }
}))
async function put(root: string, relative: string, contents: string) {
  const file = path.join(root, relative)
  await fs.mkdir(path.dirname(file), { recursive: true })
  await fs.writeFile(file, contents)
}
async function fixture(run: (root: string) => Promise<void>) {
  const root = await fs.mkdtemp(path.join(tmpdir(), "xnlc-install-"))
  try { await run(root) } finally { await fs.rm(root, { recursive: true, force: true }) }
}
async function install(root: string, files: Record<string, string>, validate = async () => {}) {
  const operation = await stageModpackInstall(root)
  try {
    for (const [name, bytes] of Object.entries(files)) await put(operation.directory, name, bytes)
    await operation.apply(validate)
  } finally { await operation.close() }
}

test("подготовка не меняет установленную версию; отказ удаляет только staging", () => fixture(async root => {
  await put(root, "mods/old.jar", "old")
  const operation = await stageModpackInstall(root)
  await put(operation.directory, "mods/new.jar", "new")
  expect(await fs.readFile(path.join(root, "mods/old.jar"), "utf8")).toBe("old")
  await expect(fs.access(path.join(root, "mods/new.jar"))).rejects.toMatchObject({ code: "ENOENT" })
  await operation.close()
  await expect(fs.access(operation.directory)).rejects.toMatchObject({ code: "ENOENT" })
}))

test("отмена до применения не меняет файлы и manifest", () => fixture(async root => {
  await install(root, { "mods/old.jar": "old" })
  const before = await fs.readFile(path.join(root, ".xnlc-modpack/managed.json"), "utf8")
  const controller = new AbortController()
  const operation = await stageModpackInstall(root, controller.signal)
  try {
    await put(operation.directory, "mods/new.jar", "new")
    controller.abort()
    await expect(operation.apply(async () => {})).rejects.toMatchObject({ name: "AbortError" })
    expect(await fs.readFile(path.join(root, "mods/old.jar"), "utf8")).toBe("old")
    expect(await fs.readFile(path.join(root, ".xnlc-modpack/managed.json"), "utf8")).toBe(before)
  } finally { await operation.close() }
}))

test("отказ финальной проверки откатывает замену, удаление, новые файлы и manifest", () => fixture(async root => {
  await install(root, { "mods/old.jar": "old", "config/test.json": "initial" })
  const before = await fs.readFile(path.join(root, ".xnlc-modpack/managed.json"), "utf8")
  await expect(install(root, { "mods/new.jar": "new", "config/test.json": "updated" }, async () => { throw new Error("scan failed") })).rejects.toThrow("scan failed")
  expect(await fs.readFile(path.join(root, "mods/old.jar"), "utf8")).toBe("old")
  expect(await fs.readFile(path.join(root, "config/test.json"), "utf8")).toBe("initial")
  expect(await fs.readFile(path.join(root, ".xnlc-modpack/managed.json"), "utf8")).toBe(before)
  await expect(fs.access(path.join(root, "mods/new.jar"))).rejects.toMatchObject({ code: "ENOENT" })
}))

test("отмена после записи файлов откатывается до подтверждения commit", () => fixture(async root => {
  await install(root, { "mods/old.jar": "old" })
  const controller = new AbortController()
  const operation = await stageModpackInstall(root, controller.signal)
  try {
    await put(operation.directory, "mods/new.jar", "new")
    await expect(operation.apply(async () => { controller.abort() })).rejects.toMatchObject({ name: "AbortError" })
    expect(await fs.readFile(path.join(root, "mods/old.jar"), "utf8")).toBe("old")
  } finally { await operation.close() }
}))

test("изменённые overrides, legacy-файлы и миры не удаляются и не перезаписываются", () => fixture(async root => {
  await install(root, { "config/test.json": "initial", "mods/old.jar": "old" })
  await put(root, "config/test.json", "personal")
  await put(root, "mods/local.jar", "local")
  await put(root, "saves/world/level.dat", "world")
  await install(root, { "config/test.json": "updated", "mods/local.jar": "pack", "saves/world/level.dat": "replacement", "mods/new.jar": "new" })
  expect(await fs.readFile(path.join(root, "config/test.json"), "utf8")).toBe("personal")
  expect(await fs.readFile(path.join(root, "mods/local.jar"), "utf8")).toBe("local")
  expect(await fs.readFile(path.join(root, "saves/world/level.dat"), "utf8")).toBe("world")
  await expect(fs.access(path.join(root, "mods/old.jar"))).rejects.toMatchObject({ code: "ENOENT" })
}))

test("обновление выключенного пути оставляет файл выключенным", () => fixture(async root => {
  await install(root, { "mods/optional.jar": "old" })
  await fs.rename(path.join(root, "mods/optional.jar"), path.join(root, "mods/optional.jar.disabled"))
  await install(root, { "mods/optional.jar": "updated" })
  expect(await fs.readFile(path.join(root, "mods/optional.jar.disabled"), "utf8")).toBe("updated")
  await expect(fs.access(path.join(root, "mods/optional.jar"))).rejects.toMatchObject({ code: "ENOENT" })
}))

test("конкурентная подготовка получает одного владельца каталога", () => fixture(async root => {
  const results = await Promise.allSettled([stageModpackInstall(root), stageModpackInstall(root)])
  const ready = results.filter((result): result is PromiseFulfilledResult<Awaited<ReturnType<typeof stageModpackInstall>>> => result.status === "fulfilled")
  try { expect(ready).toHaveLength(1) } finally { await Promise.all(ready.map(result => result.value.close())) }
  expect(results.filter(result => result.status === "rejected")).toHaveLength(1)
}))

test("проверка перед применением может запретить установку при запущенной игре", () => fixture(async root => {
  await put(root, "mods/old.jar", "old")
  const operation = await stageModpackInstall(root, undefined, () => { throw new Error("game running") })
  try {
    await put(operation.directory, "mods/new.jar", "new")
    await expect(operation.apply(async () => {})).rejects.toThrow("game running")
    expect(await fs.readFile(path.join(root, "mods/old.jar"), "utf8")).toBe("old")
  } finally { await operation.close() }
}))

test("ссылка в каталоге назначения не используется для записи", () => fixture(async root => {
  await fs.mkdir(path.join(root, "outside"))
  await fs.symlink(path.join(root, "outside"), path.join(root, "mods"), "junction")
  await expect(install(root, { "mods/test.jar": "new" })).rejects.toThrow("link")
  expect(await fs.readdir(path.join(root, "outside"))).toEqual([])
}))

test("ссылка вместо служебного каталога отклоняется без очистки её содержимого", () => fixture(async root => {
  const outside = path.join(root, "outside")
  await put(outside, "keep", "keep")
  await fs.symlink(outside, path.join(root, ".xnlc-modpack"), "junction")
  await expect(stageModpackInstall(root)).rejects.toThrow("link")
  expect(await fs.readFile(path.join(outside, "keep"), "utf8")).toBe("keep")
}))

test("входной архив не может заменить manifest установщика", () => fixture(async root => {
  await expect(install(root, { ".xnlc-modpack/managed.json": "{}" })).rejects.toThrow("installation state")
}))

for (const installed of [false, true]) {
  test(`восстановление после остановки процесса: новый файл записан=${installed}`, () => fixture(async root => {
    const transaction = path.join(root, ".xnlc-modpack/transaction")
    await put(transaction, "0.old", "old")
    if (installed) await put(root, "mods/test.jar", "new")
    await put(transaction, "journal.json", JSON.stringify({ version: 1, committed: false, changes: [{ path: "mods/test.jar", before: hash("old"), after: hash("new") }] }))
    await recoverModpackInstall(root)
    expect(await fs.readFile(path.join(root, "mods/test.jar"), "utf8")).toBe("old")
    await recoverModpackInstall(root)
    await expect(fs.access(transaction)).rejects.toMatchObject({ code: "ENOENT" })
  }))
}

test("восстановление не затирает правки после аварии и сохраняет резервную копию", () => fixture(async root => {
  const transaction = path.join(root, ".xnlc-modpack/transaction")
  await put(transaction, "0.old", "old")
  await put(root, "mods/test.jar", "user after crash")
  await put(transaction, "journal.json", JSON.stringify({ version: 1, committed: false, changes: [{ path: "mods/test.jar", before: hash("old"), after: hash("new") }] }))
  await expect(recoverModpackInstall(root)).rejects.toThrow("recovery conflict")
  expect(await fs.readFile(path.join(root, "mods/test.jar"), "utf8")).toBe("user after crash")
  expect(await fs.readFile(path.join(transaction, "0.old"), "utf8")).toBe("old")
}))

test("некорректный журнал отклоняется до изменения файлов", () => fixture(async root => {
  const transaction = path.join(root, ".xnlc-modpack/transaction")
  await put(root, "keep", "keep")
  await put(transaction, "journal.json", JSON.stringify({ version: 1, committed: false, changes: [{ path: "../keep", before: null, after: hash("keep") }] }))
  await expect(recoverModpackInstall(root)).rejects.toThrow("Invalid modpack file path")
  expect(await fs.readFile(path.join(root, "keep"), "utf8")).toBe("keep")
}))

test("подтверждённый журнал только удаляет backup, не откатывая новую версию", () => fixture(async root => {
  const transaction = path.join(root, ".xnlc-modpack/transaction")
  await put(transaction, "0.old", "old")
  await put(root, "mods/test.jar", "new")
  await put(transaction, "journal.json", JSON.stringify({ version: 1, committed: true, changes: [{ path: "mods/test.jar", before: hash("old"), after: hash("new") }] }))
  await recoverModpackInstall(root)
  expect(await fs.readFile(path.join(root, "mods/test.jar"), "utf8")).toBe("new")
}))

test("неверный sha1/sha512 не создаёт staged-файл", () => fixture(async root => {
  for (const hashes of [{ sha1: "0".repeat(40) }, { sha512: "0".repeat(128) }, { sha1: "invalid" }]) {
    const file = path.join(root, "test.jar")
    await expect(writeModpackDownload(file, Buffer.from("new"), hashes)).rejects.toThrow("mismatch")
    await expect(fs.access(file)).rejects.toMatchObject({ code: "ENOENT" })
  }
}))

test("сбой rename после backup восстанавливает исходный файл", () => fixture(async root => {
  await install(root, { "mods/test.jar": "old" })
  const operation = await stageModpackInstall(root, undefined, () => unlinkSync(path.join(operation.directory, "mods/test.jar")))
  try {
    await put(operation.directory, "mods/test.jar", "new")
    await expect(operation.apply(async () => {})).rejects.toMatchObject({ code: "ENOENT" })
    expect(await fs.readFile(path.join(root, "mods/test.jar"), "utf8")).toBe("old")
  } finally { await operation.close() }
}))

test("реальное аварийное завершение процесса оставляет восстанавливаемый журнал", () => fixture(async root => {
  await install(root, { "mods/old.jar": "old" })
  const code = `
    import fs from "node:fs/promises"
    import path from "node:path"
    import { stageModpackInstall } from "./electrobun/main/builds/modpack-install.ts"
    const operation = await stageModpackInstall(process.env.INSTALL_TEST_ROOT)
    await fs.mkdir(path.join(operation.directory, "mods"))
    await fs.writeFile(path.join(operation.directory, "mods/new.jar"), "new")
    await operation.apply(async () => process.exit(23))
  `
  const result = Bun.spawnSync([process.execPath, "--no-env-file", "-e", code], { env: { ...process.env, INSTALL_TEST_ROOT: root }, stdout: "pipe", stderr: "pipe" })
  expect(result.exitCode).toBe(23)
  expect(await fs.readFile(path.join(root, "mods/new.jar"), "utf8")).toBe("new")
  await recoverModpackInstall(root)
  expect(await fs.readFile(path.join(root, "mods/old.jar"), "utf8")).toBe("old")
  await expect(fs.access(path.join(root, "mods/new.jar"))).rejects.toMatchObject({ code: "ENOENT" })
}))

test("CurseForge сохраняет опубликованные SHA-1 и размер для проверки загрузки", async () => {
  const original = globalThis.fetch
  try {
    globalThis.fetch = async () => Response.json({ data: [{ id: 1, modId: 2, fileName: "test.jar", fileLength: 3, downloadUrl: "https://fixture.invalid/mod", hashes: [{ algo: 1, value: "a".repeat(40) }] }] })
    const { curseforgeGetFiles } = await import("../../packages/xnlc-mods/src/curseforge-client")
    const files = await curseforgeGetFiles([1])
    expect(files[1].sha1).toBe("a".repeat(40))
    expect(files[1].fileLength).toBe(3)
  } finally { globalThis.fetch = original }
})

test("служебный журнал не попадает в облачный архив и публикацию Share", () => fixture(async root => {
  await put(root, "mods/local.jar", "local")
  await put(root, ".xnlc-modpack/transaction/0.old", "backup")
  await put(root, ".xnlc-modpack/managed.json", "{}")
  const output = path.join(root, "export.zip")
  await createArchive(root, output)
  const entries = (await listArchiveEntries(output)).filter(entry => !entry.directory).map(entry => entry.name)
  expect(entries).toEqual(["mods/local.jar"])
  expect(excluded(".xnlc-modpack/transaction/0.old")).toBe(true)
  expect(excluded(".xnlc-modpack/managed.json")).toBe(true)
}))
