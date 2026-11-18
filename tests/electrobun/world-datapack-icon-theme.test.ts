import { expect, test } from "bun:test"
import { readFileSync } from "node:fs"

test("иконки датапаков в мирах используют акцент текущей темы", () => {
  const source = readFileSync(new URL("../../components/launcher/instance/instance-worlds-tab.tsx", import.meta.url), "utf8")
  const icons = source.match(/<IconArchive\b[^>]*>/g) ?? []
  expect(icons.length).toBe(3)
  for (const icon of icons) expect(icon).toContain("text-primary")
})
