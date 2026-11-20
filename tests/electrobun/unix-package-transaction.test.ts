import { expect, test } from "bun:test"
import { applyUnixPackageTransaction, recoverUnixPackageTransaction, type UnixPackageTransactionPorts } from "../../electrobun/main/unix-package-transaction"

function fixture(patch: Partial<UnixPackageTransactionPorts> = {}) {
  const events: string[] = []
  const step = (name: string) => async () => { events.push(name) }
  const ports: UnixPackageTransactionPorts = { verifyNextPackage: step("verify-file-B"), verifyPreviousPackage: step("verify-file-A"), ready: step("ready"),
    waitForParentExit: step("exit-A"), backupProfile: step("backup-db"), installNext: step("install-B"), verifyNextInstalled: step("verify-B"),
    startNext: async () => { events.push("start-B"); return { pid: 100 } }, waitHealthy: async () => { events.push("health-B"); return true }, stopNext: step("stop-B"),
    installPrevious: step("install-A"), verifyPreviousInstalled: step("verify-A"), restoreProfile: step("restore-db"), startPrevious: step("start-A"),
    record: async phase => { events.push("phase:" + phase) }, ...patch }
  return { events, ports }
}
test("пакет B устанавливается только после проверки обоих файлов и выхода A", async () => {
  const app = fixture()
  expect((await applyUnixPackageTransaction(app.ports)).status).toBe("committed")
  expect(app.events.indexOf("verify-file-A")).toBeLessThan(app.events.indexOf("ready"))
  expect(app.events.indexOf("exit-A")).toBeLessThan(app.events.indexOf("install-B"))
  expect(app.events.indexOf("health-B")).toBeLessThan(app.events.indexOf("phase:committed"))
  expect(app.events).not.toContain("install-A")
})
test("отсутствующая подписанная A не позволяет закрыть текущее приложение", async () => {
  const app = fixture({ verifyPreviousPackage: async () => { throw new Error("missing rollback") } })
  await expect(applyUnixPackageTransaction(app.ports)).rejects.toThrow(/missing rollback/)
  expect(app.events).not.toContain("exit-A")
})
test("неудачный запуск B сначала останавливается, затем A восстанавливается через manager и snapshot", async () => {
  const app = fixture({ waitHealthy: async () => false })
  await expect(applyUnixPackageTransaction(app.ports)).rejects.toThrow(/update-startup-failed/)
  for (const [a, b] of [["stop-B", "install-A"], ["install-A", "verify-A"], ["verify-A", "restore-db"], ["restore-db", "start-A"]]) {
    expect(app.events.indexOf(a)).toBeLessThan(app.events.indexOf(b))
  }
})
test("отмена polkit не вызывает повторный privileged install, если A не изменена", async () => {
  const app = fixture({ installNext: async () => { throw new Error("update-install-cancelled") } })
  await expect(applyUnixPackageTransaction(app.ports)).rejects.toThrow(/update-install-cancelled/)
  expect(app.events).not.toContain("install-A")
  expect(app.events).toContain("verify-A")
  expect(app.events).toContain("start-A")
})
test("сбой восстановления не превращается в успешное обновление или запуск непроверенной A", async () => {
  const app = fixture({ waitHealthy: async () => false, installPrevious: async () => { throw new Error("rollback denied") } })
  await expect(applyUnixPackageTransaction(app.ports)).rejects.toThrow(/recovery/)
  expect(app.events).not.toContain("start-A")
  expect(app.events).toContain("phase:recovery-required")
})

test("recovery после root install не создаёт новый snapshot поверх исходной A", async () => {
  const app = fixture()
  expect((await recoverUnixPackageTransaction("installed", app.ports)).status).toBe("rolled-back")
  expect(app.events).not.toContain("backup-db")
  expect(app.events.indexOf("stop-B")).toBeLessThan(app.events.indexOf("install-A"))
  expect(app.events.indexOf("restore-db")).toBeLessThan(app.events.indexOf("start-A"))
})
