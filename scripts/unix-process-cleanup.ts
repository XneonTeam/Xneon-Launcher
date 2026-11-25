import assert from "node:assert/strict"

type Controls = {
  alive: () => boolean
  signal: (signal: "SIGTERM" | "SIGKILL") => void
  pause: () => Promise<void>
}

/**
 * Групповой kill теряет доступ к группе, если её лидер вышел, а PID переиспользован
 * чужим процессом: тогда ядро отвечает EPERM вместо ESRCH. Оба ответа означают, что
 * нашей группы запуска больше нет, поэтому они не должны валить очистку.
 */
export function isProcessGroupGone(error: unknown) {
  const code = (error as NodeJS.ErrnoException | null | undefined)?.code
  return code === "ESRCH" || code === "EPERM"
}

/** Отрицательный PID адресует всю отдельную группу запуска, включая потомков. */
export async function stopUnixProcessGroup(pid: number, controls?: Controls) {
  assert.ok(Number.isSafeInteger(pid) && pid > 1, "Invalid process group")
  const io = controls ?? {
    alive: () => {
      try { process.kill(-pid, 0); return true }
      catch (error) { if (isProcessGroupGone(error)) return false; throw error }
    },
    signal: (signal: "SIGTERM" | "SIGKILL") => {
      try { process.kill(-pid, signal) }
      catch (error) { if (!isProcessGroupGone(error)) throw error }
    },
    pause: () => Bun.sleep(100),
  }
  if (!io.alive()) return { stopped: true, forced: false }
  io.signal("SIGTERM")
  for (let attempt = 0; attempt < 100; attempt++) {
    if (!io.alive()) return { stopped: true, forced: false }
    await io.pause()
  }
  io.signal("SIGKILL")
  for (let attempt = 0; attempt < 50; attempt++) {
    if (!io.alive()) return { stopped: true, forced: true }
    await io.pause()
  }
  throw new Error("Native launch process group remains alive after SIGKILL")
}
