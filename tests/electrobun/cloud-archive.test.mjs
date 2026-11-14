import AdmZip from "adm-zip"
import { test } from "node:test"
import assert from "node:assert/strict"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { createArchive } from "../../dist-electrobun-tests/main/cloud/archive-builder.js"
import { META_ICON_ENTRY, META_NAME_ENTRY } from "../../dist-electrobun-tests/main/cloud/archive-meta.js"

async function makeIntent(root, files) {
  for (const [name, content] of Object.entries(files)) {
    const target = path.join(root, name)
    await fs.mkdir(path.dirname(target), { recursive: true })
    await fs.writeFile(target, content)
  }
}

test("архив сборки содержит выбранные категории, метаданные и читается сторонним ZIP", async (t) => {
  const base = await fs.mkdtemp(path.join(os.tmpdir(), "xnlc-cloud-archive-"))
  t.after(() => fs.rm(base, { recursive: true, force: true }))
  const intent = path.join(base, "intent")
  await makeIntent(intent, {
    "mods/a.jar": "jar-a",
    "mods/nested/b.jar": "jar-b",
    "mods/кириллица.jar": "мод",
    "config/x.txt": "cfg",
    "saves/world/level.dat": "level",
    "versions/1.20/client.json": "{}",
    "root.txt": "root",
  })

  const archivePath = path.join(base, "nested", "build.zip")
  const progress = []
  await createArchive(intent, archivePath, {
    categories: ["mods", "configs"],
    icon: "data:image/png;base64,AAA",
    name: "Моя сборка: v1",
    onProgress: (_stage, percent) => progress.push(percent),
  })

  const entries = new AdmZip(await fs.readFile(archivePath)).getEntries()
  const contents = new Map(entries.map((entry) => [entry.entryName, entry.getData().toString("utf8")]))
  assert.deepEqual([...contents.keys()].sort(), [
    META_ICON_ENTRY,
    META_NAME_ENTRY,
    "config/x.txt",
    "mods/a.jar",
    "mods/nested/b.jar",
    "mods/кириллица.jar",
  ])
  assert.equal(contents.get("mods/nested/b.jar"), "jar-b")
  assert.equal(contents.get("mods/кириллица.jar"), "мод")
  assert.equal(contents.get(META_ICON_ENTRY), "data:image/png;base64,AAA")
  assert.equal(contents.get(META_NAME_ENTRY), "Моя сборка: v1")
  assert.equal(progress.at(-1), 100)

  const fullArchive = path.join(base, "full.zip")
  await createArchive(intent, fullArchive)
  const full = new AdmZip(await fs.readFile(fullArchive)).getEntries().map((entry) => entry.entryName).sort()
  assert.deepEqual(full, [
    "config/x.txt",
    "mods/a.jar",
    "mods/nested/b.jar",
    "mods/кириллица.jar",
    "root.txt",
    "saves/world/level.dat",
  ])
})

test("пустая выборка категорий не создаёт архив и сообщает причину", async (t) => {
  const base = await fs.mkdtemp(path.join(os.tmpdir(), "xnlc-cloud-archive-empty-"))
  t.after(() => fs.rm(base, { recursive: true, force: true }))
  const intent = path.join(base, "intent")
  await makeIntent(intent, { "mods/a.jar": "jar-a" })

  await assert.rejects(
    createArchive(intent, path.join(base, "build.zip"), { categories: ["saves"] }),
    /Нечего загружать/,
  )
})
