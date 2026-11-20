import { expect, test } from "bun:test"

test("Unix updater helper собирается отдельно без импорта окон/desktop SDK", async () => {
  const result = await Bun.build({ entrypoints: ["./electrobun/main/unix-update-helper.ts"], target: "bun", format: "cjs", write: false })
  expect(result.success).toBe(true)
  const text = await result.outputs[0].text()
  expect(text).toContain("Unknown update signing key or invalid signature envelope")
  expect(text).toContain("runUnixUpdateHelper")
  expect(text).not.toContain("class DesktopWindow")
  expect(text).not.toContain("XNLC_UPDATE_PRIVATE_KEY")
  expect(text).not.toContain("update-package-helper-not-configured")
  expect(text).toContain("installUnixPackage")
})
