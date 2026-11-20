import { expect, test } from "bun:test"
import { waitForUnixUpdateHealth } from "../../electrobun/main/unix-update-health"

test("отмена до ожидания не читает acknowledgement и не считается startup failure", async () => {
  const controller = new AbortController(); controller.abort(new Error("update-cancelled"))
  let reads = 0
  await expect(waitForUnixUpdateHealth({ readHealthy: async () => { reads++; return true }, isAlive: async () => true }, controller.signal)).rejects.toThrow(/update-cancelled/)
  expect(reads).toBe(0)
})
test("отмена одновременно с готовностью B имеет приоритет над commit", async () => {
  const controller = new AbortController()
  await expect(waitForUnixUpdateHealth({ readHealthy: async () => { controller.abort(new Error("update-cancelled")); return true }, isAlive: async () => true }, controller.signal)).rejects.toThrow(/update-cancelled/)
})
test("ожидание ограничено deadline и завершением группы; готовая B подтверждается", async () => {
  let clock = 0, reads = 0
  const ports = { readHealthy: async () => { reads++; return false }, isAlive: async () => true, now: () => clock, sleep: async (ms: number) => { clock += ms } }
  expect(await waitForUnixUpdateHealth(ports, undefined, 500)).toBe(false)
  expect(clock).toBe(500); expect(reads).toBe(2)
  expect(await waitForUnixUpdateHealth({ ...ports, isAlive: async () => false })).toBe(false)
  expect(await waitForUnixUpdateHealth({ ...ports, readHealthy: async () => true })).toBe(true)
})
test("отмена во время интервала не запускает следующее чтение", async () => {
  const controller = new AbortController(); let reads = 0
  await expect(waitForUnixUpdateHealth({ readHealthy: async () => { reads++; return false }, isAlive: async () => true,
    sleep: async () => { controller.abort(new Error("update-cancelled")) } }, controller.signal)).rejects.toThrow(/update-cancelled/)
  expect(reads).toBe(1)
})
