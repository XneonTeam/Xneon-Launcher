import { expect, test } from "bun:test"
import { readFileSync } from "node:fs"

test("надпись открытия страницы проекта наследует hover-цвет кнопки как соседние ссылки", () => {
  const source = readFileSync(new URL("../../components/launcher/addon-detail-modal.tsx", import.meta.url), "utf8")
  const label = source.match(/<span\b[^>]*data-ui="addon-detail-modal-span-7"[^>]*>/)?.[0]
  expect(label).toBeDefined()
  expect(label).not.toContain("text-muted-foreground")
})
