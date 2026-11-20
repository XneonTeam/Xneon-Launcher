import { expect, test } from "bun:test"
import { stopUnixProcessGroup } from "../../scripts/unix-process-cleanup"

test("ожидает выхода всей группы, а не только launcher", async () => {
  const signals: string[] = []
  let checks = 0
  const result = await stopUnixProcessGroup(42, {
    alive: () => ++checks < 3,
    signal: signal => { signals.push(signal) },
    pause: async () => {},
  })
  expect(signals).toEqual(["SIGTERM"])
  expect(result).toEqual({ stopped: true, forced: false })
})

test("останавливает зависших потомков и не выдаёт SIGKILL за штатный выход", async () => {
  const signals: string[] = []
  let forced = false
  const result = await stopUnixProcessGroup(42, {
    alive: () => !forced,
    signal: signal => { signals.push(signal); if (signal === "SIGKILL") forced = true },
    pause: async () => {},
  })
  expect(signals).toEqual(["SIGTERM", "SIGKILL"])
  expect(result).toEqual({ stopped: true, forced: true })
})

test("отказ завершения группы и опасный PID не скрываются", async () => {
  await expect(stopUnixProcessGroup(42, { alive: () => true, signal: () => {}, pause: async () => {} })).rejects.toThrow("remains alive")
  await expect(stopUnixProcessGroup(0)).rejects.toThrow("Invalid process group")
})
