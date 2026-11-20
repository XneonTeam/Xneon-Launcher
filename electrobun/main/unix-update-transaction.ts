import assert from "node:assert/strict"
import { copyFile, constants } from "node:fs"
import { lstat, open, realpath, rename } from "node:fs/promises"
import { promisify } from "node:util"
import path from "node:path"

type Child = { pid: number }
export type UnixReplacementPorts = {
  waitForParentExit: () => Promise<void>
  verifyCurrent: () => Promise<void>
  verifyPrepared: () => Promise<void>
  launch: () => Promise<Child>
  waitHealthy: (child: Child) => Promise<boolean>
  stop: (child: Child) => Promise<void>
  launchPrevious: () => Promise<void>
}
export type UnixReplacementPlan = { target: string; nonce: string; kind: "file" | "directory" }
export function unixTransactionPaths(plan: UnixReplacementPlan) {
  assert.ok(/^[a-f0-9]{32}$/.test(plan.nonce) && path.isAbsolute(plan.target) && !/[\u0000-\u001f]/.test(plan.target), "Invalid update transaction")
  const work = path.join(path.dirname(plan.target), `.xneon-update-${plan.nonce}`)
  return { work, prepared: path.join(work, "next"), backup: path.join(work, "previous"), failed: path.join(work, "failed"), journal: path.join(work, "state.json") }
}
async function syncDirectory(directory: string) {
  if (process.platform === "win32") return // Файловые fixture-тесты, не native Unix E2E.
  const handle = await open(directory, "r")
  try { await handle.sync() } finally { await handle.close() }
}
async function journal(file: string, value: Record<string, unknown>) {
  const temporary = file + ".next"
  const handle = await open(temporary, "wx", 0o600)
  try { await handle.writeFile(JSON.stringify(value)); await handle.sync() } finally { await handle.close() }
  await rename(temporary, file)
  await syncDirectory(path.dirname(file))
}
async function sameKind(file: string, kind: UnixReplacementPlan["kind"]) {
  const info = await lstat(file)
  assert.ok(kind === "file" ? info.isFile() : info.isDirectory(), "Invalid update replacement type")
  assert.equal(await realpath(file), file, "Update replacement path is not canonical")
}

/** Применение вызывается только отдельным helper после проверки подписанного job. */
export async function applyUnixUpdateTransaction(plan: UnixReplacementPlan, ports: UnixReplacementPorts, signal?: AbortSignal,
  io: { rename: typeof rename } = { rename }) {
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
  let backedUp = false, replaced = false, child: Child | undefined
  const record = (phase: string) => journal(paths.journal, { schemaVersion: 1, ...plan, phase })
  await record("prepared")
  try {
    if (plan.kind === "file") {
      // Старый AppImage остаётся на месте до единственного атомарного rename нового файла.
      await promisify(copyFile)(plan.target, paths.backup, constants.COPYFILE_EXCL)
      const backup = await open(paths.backup, "r+")
      try { await backup.sync() } finally { await backup.close() }
    } else await io.rename(plan.target, paths.backup)
    backedUp = true
    await syncDirectory(path.dirname(plan.target))
    await record("backed-up")
    await io.rename(paths.prepared, plan.target)
    replaced = true
    await syncDirectory(path.dirname(plan.target))
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
        if (plan.kind === "directory" && replaced) await io.rename(plan.target, paths.failed)
        await io.rename(paths.backup, plan.target)
        await syncDirectory(path.dirname(plan.target))
        await ports.verifyCurrent()
        await record("rolled-back")
        await ports.launchPrevious()
      }
    } catch (rollbackError) {
      await record("recovery-required").catch(() => {})
      throw new AggregateError([error, rollbackError], "Update failed and requires recovery; previous payload is retained")
    }
    throw error
  }
}
