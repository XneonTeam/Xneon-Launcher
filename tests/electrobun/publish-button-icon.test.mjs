import { test } from "node:test"
import assert from "node:assert/strict"
import fs from "node:fs"

test("Публикация сборки: кнопка содержит иконку загрузки рядом с подписью", () => {
  const source = fs.readFileSync(new URL("../../components/launcher/instance/shared/share-publish-dialog.tsx", import.meta.url), "utf8")
  const button = source.match(/<ShareButton[^>]*onClick=\{\(\) => void publish\(\)\}>[\s\S]*?<\/ShareButton>/)?.[0]
  assert.ok(button)
  assert.match(button, /<IconCloudUpload[^>]*aria-hidden="true"/)
  assert.match(button, /share\.publish/)
})
