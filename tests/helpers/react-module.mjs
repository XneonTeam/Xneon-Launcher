import fs from 'node:fs'
import vm from 'node:vm'
import { createRequire } from 'node:module'
import { transformSync } from 'esbuild'

/** Загружается весь настоящий модуль; подменяются только внешние зависимости. */
export function loadReactModule(url, mocks = {}, globals = {}) {
  const require = createRequire(url)
  const code = transformSync(fs.readFileSync(url, 'utf8'), { loader: 'tsx', format: 'cjs', jsx: 'automatic' }).code
  const module = { exports: {} }
  vm.runInNewContext(code, { module, exports: module.exports, console, Event, crypto: globalThis.crypto, ...globals,
    require: name => Object.hasOwn(mocks, name) ? mocks[name] : require(name) })
  return module.exports
}

export function reactNodes(node) {
  if (Array.isArray(node)) return node.flatMap(reactNodes)
  if (!node || typeof node !== 'object' || !node.props) return []
  return [node, ...reactNodes(node.props.children), ...reactNodes(node.props.footer)]
}
