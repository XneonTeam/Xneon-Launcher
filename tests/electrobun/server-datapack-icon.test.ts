import { expect, test } from "bun:test"
import { readFileSync } from "node:fs"

test("вкладка серверных датапаков использует ту же иконку архива, что и миры", () => {
  const source = readFileSync(new URL("../../components/launcher/server-detail-page.tsx", import.meta.url), "utf8")
  expect(source).toMatch(/id: "datapacks", labelKey: "servers\.datapacks\.title", icon: IconArchive/)
})
