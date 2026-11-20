import { expect, test } from "bun:test"
import { mkdtemp, mkdir, writeFile, readFile, rm, rename, symlink, realpath } from "node:fs/promises"
import path from "node:path"
import os from "node:os"
import { applyUnixUpdateTransaction, recoverUnixUpdateTransaction, unixTransactionPaths, type UnixReplacementPorts } from "../../electrobun/main/unix-update-transaction"

const nonce = "a".repeat(32)
async function fixture(kind: "file" | "directory", action: (plan: any, read: () => Promise<string>, ports: UnixReplacementPorts) => Promise<void>) {
  const root = await realpath(await mkdtemp(path.join(os.tmpdir(), "xneon-swap-test-")))
  try {
    const target = path.join(root, kind === "file" ? "Xneon.AppImage" : "Xneon.app"), work = path.join(root, `.xneon-update-${nonce}`)
    await mkdir(work)
    const prepared = path.join(work, "next")
    if (kind === "directory") { await mkdir(target); await mkdir(prepared) }
    const file = (root: string) => kind === "file" ? root : path.join(root, "identity")
    await writeFile(file(target), "A"); await writeFile(file(prepared), "B")
    const read = () => readFile(file(target), "utf8")
    const ports: UnixReplacementPorts = { waitForParentExit: async () => { expect(await read()).toBe("A") },
      verifyCurrent: async () => { expect(await read()).toBe("A") }, verifyPrepared: async () => { expect(await readFile(file(prepared), "utf8")).toBe("B") },
      launch: async () => { expect(await read()).toBe("B"); return { pid: 123 } }, waitHealthy: async () => true, stop: async () => {}, launchPrevious: async () => { expect(await read()).toBe("A") } }
    await action({ target, nonce, kind }, read, ports)
  } finally { await rm(root, { recursive: true, force: true }) }
}
for (const kind of ["file", "directory"] as const) {
  test(`замена ${kind} ждёт выхода A и сохраняет backup до подтверждения B`, () => fixture(kind, async (plan, read, ports) => {
    const result = await applyUnixUpdateTransaction(plan, ports)
    expect(await read()).toBe("B")
    expect(result.status).toBe("committed")
    expect(await readFile(kind === "file" ? result.backup : path.join(result.backup, "identity"), "utf8")).toBe("A")
  }))
  test(`неудачный запуск B возвращает A для ${kind}, остановив новый процесс до rollback`, () => fixture(kind, async (plan, read, ports) => {
    let stopped = false
    await expect(applyUnixUpdateTransaction(plan, { ...ports, waitHealthy: async () => false,
      stop: async () => { expect(await read()).toBe("B"); stopped = true } })).rejects.toThrow(/update-startup-failed/)
    expect(stopped).toBe(true)
    expect(await read()).toBe("A")
  }))
}
test("отмена до handoff не меняет установленное приложение", () => fixture("file", async (plan, read, ports) => {
  const controller = new AbortController(); controller.abort()
  await expect(applyUnixUpdateTransaction(plan, ports, controller.signal)).rejects.toThrow()
  expect(await read()).toBe("A")
}))
test("сбой rename после переноса старого app восстанавливает его", () => fixture("directory", async (plan, read, ports) => {
  let failed = false
  await expect(applyUnixUpdateTransaction(plan, ports, undefined, { rename: async (from, to) => {
    if (!failed && from.endsWith(path.sep + "next")) { failed = true; throw Object.assign(new Error("Disk full"), { code: "ENOSPC" }) }
    await rename(from, to)
  } })).rejects.toThrow(/Disk full/)
  expect(await read()).toBe("A")
}))
test("symlink вместо установленного файла не заменяется", () => fixture("file", async (plan, _read, ports) => {
  const real = plan.target + ".real"
  await rename(plan.target, real); await symlink(real, plan.target)
  await expect(applyUnixUpdateTransaction(plan, ports)).rejects.toThrow()
  expect(await readFile(real, "utf8")).toBe("A")
}))

for (const replaced of [false, true]) test(`recovery восстанавливает A после crash между rename/journal (replaced=${replaced})`, () => fixture("directory", async (plan, read, ports) => {
  const files = unixTransactionPaths(plan)
  await rename(plan.target, files.backup)
  if (replaced) await rename(files.prepared, plan.target)
  await writeFile(files.journal, JSON.stringify({ schemaVersion: 1, ...plan, phase: "prepared" }))
  let stopped = false
  const result = await recoverUnixUpdateTransaction(plan, { waitForParentExit: async () => {}, stopForRecovery: async () => { stopped = true },
    verifyPrevious: async file => { expect(await readFile(path.join(file, "identity"), "utf8")).toBe("A") },
    verifyInstalled: async () => { throw new Error("Unconfirmed B must not be accepted") }, launchPrevious: ports.launchPrevious })
  expect(result.status).toBe("rolled-back")
  expect(stopped).toBe(true)
  expect(await read()).toBe("A")
}))
test("recovery не откатывает уже подтверждённую и целостную B", () => fixture("directory", async (plan, read) => {
  const files = unixTransactionPaths(plan)
  await rename(plan.target, files.backup); await rename(files.prepared, plan.target)
  await writeFile(files.journal, JSON.stringify({ schemaVersion: 1, ...plan, phase: "committed" }))
  const unexpected = async () => { throw new Error("Committed B must not be stopped") }
  const result = await recoverUnixUpdateTransaction(plan, { waitForParentExit: unexpected, stopForRecovery: unexpected,
    verifyPrevious: unexpected, verifyInstalled: async () => { expect(await read()).toBe("B") }, launchPrevious: unexpected })
  expect(result.status).toBe("committed")
}))
test("recovery не доверяет подменённому journal target", () => fixture("directory", async (plan, read, ports) => {
  const files = unixTransactionPaths(plan)
  await writeFile(files.journal, JSON.stringify({ schemaVersion: 1, ...plan, target: "/other/app", phase: "prepared" }))
  const unexpected = async () => { throw new Error("Must not mutate") }
  await expect(recoverUnixUpdateTransaction(plan, { waitForParentExit: unexpected, stopForRecovery: unexpected,
    verifyPrevious: unexpected, verifyInstalled: unexpected, launchPrevious: ports.launchPrevious })).rejects.toThrow(/journal/)
  expect(await read()).toBe("A")
}))

test("recovery после ready до первого journal возвращает проверенную A без snapshot", () => fixture("directory", async (plan, read, ports) => {
  const events: string[] = []
  const result = await recoverUnixUpdateTransaction(plan, {
    ready: async () => { events.push("ready") },
    waitForParentExit: async () => { expect(events).toContain("ready"); events.push("exit") },
    stopForRecovery: async () => { events.push("stop") },
    verifyPrevious: async file => { expect(await readFile(path.join(file, "identity"), "utf8")).toBe("A") },
    verifyInstalled: async () => { throw new Error("No committed B") },
    restoreProfile: async () => { throw new Error("No snapshot required before transaction") },
    launchPrevious: ports.launchPrevious,
  })
  expect(result.status).toBe("rolled-back")
  expect(await read()).toBe("A")
  expect(events).toEqual(["ready", "exit", "stop"])
}))

test("missing journal при изменённом target не разрешает ready/выход родителя", () => fixture("directory", async (plan, _read, ports) => {
  const files = unixTransactionPaths(plan)
  await rename(plan.target, files.backup); await rename(files.prepared, plan.target)
  let ready = false, exited = false
  await expect(recoverUnixUpdateTransaction(plan, {
    ready: async () => { ready = true }, waitForParentExit: async () => { exited = true }, stopForRecovery: async () => {},
    verifyPrevious: async file => { expect(await readFile(path.join(file, "identity"), "utf8")).toBe("A") },
    verifyInstalled: async () => {}, launchPrevious: ports.launchPrevious,
  })).rejects.toThrow()
  expect(ready).toBe(false); expect(exited).toBe(false)
}))

test("directory strategy использует exchange, не оставляя target отсутствующим между rename", () => fixture("directory", async (plan, read, ports) => {
  let exchanges = 0, removedTarget = false
  const exchange = async (left: string, right: string) => {
    // Это mock протокола exchange на Windows, а не доказательство атомарности файловой системы.
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
