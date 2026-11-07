import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import vm from 'node:vm'
import { createRequire, stripTypeScriptTypes } from 'node:module'

const source = await fs.readFile(new URL('../../lib/agent-transfer-files.ts', import.meta.url), 'utf8')
const transfer = vm.runInNewContext(stripTypeScriptTypes(source.replaceAll('export function', 'function')) + '; ({filesFromTransfer, attachmentImageType})')
const require = createRequire(new URL('../../dist-electron/main/clipboard-files.js', import.meta.url))
async function clipboardApi(items) {
  const code = await fs.readFile(new URL('../../dist-electron/main/clipboard-files.js', import.meta.url), 'utf8')
  const module = { exports: {} }
  vm.runInNewContext(code, { module, exports: module.exports, Buffer, require: name => name === 'electron' ? { clipboard: { read: async () => items } } : require(name) })
  return module.exports
}

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
