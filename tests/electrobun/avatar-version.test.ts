import { expect, test } from "bun:test"
import fs from "node:fs"
import vm from "node:vm"
import { transformSync } from "esbuild"

test("ключ аватарок не сбрасывает дисковый кэш при новом запуске провайдера", () => {
  const source = fs.readFileSync(new URL("../../src/AccountsContext.tsx", import.meta.url), "utf8")
  expect(source).not.toContain("useState(() => Date.now())")
  expect(source).toContain("useState(readAvatarCacheVersion)")
})

test("версия переживает перезапуск, явное обновление меняет её; битое/закрытое хранилище безопасно", () => {
  const source = fs.readFileSync(new URL("../../lib/avatar-cache-version.ts", import.meta.url), "utf8")
  const code = transformSync(source, { loader: "ts", format: "cjs" }).code
  let stored: string | null = null
  const storage = { getItem: () => stored, setItem: (_key: string, value: string) => { stored = value } }
  const load = () => {
    const module = { exports: {} as any }
    vm.runInNewContext(code, { module, exports: module.exports, localStorage: storage, Date: { now: () => 1000 } })
    return module.exports
  }
  expect(load().readAvatarCacheVersion()).toBe(0)
  expect(load().advanceAvatarCacheVersion(0)).toBe(1000)
  expect(load().readAvatarCacheVersion()).toBe(1000)
  expect(load().advanceAvatarCacheVersion(1000)).toBe(1001)
  expect(load().readAvatarCacheVersion()).toBe(1001)
  for (const invalid of ["NaN", "-3", "Infinity", "1.5"]) {
    stored = invalid
    expect(load().readAvatarCacheVersion()).toBe(0)
  }
  storage.getItem = () => { throw new Error("storage blocked") }
  storage.setItem = () => { throw new Error("storage blocked") }
  expect(load().readAvatarCacheVersion()).toBe(0)
  expect(load().advanceAvatarCacheVersion(0)).toBe(1000)
})
