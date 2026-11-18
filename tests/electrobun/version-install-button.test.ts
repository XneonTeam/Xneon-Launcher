import { expect, test } from "bun:test"
import fs from "node:fs"
import vm from "node:vm"
import { createRequire } from "node:module"
import { transformSync } from "esbuild"
import { renderToStaticMarkup } from "react-dom/server"

const source = fs.readFileSync(new URL("../../components/launcher/addon-detail-modal.tsx", import.meta.url), "utf8")
function button(running: boolean, downloadId: string | null = "download", busy = running, isCurrent = false) {
  const start = source.indexOf('{onInstallVersion && <button data-ui="addon-detail-modal-button-4"')
  const end = source.indexOf("</button>}", start) + "</button>".length
  const calls: string[] = []
  const code = transformSync(`(${source.slice(start + 1, end)})`, { loader: "tsx", format: "cjs", jsx: "automatic" }).code
  const icon = () => null
  const element = vm.runInNewContext(code, {
    require: createRequire(import.meta.url), cn: (...values: string[]) => values.join(" "), t: (key: string) => key,
    ver: { id: "version" }, installState: running ? { phase: "running" } : null,
    busy, isCurrent, cancellableDownload: downloadId,
    onInstallVersion: () => calls.push("install"), runVersionInstall: (_version: unknown, action: Function) => action(),
    IconLoader2: icon, IconCheck: icon, IconDownload: icon, IconX: icon,
    window: { electrobunAPI: { cancelContentDownload: async (id: string) => calls.push(`cancel:${id}`) } }, console,
  })
  return { element, calls }
}

test("при скачивании та же кнопка становится активной Отменой и отменяет текущий download", () => {
  const { element, calls } = button(true)
  expect(renderToStaticMarkup(element)).toContain("common.cancel")
  expect(element.props.disabled).toBe(false)
  element.props.onClick()
  expect(calls).toEqual(["cancel:download"])
})

test("до установки кнопка скачивает, остальные версии заблокированы во время операции", () => {
  const idle = button(false)
  idle.element.props.onClick()
  expect(idle.calls).toEqual(["install"])
  expect(button(false, "download", true).element.props.disabled).toBe(true)
  expect(button(false, null, false, true).element.props.disabled).toBe(true)
  expect(button(true, null).element.props.disabled).toBe(true)
})

test("под прогрессом нет второй кнопки отмены", () => {
  expect(source).not.toMatch(/installState\?\.phase === "running" && cancellableDownload && <button/)
})
