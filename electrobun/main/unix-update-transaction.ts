import assert from "node:assert/strict"
import { copyFile, constants } from "node:fs"
import { lstat, open, readFile, realpath, rename, rm } from "node:fs/promises"
import { promisify } from "node:util"
import path from "node:path"
import { exchangeUnixUpdatePaths } from "./unix-update-atomic"

type Child = { pid: number }
export type UnixReplacementPorts = {
  waitForParentExit: () => Promise<void>
  verifyCurrent: () => Promise<void>
  verifyPrepared: () => Promise<void>
  launch: () => Promise<Child>
  waitHealthy: (child: Child) => Promise<boolean>
  stop: (child: Child) => Promise<void>
  launchPrevious: () => Promise<void>
  restoreProfile?: () => Promise<void>
}
export type UnixReplacementPlan = { target: string; nonce: string; kind: "file" | "directory" }
export function unixTransactionPaths(plan: UnixReplacementPlan) {
  assert.ok(/^[a-f0-9]{32}$/.test(plan.nonce) && path.isAbsolute(plan.target) && !/[\u0000-\u001f]/.test(plan.target), "Invalid update transaction")
  const work = path.join(path.dirname(plan.target), `.xneon-update-${plan.nonce}`)
  return { work, prepared: path.join(work, "next"), backup: path.join(work, "previous"), failed: path.join(work, "failed"), journal: path.join(work, "state.json") }
}
export async function syncUnixUpdateDirectory(directory: string) {
  if (process.platform === "win32") return // Файловые fixture-тесты, не native Unix E2E.
  const handle = await open(directory, "r")
  try { await handle.sync() } finally { await handle.close() }
}
async function journal(file: string, value: Record<string, unknown>) {
  const temporary = file + ".next"
  const handle = await open(temporary, "wx", 0o600)
  try { await handle.writeFile(JSON.stringify(value)); await handle.sync() } finally { await handle.close() }
  await rename(temporary, file)
  await syncUnixUpdateDirectory(path.dirname(file))
}
async function sameKind(file: string, kind: UnixReplacementPlan["kind"]) {
  const info = await lstat(file)
  assert.ok(kind === "file" ? info.isFile() : info.isDirectory(), "Invalid update replacement type")
  assert.equal(await realpath(file), file, "Update replacement path is not canonical")
}

/** Применение вызывается только отдельным helper после проверки подписанного job. */
export async function applyUnixUpdateTransaction(plan: UnixReplacementPlan, ports: UnixReplacementPorts, signal?: AbortSignal,
  io: { rename: typeof rename; exchange?: (left: string, right: string) => Promise<void> } = { rename }) {
  signal?.throwIfAborted()
  const paths = unixTransactionPaths(plan)
  assert.ok(plan.kind === "file" || plan.kind === "directory", "Invalid update replacement kind")
  await sameKind(plan.target, plan.kind)
  await sameKind(paths.work, "directory")
  await sameKind(paths.prepared, plan.kind)
  for (const file of [paths.backup, paths.failed, paths.journal]) {
    const exists = await lstat(file).then(() => true, error => { if (error.code !== "ENOENT") throw error; return false })
    assert.ok(!exists, "Update transaction already exists; recovery is required")
  }
  await ports.verifyCurrent()
  await ports.verifyPrepared()
  await ports.waitForParentExit()
  signal?.throwIfAborted()
  // После ожидания родителя повторно проверяем пути и identity, а не доверяем подготовке main.
  await sameKind(plan.target, plan.kind)
  await sameKind(paths.prepared, plan.kind)
  await ports.verifyCurrent()
  await ports.verifyPrepared()
  let backedUp = false, replaced = false, child: Child | undefined, previous = paths.backup
  // Windows используется только для файловых fixtures. Native Unix не делает двухшаговый swap каталогов.
  const exchange = io.exchange ?? (process.platform === "win32" ? undefined : async (left: string, right: string) => exchangeUnixUpdatePaths(left, right))
  const record = (phase: string) => journal(paths.journal, { schemaVersion: 1, ...plan, phase, ...(child ? { childPid: child.pid } : {}) })
  await record("prepared")
  try {
    if (plan.kind === "file") {
      // Старый AppImage остаётся на месте до единственного атомарного rename нового файла.
      await promisify(copyFile)(plan.target, paths.backup, constants.COPYFILE_EXCL)
      const backup = await open(paths.backup, process.platform === "win32" ? "r+" : "r")
      try { await backup.sync() } finally { await backup.close() }
    } else if (exchange) {
      await exchange(plan.target, paths.prepared)
      backedUp = true; replaced = true; previous = paths.prepared
      await syncUnixUpdateDirectory(paths.work); await syncUnixUpdateDirectory(path.dirname(plan.target))
      await record("exchanged")
      await io.rename(paths.prepared, paths.backup); previous = paths.backup
    } else await io.rename(plan.target, paths.backup)
    backedUp = true
    await syncUnixUpdateDirectory(paths.work); await syncUnixUpdateDirectory(path.dirname(plan.target))
    await record("backed-up")
    if (!replaced) await io.rename(paths.prepared, plan.target)
    replaced = true
    await syncUnixUpdateDirectory(path.dirname(plan.target))
    await record("installed")
    child = await ports.launch()
    assert.ok(Number.isSafeInteger(child.pid) && child.pid > 1, "Invalid updated process")
    await record("launched")
    if (!await ports.waitHealthy(child)) throw new Error("update-startup-failed")
    await record("committed")
    // Backup намеренно остаётся: его удаление не должно затронуть неизвестные файлы старого app.
    return { status: "committed" as const, backup: paths.backup, journal: paths.journal }
  } catch (error) {
    try {
      if (child) await ports.stop(child) // Нельзя откатывать .app, пока его новый процесс работает.
      if (backedUp) {
        if (plan.kind === "directory" && replaced && exchange) {
          await exchange(plan.target, previous)
          await io.rename(previous, paths.failed)
        } else {
          if (plan.kind === "directory" && replaced) await io.rename(plan.target, paths.failed)
          await io.rename(previous, plan.target)
        }
        await syncUnixUpdateDirectory(paths.work); await syncUnixUpdateDirectory(path.dirname(plan.target))
        await ports.verifyCurrent()
        await record("rolled-back")
        await ports.restoreProfile?.()
        await ports.launchPrevious()
      }
    } catch (rollbackError) {
      await record("recovery-required").catch(() => {})
      throw new AggregateError([error, rollbackError], "Update failed and requires recovery; previous payload is retained")
    }
    throw error
  }
}

export type UnixRecoveryPorts = {
  waitForParentExit: () => Promise<void>
  stopForRecovery: () => Promise<void>
  verifyPrevious: (file: string) => Promise<void>
  verifyInstalled: (file: string) => Promise<void>
  launchPrevious: () => Promise<void>
  restoreProfile?: () => Promise<void>
}

/** Topology важнее последнего phase: crash возможен между rename и fsync journal. */
export async function recoverUnixUpdateTransaction(plan: UnixReplacementPlan, ports: UnixRecoveryPorts) {
  const files = unixTransactionPaths(plan)
  await sameKind(files.work, "directory")
  const info = await lstat(files.journal)
  assert.ok(info.isFile() && info.size > 0 && info.size <= 16 * 1024, "Invalid update recovery journal")
  const saved = JSON.parse(await readFile(files.journal, "utf8"))
  assert.ok(saved?.schemaVersion === 1 && saved.target === plan.target && saved.nonce === plan.nonce && saved.kind === plan.kind, "Update recovery journal identity mismatch")
  assert.ok(["prepared", "exchanged", "backed-up", "installed", "launched", "committed", "rolled-back", "recovery-required"].includes(saved.phase), "Invalid update recovery journal phase")
  if (saved.phase === "committed") {
    await sameKind(plan.target, plan.kind)
    await ports.verifyInstalled(plan.target)
    return { status: "committed" as const, backup: files.backup, journal: files.journal }
  }
  await ports.waitForParentExit()
  const exists = (file: string) => lstat(file).then(() => true, error => { if (error.code !== "ENOENT") throw error; return false })
  const verifiesOld = async (file: string) => {
    if (!await exists(file)) return false
    await sameKind(file, plan.kind)
    try { await ports.verifyPrevious(file); return true } catch { return false }
  }
  if (await verifiesOld(plan.target)) {
    await ports.stopForRecovery()
  } else {
    const previous = await verifiesOld(files.backup) ? files.backup : await verifiesOld(files.prepared) ? files.prepared : null
    assert.ok(previous, "Previous update payload is missing or corrupt; manual recovery required")
    await ports.stopForRecovery()
    if (await exists(plan.target)) {
      await sameKind(plan.target, plan.kind)
      if (plan.kind === "directory" && process.platform !== "win32") {
        exchangeUnixUpdatePaths(plan.target, previous)
        await rename(previous, files.failed + `-${Date.now()}`)
      } else if (plan.kind === "directory") {
        assert.ok(!await exists(files.failed), "Failed payload already exists; manual recovery required")
        await rename(plan.target, files.failed)
        await rename(previous, plan.target)
      } else await rename(previous, plan.target)
    } else await rename(previous, plan.target)
    await syncUnixUpdateDirectory(files.work); await syncUnixUpdateDirectory(path.dirname(plan.target))
  }
  await ports.verifyPrevious(plan.target)
  await ports.restoreProfile?.()
  // Незавершённый временный journal принадлежит только этому уже проверенному work-каталогу.
  await rm(files.journal + ".next", { force: true })
  await journal(files.journal, { schemaVersion: 1, ...plan, phase: "rolled-back" })
  await ports.launchPrevious()
  return { status: "rolled-back" as const, journal: files.journal }
}
