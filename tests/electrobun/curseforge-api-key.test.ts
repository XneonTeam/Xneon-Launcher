import { describe, expect, test } from "bun:test"
import { curseforgeApiKey } from "@xnlc/mods"

describe("CurseForge API key", () => {
  test("оба имени переменной переопределяют встроенный ключ, CF_API_KEY в приоритете", () => {
    expect(curseforgeApiKey({ CF_API_KEY: " cf-env " })).toBe("cf-env")
    expect(curseforgeApiKey({ CURSEFORGE_API_KEY: "share-env" })).toBe("share-env")
    expect(curseforgeApiKey({ CF_API_KEY: "cf", CURSEFORGE_API_KEY: "share" })).toBe("cf")
  })

  test("без окружения остаётся встроенный ключ, поэтому каталог и Share не расходятся", () => {
    expect(curseforgeApiKey({}).startsWith("$2a$10$")).toBe(true)
  })
})
