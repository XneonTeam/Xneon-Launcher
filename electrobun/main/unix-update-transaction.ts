import assert from "node:assert/strict"
import { copyFile, constants } from "node:fs"
import { lstat, open, realpath, rename } from "node:fs/promises"
import { promisify } from "node:util"
import path from "node:path"
import { exchangeUnixUpdatePaths } from "./unix-update-atomic"

type Child = { pid: number }
export type UnixReplacementPorts = {
  ready?: () => Promise<void>
  waitForParentExit: () => Promise<void>
  verifyCurrent: () => Promise<void>
  verifyPrepared: () => Promise<void>
  launch: () => Promise<Child>
  waitHealthy: (child: Child) => Promise<boolean>
  stop: (child: Child) => Promise<void>
}
export type UnixReplacementPlan = { target: string; nonce: string; kind: "file" | "directory" }
export function unixTransactionPaths(plan: UnixReplacementPlan) {
  assert.ok(/^[a-f0-9]{32}$/.test(plan.nonce) && path.isAbsolute(plan.target) && !/[\u0000-\u001f]/.test(plan.target), "Invalid update transaction")
  const work = path.join(path.dirname(plan.target), `.xneon-update-${plan.nonce}`)
  return { work, prepared: path.join(work, "next"), backup: path.join(work, "previous"), journal: path.join(work, "state.json") }
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
const exists = (file: string) => lstat(file).then(() => true, error => { if (error.code !== "ENOENT") throw error; return false })

/** Применение вызывается только отдельным helper после проверки подписанного job. */
export async function applyUnixUpdateTransaction(plan: UnixReplacementPlan, ports: UnixReplacementPorts, signal?: AbortSignal,
  io: { rename: typeof rename; exchange?: (left: string, right: string) => Promise<void> } = { rename }) {
  signal?.throwIfAborted()
  const paths = unixTransactionPaths(plan)
  assert.ok(plan.kind === "file" || plan.kind === "directory", "Invalid update replacement kind")
  await sameKind(plan.target, plan.kind)
  await sameKind(paths.work, "directory")
  await sameKind(paths.prepared, plan.kind)
  for (const file of [paths.backup, paths.journal]) {
    assert.ok(!await exists(file), "Update transaction already exists; manual recovery is required")
  }
  await ports.verifyCurrent()
  await ports.verifyPrepared()
  await ports.ready?.()
  await ports.waitForParentExit()
  signal?.throwIfAborted()
  // После ожидания родителя повторно проверяем пути и identity, а не доверяем подготовке main.
  await sameKind(plan.target, plan.kind)
  await sameKind(paths.prepared, plan.kind)
  await ports.verifyCurrent()
  await ports.verifyPrepared()
  let replaced = false, child: Child | undefined
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
      // Атомарная мена: target не исчезает ни на одном шаге. A после неё лежит в prepared.
      await exchange(plan.target, paths.prepared)
      replaced = true
      await syncUnixUpdateDirectory(paths.work); await syncUnixUpdateDirectory(path.dirname(plan.target))
      await io.rename(paths.prepared, paths.backup)
      await record("exchanged")
    } else await io.rename(plan.target, paths.backup)
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
    // Автоматического отката нет: останавливаем новый процесс и фиксируем сбой.
    // `previous`/`profile-backup` остаются для ручного восстановления.
    if (child) await ports.stop(child).catch(stopError => console.error("[Unix updater] Could not stop updated process", stopError))
    // Если сбой случился сразу после exchange, A ещё лежит в prepared: переносим её в previous.
    if (replaced && !await exists(paths.backup).catch(() => true)) await io.rename(paths.prepared, paths.backup)
      .catch(preserveError => console.error("[Unix updater] Could not preserve previous payload", preserveError))
    await record("failed").catch(() => {})
    throw error
  }
}