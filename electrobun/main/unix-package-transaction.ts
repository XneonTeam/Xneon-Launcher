export type UnixPackagePhase = "verified" | "parent-exited" | "installing" | "installed" | "launched" | "committed" | "rolling-back" | "rolled-back" | "recovery-required"
type Child = { pid: number }
export type UnixPackageTransactionPorts = {
  verifyNextPackage: () => Promise<void>; verifyPreviousPackage: () => Promise<void>; ready: () => Promise<void>
  waitForParentExit: () => Promise<void>; backupProfile: () => Promise<void>
  installNext: () => Promise<void>; verifyNextInstalled: () => Promise<void>; startNext: () => Promise<Child>
  waitHealthy: (child: Child) => Promise<boolean>; stopNext: (child?: Child) => Promise<void>
  installPrevious: () => Promise<void>; verifyPreviousInstalled: () => Promise<void>
  restoreProfile: () => Promise<void>; startPrevious: () => Promise<void>; record: (phase: UnixPackagePhase) => Promise<void>
}
function authorizationFailure(error: unknown) {
  return error instanceof Error && ["update-install-cancelled", "update-privileges-required"].includes(error.message)
}

/** Пакеты никогда не меняют /opt через rename: установка и rollback всегда принадлежат manager. */
export async function applyUnixPackageTransaction(ports: UnixPackageTransactionPorts) {
  await ports.verifyNextPackage()
  await ports.verifyPreviousPackage()
  await ports.record("verified")
  await ports.ready()
  await ports.waitForParentExit()
  let attempted = false, child: Child | undefined, snapshot = false
  try {
    await ports.record("parent-exited")
    await ports.backupProfile(); snapshot = true
    await ports.record("installing")
    attempted = true
    await ports.installNext()
    await ports.verifyNextInstalled()
    await ports.record("installed")
    child = await ports.startNext()
    await ports.record("launched")
    if (!await ports.waitHealthy(child)) throw new Error("update-startup-failed")
    await ports.record("committed")
    return { status: "committed" as const }
  } catch (error) {
    try {
      if (child) await ports.stopNext(child)
      await ports.record("rolling-back")
      if (attempted && !authorizationFailure(error)) {
        await ports.verifyPreviousPackage()
        await ports.installPrevious()
      }
      await ports.verifyPreviousInstalled()
      if (child && snapshot) await ports.restoreProfile()
      await ports.record("rolled-back")
      await ports.startPrevious()
    } catch (rollback) {
      await ports.record("recovery-required").catch(() => {})
      throw new AggregateError([error, rollback], "Package update failed and requires recovery")
    }
    throw error
  }
}

export async function recoverUnixPackageTransaction(phase: UnixPackagePhase, ports: UnixPackageTransactionPorts) {
  if (phase === "committed") { await ports.verifyNextInstalled(); return { status: "committed" as const } }
  await ports.verifyNextPackage()
  await ports.verifyPreviousPackage()
  await ports.ready()
  await ports.waitForParentExit()
  await ports.stopNext()
  try {
    if (phase !== "verified" && phase !== "parent-exited" && phase !== "rolled-back") {
      // Сам manager сериализует root-транзакции системными locks; не убиваем чужой apt/dnf/pacman.
      await ports.record("rolling-back")
      await ports.installPrevious()
    }
    await ports.verifyPreviousInstalled()
    if (["installed", "launched", "rolling-back", "recovery-required"].includes(phase)) await ports.restoreProfile()
    await ports.record("rolled-back")
    await ports.startPrevious()
    return { status: "rolled-back" as const }
  } catch (error) {
    await ports.record("recovery-required").catch(() => {})
    throw error
  }
}
