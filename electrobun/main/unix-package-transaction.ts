export type UnixPackagePhase = "verified" | "parent-exited" | "installing" | "installed" | "launched" | "committed" | "failed"
type Child = { pid: number }
export type UnixPackageTransactionPorts = {
  verifyNextPackage: () => Promise<void>
  ready: () => Promise<void>
  waitForParentExit: () => Promise<void>
  backupProfile: () => Promise<void>
  installNext: () => Promise<void>
  verifyNextInstalled: () => Promise<void>
  startNext: () => Promise<Child>
  waitHealthy: (child: Child) => Promise<boolean>
  stopNext: (child?: Child) => Promise<void>
  record: (phase: UnixPackagePhase) => Promise<void>
}

/** Пакеты меняет только системный manager; при сбое helper ничего не переустанавливает. */
export async function applyUnixPackageTransaction(ports: UnixPackageTransactionPorts) {
  await ports.verifyNextPackage()
  await ports.record("verified")
  await ports.ready()
  await ports.waitForParentExit()
  let child: Child | undefined
  try {
    await ports.record("parent-exited")
    await ports.backupProfile()
    await ports.record("installing")
    await ports.installNext()
    await ports.verifyNextInstalled()
    await ports.record("installed")
    child = await ports.startNext()
    await ports.record("launched")
    if (!await ports.waitHealthy(child)) throw new Error("update-startup-failed")
    await ports.record("committed")
    return { status: "committed" as const }
  } catch (error) {
    // Откат отсутствует: останавливаем новый процесс и фиксируем сбой, не трогая систему.
    if (child) await ports.stopNext(child).catch(stopError => console.error("[Unix updater] Could not stop updated process", stopError))
    await ports.record("failed").catch(() => {})
    throw error
  }
}