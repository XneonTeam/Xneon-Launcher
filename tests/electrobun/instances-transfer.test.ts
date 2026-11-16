// Проверки подсистемы: describe изолируют fixtures и хуки; runtime не подменяется общим состоянием.
import { describe } from "bun:test"
import nodeTest, { test } from "node:test"
import assert from "node:assert/strict"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import copyModule from "../../dist-electrobun-tests/main/builds/copy-instance.js"
import vm from "node:vm"
import { createRequire } from "node:module"
import { stripTypeScriptTypes } from "./transpile.mjs"
import { createHash } from "node:crypto"
import TestZip from "../helpers/zip.ts"

{
  const { copyInstanceDirectory } = copyModule

  async function fixture(t) {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'xnlc-copy-instance-'))
    t.after(() => fs.rm(root, { recursive: true, force: true }))
    const source = path.join(root, 'custom-location', 'original')
    await fs.mkdir(source, { recursive: true })
    return { root, source, target: path.join(root, 'intents', 'copy') }
  }
  describe("copy-instance", () => {
    test('duplicate: copies mods, disabled files, resource packs, shaders, configs and worlds independently', async t => {
      const { source, target } = await fixture(t)
      const files = ['mods/a.jar', 'mods/nested/b.jar.disabled', 'resourcepacks/pack.zip', 'resourcepacks/folder/pack.mcmeta', 'shaderpacks/shader.zip', 'config/options.toml', 'saves/world/level.dat']
      for (const file of [...files, '.xnlc-share/transaction-123/journal.json']) {
        await fs.mkdir(path.dirname(path.join(source, file)), { recursive: true })
        await fs.writeFile(path.join(source, file), file)
      }
      await copyInstanceDirectory(source, target)
      for (const file of files) assert.equal(await fs.readFile(path.join(target, file), 'utf8'), file)
      await assert.rejects(fs.stat(path.join(target, '.xnlc-share')), { code: 'ENOENT' })
      await fs.writeFile(path.join(target, files[0]), 'changed copy')
      assert.equal(await fs.readFile(path.join(source, files[0]), 'utf8'), files[0])
    })

    test('duplicate: existing destination and source are never overwritten or removed', async t => {
      const { source, target } = await fixture(t)
      await fs.mkdir(target, { recursive: true })
      await fs.writeFile(path.join(target, 'keep.txt'), 'existing')
      await assert.rejects(copyInstanceDirectory(source, target), { code: 'EEXIST' })
      assert.equal(await fs.readFile(path.join(target, 'keep.txt'), 'utf8'), 'existing')
      await assert.rejects(copyInstanceDirectory(source, source), /itself/)
      await assert.rejects(copyInstanceDirectory(source, path.join(source, 'nested-copy')), /itself/)
      assert.ok((await fs.stat(source)).isDirectory())
    })

    test('duplicate: old junctions become independent directories; failed copy leaves no partial instance', async t => {
      const { root, source, target } = await fixture(t)
      const shared = path.join(root, 'old-shared-files')
      await fs.mkdir(shared); await fs.writeFile(path.join(shared, 'a.jar'), 'original')
      await fs.symlink(shared, path.join(source, 'mods'), 'junction')
      await copyInstanceDirectory(source, target)
      assert.equal((await fs.lstat(path.join(target, 'mods'))).isSymbolicLink(), false)
      await fs.writeFile(path.join(target, 'mods/a.jar'), 'changed')
      assert.equal(await fs.readFile(path.join(shared, 'a.jar'), 'utf8'), 'original')
      const broken = path.join(root, 'broken-source')
      await fs.mkdir(broken)
      await fs.symlink(path.join(root, 'missing-directory'), path.join(broken, 'broken'), 'junction')
      const failed = path.join(root, 'failed-copy')
      await assert.rejects(copyInstanceDirectory(broken, failed))
      await assert.rejects(fs.stat(failed), { code: 'ENOENT' })
    })
  })
}

{
  const test = nodeTest
  const source = await fs.readFile(new URL('../../lib/agent-transfer-files.ts', import.meta.url), 'utf8')
  const transfer = vm.runInNewContext(stripTypeScriptTypes(source.replaceAll('export function', 'function')) + '; ({filesFromTransfer, attachmentImageType})')
  const require = createRequire(new URL('../../dist-electrobun-tests/main/clipboard-files.js', import.meta.url))
  async function clipboardApi(items) {
    const code = await fs.readFile(new URL('../../dist-electrobun-tests/main/clipboard-files.js', import.meta.url), 'utf8')
    const module = { exports: {} }
    vm.runInNewContext(code, { module, exports: module.exports, Buffer, require: name => name === '../platform/desktop' ? { clipboard: { read: async () => items } } : require(name) })
    return module.exports
  }
  describe("agent-file-transfer", () => {
    test('paste/drop: читает FileList, а при пустом списке извлекает файлы из items', () => {
      const file = { name: 'latest.log', type: '' }
      assert.equal(transfer.filesFromTransfer({ files: [file], items: [{ kind: 'file', getAsFile: () => file }] }).length, 1)
      const files = transfer.filesFromTransfer({ files: [], items: [{ kind: 'string', getAsFile: () => null }, { kind: 'file', getAsFile: () => file }] })
      assert.equal(files.length, 1)
      assert.equal(files[0], file)
      assert.equal(transfer.filesFromTransfer({ files: [], items: [{ kind: 'string' }] }).length, 0)
    })

    test('изображения с пустым MIME распознаются по расширению, лог остаётся текстовым', () => {
      assert.equal(transfer.attachmentImageType({ name: 'screen.PNG', type: '' }), 'image/png')
      assert.equal(transfer.attachmentImageType({ name: 'photo.jpg', type: '' }), 'image/jpeg')
      assert.equal(transfer.attachmentImageType({ name: 'image', type: 'image/webp' }), 'image/webp')
      assert.equal(transfer.attachmentImageType({ name: 'latest.log', type: '' }), null)
    })

    test('буфер Windows: DROPFILES поддерживает несколько Unicode-путей и удаляет дубли', async () => {
      const api = await clipboardApi([])
      const paths = ['C:\\тест\\latest.log', 'C:\\тест\\screen.png']
      const payload = Buffer.from(paths.join('\0') + '\0\0', 'utf16le')
      const header = Buffer.alloc(20); header.writeUInt32LE(20, 0); header.writeUInt32LE(1, 16)
      const formats = { CF_HDROP: Buffer.concat([header, payload]), FileNameW: Buffer.from(paths[0] + '\0', 'utf16le') }
      assert.deepEqual(Array.from(api.clipboardFilePaths(Object.keys(formats), key => formats[key])), paths)
      assert.equal(api.clipboardFilePaths(['text/plain'], () => Buffer.from(paths[0])).length, 0)
    })

    test('Electron clipboard: скопированный файл передаётся как вложение с исходным именем и содержимым', async t => {
      const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'xnlc-paste-'))
      t.after(() => fs.rm(directory, { recursive: true, force: true }))
      const file = path.join(directory, 'ошибка.log')
      await fs.writeFile(file, 'test log')
      const type = 'electron application/osclipboard;format="FileNameW"'
      const api = await clipboardApi([{ types: [type], getType: async () => new Blob([Buffer.from(file + '\0', 'utf16le')]) }])
      const files = await api.readClipboardFiles()
      assert.equal(files.length, 1)
      assert.equal(files[0].name, 'ошибка.log')
      assert.equal(Buffer.from(files[0].dataUrl.split(',')[1], 'base64').toString(), 'test log')
    })

    test('Electron clipboard: обычный текст не превращается в файл; изображение передаётся как PNG', async () => {
      const text = await clipboardApi([{ types: ['text/plain'], getType: async () => new Blob(['C:\\secret.txt']) }])
      assert.equal((await text.readClipboardFiles()).length, 0)
      const image = await clipboardApi([{ types: ['image/png'], getType: async () => new Blob(['image bytes']) }])
      const files = await image.readClipboardFiles()
      assert.equal(files[0].name, 'clipboard.png')
      assert.ok(files[0].dataUrl.startsWith('data:image/png;base64,'))
    })
  })
}

{
  const require = createRequire(import.meta.url)
  const { dependencyProjectId } = require('../../dist-electrobun-tests/main/builds/dependency-project.js')
  describe("dependency-project", () => {
    test('Модули Fabric API сопоставляются с общим проектом, остальные моды сохраняют собственный id', () => {
      assert.equal(dependencyProjectId('fabric-resource-loader-v0'), 'fabric-api')
      assert.equal(dependencyProjectId('fabric-resource-loader-v1'), 'fabric-api')
      assert.equal(dependencyProjectId('fabric-api-base'), 'fabric-api')
      assert.equal(dependencyProjectId('fabric-language-kotlin'), 'fabric-language-kotlin')
      assert.equal(dependencyProjectId('sodium'), 'sodium')
    })
  })
}

{
  const test = nodeTest
  const require = createRequire(import.meta.url)

  const { readModrinthPackContents } = require("../../dist-electrobun-tests/main/mods-pack-contents.js")
  describe("modpack-contents", () => {
    test("чтение состава сборки без установки", async t => {
      const zip = new TestZip()
      const sha1 = "a".repeat(40)
      zip.addFile("modrinth.index.json", Buffer.from(JSON.stringify({ game: "minecraft", dependencies: { minecraft: "1.21.1", "fabric-loader": "0.16.0" }, files: [
        { path: "mods/example.jar", hashes: { sha1 }, env: { client: "required", server: "unsupported" } },
        { path: "resourcepacks/example.zip", hashes: {} },
      ] })))
      const archive = zip.toBuffer()
      let file = { filename: "test.mrpack", url: "https://cdn.modrinth.com/data/test.mrpack", size: archive.length, hashes: { sha512: createHash("sha512").update(archive).digest("hex") } }
      const mods = {
        modrinthGetDetails: async () => ({ id: "pack", name: "Test pack" }),
        modrinthGetVersions: async () => [{ id: "version", files: [file] }],
        modrinthGetFilesByHash: async hashes => { assert.deepEqual(hashes, [sha1]); return { [sha1]: { projectId: "mod", versionId: "mod-version" } } },
      }
      const originalFetch = globalThis.fetch
      let downloads = 0
      globalThis.fetch = async () => { downloads++; return new Response(archive) }
      try {
        await t.test("полный список сохраняет ID, окружение и неразрешённые файлы", async () => {
          const result = await readModrinthPackContents(mods, "pack", "version")
          assert.equal(result.totalFiles, 2)
          assert.equal(result.dependencies.minecraft, "1.21.1")
          assert.equal(result.files[0].projectId, "mod")
          assert.equal(result.files[0].versionId, "mod-version")
          assert.equal(result.files[0].environment.server, "unsupported")
          assert.equal(result.files[1].path, "resourcepacks/example.zip")
          assert.equal(result.files[1].projectId, undefined)
        })
        await t.test("не подменяет отсутствующую версию другой", async () => {
          const before = downloads
          await assert.rejects(readModrinthPackContents(mods, "pack", "missing"), /archive not found/)
          assert.equal(downloads, before)
        })
        await t.test("не загружает архив с постороннего хоста", async () => {
          const before = downloads
          file = { ...file, url: "https://example.com/test.mrpack" }
          await assert.rejects(readModrinthPackContents(mods, "pack", "version"), /archive host/)
          assert.equal(downloads, before)
          file = { ...file, url: "https://cdn.modrinth.com/data/test.mrpack" }
        })
        await t.test("проверяет целостность до чтения индекса", async () => {
          file = { ...file, hashes: { sha512: "0".repeat(128) } }
          await assert.rejects(readModrinthPackContents(mods, "pack", "version"), /hash mismatch/)
        })
        await t.test("отклоняет слишком большой архив до загрузки", async () => {
          const before = downloads
          file = { ...file, size: 33 * 1024 * 1024 }
          await assert.rejects(readModrinthPackContents(mods, "pack", "version"), /too large/)
          assert.equal(downloads, before)
        })
      } finally { globalThis.fetch = originalFetch }
    })
  })
}
