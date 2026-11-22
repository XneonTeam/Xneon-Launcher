import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'

// Граница renderer-сборки для @xnlc/share: Node и архивный пакет не должны попасть в браузерный export.
test('браузерный export Share не включает обработчик архивов', async () => {
  const pkg = JSON.parse(await fs.readFile('packages/xnlc-share/package.json', 'utf8'))
  assert.equal(pkg.exports['.'].browser, './lib/browser.js')
  const browser = await fs.readFile('packages/xnlc-share/src/browser.ts', 'utf8')
  assert.doesNotMatch(browser, /object-policy|@xnlc\/archives|node:/)
})

test('Vite разрешает Share для renderer без Node и архивного пакета', async () => {
  const { build } = await import('vite')
  await fs.mkdir('.tmp', { recursive: true })
  const directory = await fs.mkdtemp(path.resolve('.tmp/share-browser-'))
  try {
    const entry = path.join(directory, 'entry.ts')
    await fs.writeFile(entry, 'export { branchHistory, diff, MAX_FILE_BYTES, SERVER_PERMISSION_KEYS, serverPermissions } from "@xnlc/share"')
    await build({
      configFile: false, logLevel: 'silent',
      build: { write: false, lib: { entry, formats: ['es'] } },
      plugins: [{ name: 'verify-renderer-boundary', buildEnd() {
        const ids = [...this.getModuleIds()]
        assert.ok(ids.some(id => id.replaceAll('\\', '/').endsWith('/xnlc-share/lib/browser.js')))
        assert.ok(!ids.some(id => /xnlc-archives|__vite-browser-external|^node:/.test(id)), ids.join('\n'))
      } }],
    })
  } finally { await fs.rm(directory, { recursive: true, force: true }) }
})