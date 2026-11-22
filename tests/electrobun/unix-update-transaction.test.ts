// Атомарная замена установленного приложения (file/directory), native exchange,
// снимок БД и защита профиля от размещения внутри заменяемого app.
import { expect, test } from "bun:test"
import { lstat, mkdir, mkdtemp, readFile, realpath, rename, rm, symlink, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import Database from "../../electrobun/platform/sqlite"
import { applyUnixUpdateTransaction, unixTransactionPaths, type UnixReplacementPorts } from "../../electrobun/main/unix-update-transaction"
import { exchangeUnixUpdatePaths, probeUnixUpdateExchange } from "../../electrobun/main/unix-update-atomic"
import { backupUnixUpdateDatabase } from "../../electrobun/main/unix-update-profile"
import { assertUnixUpdateStorageOutsideInstallation } from "../../electrobun/main/unix-update-storage"

const nonce = "a".repeat(32)
async function transactionFixture(kind: "file" | "directory", action: (plan: any, read: () => Promise<string>, ports: UnixReplacementPorts) => Promise<void>) {
  const root = await realpath(await mkdtemp(path.join(os.tmpdir(), "xneon-swap-test-")))
  try {
    const target = path.join(root, kind === "file" ? "Xneon.AppImage" : "Xneon.app"), work = path.join(root, `.xneon-update-${nonce}`)
    await mkdir(work)
    const prepared = path.join(work, "next")
    if (kind === "directory") { await mkdir(target); await mkdir(prepared) }
    const file = (base: string) => kind === "file" ? base : path.join(base, "identity")
    await writeFile(file(target), "A"); await writeFile(file(prepared), "B")
    const read = () => readFile(file(target), "utf8")
    const ports: UnixReplacementPorts = { waitForParentExit: async () => { expect(await read()).toBe("A") },
      verifyCurrent: async () => { expect(await read()).toBe("A") }, verifyPrepared: async () => { expect(await readFile(file(prepared), "utf8")).toBe("B") },
      launch: async () => { expect(await read()).toBe("B"); return { pid: 123 } }, waitHealthy: async () => true, stop: async () => {} }
    await action({ target, nonce, kind }, read, ports)
  } finally { await rm(root, { recursive: true, force: true }) }
}
const backupFile = (kind: "file" | "directory", backup: string) => kind === "file" ? backup : path.join(backup, "identity")

for (const kind of ["file", "directory"] as const) {
  test(`замена ${kind}: ждёт выхода A и сохраняет backup до подтверждения B`, () => transactionFixture(kind, async (plan, read, ports) => {
    const result = await applyUnixUpdateTransaction(plan, ports)
    expect(await read()).toBe("B")
    expect(result.status).toBe("committed")
    expect(await readFile(backupFile(kind, result.backup), "utf8")).toBe("A")
  }))
  test(`неудачный запуск B (${kind}) останавливает процесс, пишет failed и не откатывает A`, () => transactionFixture(kind, async (plan, read, ports) => {
    let stopped = false
    await expect(applyUnixUpdateTransaction(plan, { ...ports, waitHealthy: async () => false,
      stop: async () => { expect(await read()).toBe("B"); stopped = true } })).rejects.toThrow(/update-startup-failed/)
    expect(stopped).toBe(true)
    // Автоматического отката нет: target остаётся B, previous сохранён для ручного восстановления.
    expect(await read()).toBe("B")
    const files = unixTransactionPaths(plan)
    expect(JSON.parse(await readFile(files.journal, "utf8")).phase).toBe("failed")
    expect(await readFile(backupFile(kind, files.backup), "utf8")).toBe("A")
  }))
}

test("отмена до handoff не меняет установленное приложение", () => transactionFixture("file", async (plan, read, ports) => {
  const controller = new AbortController(); controller.abort()
  await expect(applyUnixUpdateTransaction(plan, ports, controller.signal)).rejects.toThrow()
  expect(await read()).toBe("A")
}))

test("сбой rename после переноса A не откатывает, но сохраняет previous и фиксирует failed", () => transactionFixture("directory", async (plan, _read, ports) => {
  const files = unixTransactionPaths(plan)
  let failed = false
  await expect(applyUnixUpdateTransaction(plan, ports, undefined, { rename: async (from, to) => {
    if (!failed && from.endsWith(path.sep + "next")) { failed = true; throw Object.assign(new Error("Disk full"), { code: "ENOSPC" }) }
    await rename(from, to)
  } })).rejects.toThrow(/Disk full/)
  // Двухшаговый fallback (только Windows-fixture): target временно отсутствует, A лежит в previous.
  expect(await readFile(path.join(files.backup, "identity"), "utf8")).toBe("A")
  expect(JSON.parse(await readFile(files.journal, "utf8")).phase).toBe("failed")
}))

test("symlink вместо установленного файла не заменяется", () => transactionFixture("file", async (plan, _read, ports) => {
  const real = plan.target + ".real"
  await rename(plan.target, real); await symlink(real, plan.target)
  await expect(applyUnixUpdateTransaction(plan, ports)).rejects.toThrow()
  expect(await readFile(real, "utf8")).toBe("A")
}))

test("directory strategy использует exchange и не оставляет target отсутствующим между rename", () => transactionFixture("directory", async (plan, read, ports) => {
  let exchanges = 0, removedTarget = false
  const exchange = async (left: string, right: string) => {
    // Mock протокола exchange на Windows, а не доказательство атомарности файловой системы.
    exchanges++
    const temporary = right + ".exchange"
    await rename(left, temporary); await rename(right, left); await rename(temporary, right)
  }
  await applyUnixUpdateTransaction(plan, ports, undefined, { exchange, rename: async (from, to) => {
    if (from === plan.target) removedTarget = true
    await rename(from, to)
  } })
  expect(await read()).toBe("B")
  expect(exchanges).toBe(1)
  expect(removedTarget).toBe(false)
}))

const nativeTest = process.platform === "win32" ? test.skip : test
nativeTest("native exchange меняет две directory entries и сохраняет обе версии", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "xneon-exchange-test-")), a = path.join(root, "A.app"), b = path.join(root, "B.app")
  try {
    await mkdir(a); await mkdir(b); await writeFile(path.join(a, "version"), "A"); await writeFile(path.join(b, "version"), "B")
    await probeUnixUpdateExchange(root)
    exchangeUnixUpdatePaths(a, b)
    expect(await readFile(path.join(a, "version"), "utf8")).toBe("B")
    expect(await readFile(path.join(b, "version"), "utf8")).toBe("A")
  } finally { await rm(root, { recursive: true, force: true }) }
})

async function profileFixture(action: (database: string, snapshot: string, directory: string) => Promise<void>) {
  const root = await mkdtemp(path.join(os.tmpdir(), "xneon-profile-test-")), snapshot = path.join(root, "snapshot")
  await mkdir(snapshot, { mode: 0o700 })
  try { await action(path.join(root, "data.db"), snapshot, root) } finally { await rm(root, { recursive: true, force: true }) }
}

test("snapshot фиксирует committed WAL, не меняет актуальную БД и не перезаписывает ручное восстановление", () => profileFixture(async (file, snapshot) => {
  let db = new Database(file)
  db.exec("PRAGMA journal_mode=WAL; CREATE TABLE settings(key TEXT PRIMARY KEY, value TEXT); INSERT INTO settings VALUES ('theme','A'); PRAGMA user_version=1")
  await backupUnixUpdateDatabase(file, snapshot)
  db.close()
  db = new Database(file)
  db.exec("UPDATE settings SET value='B'; ALTER TABLE settings ADD COLUMN changed TEXT; PRAGMA user_version=2"); db.close()
  const saved = new Database(path.join(snapshot, "previous-data.db"), { readonly: true, fileMustExist: true })
  try {
    expect(saved.query<{ value: string }, []>("SELECT value FROM settings").get()?.value).toBe("A")
    expect(saved.pragma("user_version", { simple: true })).toBe(1)
    expect(saved.query("PRAGMA quick_check").get()).toEqual({ quick_check: "ok" })
  } finally { saved.close() }
  db = new Database(file)
  try {
    expect(db.query<{ value: string }, []>("SELECT value FROM settings").get()?.value).toBe("B")
    expect(db.pragma("user_version", { simple: true })).toBe(2)
  } finally { db.close() }
  const record = JSON.parse(await readFile(path.join(snapshot, "database-snapshot.json"), "utf8"))
  expect(record.schemaVersion).toBe(1)
  expect(record.database).toBe(await realpath(file))
  expect(record.existed).toBe(true)
  expect(record.size).toBe((await lstat(path.join(snapshot, "previous-data.db"))).size)
  expect(record.sha256).toMatch(/^[a-f0-9]{64}$/)
  await expect(backupUnixUpdateDatabase(file, snapshot)).rejects.toThrow(/already exists/)
}))

test("symlink вместо БД не читается как snapshot и не заменяется", () => profileFixture(async (file, snapshot, directory) => {
  const outside = path.join(directory, "outside.db")
  const db = new Database(outside); db.exec("CREATE TABLE sentinel(value TEXT)"); db.close()
  await symlink(outside, file)
  await expect(backupUnixUpdateDatabase(file, snapshot)).rejects.toThrow()
}))

async function storageFixture(action: (root: string) => Promise<void>) {
  const root = await mkdtemp(path.join(os.tmpdir(), "xneon-update-storage-"))
  try { await action(root) } finally { await rm(root, { recursive: true, force: true }) }
}

test("профиль и перенесённые данные не могут находиться внутри заменяемого app, включая symlink", () => storageFixture(async root => {
  const app = path.join(root, "Launcher.app"), outside = path.join(root, "profile"), inside = path.join(app, "data")
  await mkdir(inside, { recursive: true }); await mkdir(outside)
  for (const [profile, data] of [[inside, outside], [outside, inside], [app, outside], [outside, app]]) {
    await expect(assertUnixUpdateStorageOutsideInstallation([app], profile, data)).rejects.toThrow(/update-storage-inside-installation/)
  }
  const alias = path.join(root, "alias")
  await symlink(inside, alias, process.platform === "win32" ? "junction" : "dir")
  await expect(assertUnixUpdateStorageOutsideInstallation([app], outside, alias)).rejects.toThrow(/update-storage-inside-installation/)
}))

test("соседний prefix и app внутри общего data-root допустимы, отсутствующий target — нет", () => storageFixture(async root => {
  const app = path.join(root, "app"), profile = path.join(root, "app-profile")
  await mkdir(app); await mkdir(profile)
  await assertUnixUpdateStorageOutsideInstallation([app], profile, root)
  // При package update target может быть временно удалён менеджером пакетов.
  await assertUnixUpdateStorageOutsideInstallation([path.join(root, "removed-app")], profile, root)
  await expect(assertUnixUpdateStorageOutsideInstallation([app], profile, path.join(root, "missing"))).rejects.toThrow()
}))