import { expect, test } from "bun:test"
import { ShareSystem } from "../../packages/xnlc-share/src/system"
import { MemoryFiles, hash, manifest, external } from "../../packages/xnlc-share/tests/helpers.mjs"
import { mergePublishProgress, publishProgressPercent } from "../../lib/share-publish-progress"
import { loadReactModule, reactNodes } from "../helpers/react-module.mjs"

test("полоса сохраняет дробный процент и список файлов между событиями и коммитом", () => {
  const first = { stage: "upload", done: 42700, total: 10000000, bytes: 42700, files: [{ path: "mods/a.jar", size: 10000000, status: "downloading" as const }] }
  expect(publishProgressPercent(first)).toBeCloseTo(0.427)
  const next = mergePublishProgress(first, { ...first, done: 10000000, files: [{ ...first.files[0], status: "complete" }] })
  const commit = mergePublishProgress(next, { stage: "commit", done: 0, total: 1, bytes: 10000000 })
  expect(publishProgressPercent(commit)).toBe(100)
  expect(commit.files?.[0].status).toBe("complete")
})

test("под полосой отображаются идентичность проекта с иконкой/автором и статус передачи", () => {
  const Identity = () => null
  const { SharePublishTransfer } = loadReactModule(new URL("../../components/launcher/instance/shared/share-publish-transfer.tsx", import.meta.url), {
    "react-i18next": { useTranslation: () => ({ t: (key: string) => key }) },
    "@/lib/share-publish-progress": { publishProgressPercent },
    "./share-ui": { bytesLabel: (bytes: number) => `${bytes} B` },
    "./share-content-identity": { ShareContentIdentity: Identity },
  })
  const presentation = { "mods/a.jar": { name: "Example", author: "Author", iconUrl: "https://example.org/icon.png" } }
  const tree = SharePublishTransfer({ progress: { stage: "upload", done: 50, total: 100, bytes: 50, files: [{ path: "mods/a.jar", size: 100, status: "downloading" }] }, presentation })
  const nodes = reactNodes(tree)
  expect(nodes.find((node: any) => node.props.role === "progressbar").props["aria-valuenow"]).toBe(50)
  expect(nodes.find((node: any) => node.type === Identity).props.presentation).toBe(presentation["mods/a.jar"])
  expect(nodes.find((node: any) => node.props["data-share-transfer-files"] !== undefined)).toBeDefined()
  expect(nodes.find((node: any) => node.props["aria-busy"] === true)).toBeDefined()
})

test("публикация сообщает текущий файл, промежуточные байты и завершает полосу на 100%", async () => {
  const files = new MemoryFiles({ "config/a.json": "{\"a\":1}", "config/b.json": "{\"b\":2}" })
  const entries = await Promise.all([...files.data].map(([path, bytes]) => external(path, bytes)))
  const events: any[] = []
  const system = new ShareSystem({ files, hash, sources: [], now: () => "2026-11-18T00:00:00Z", progress: event => events.push(event),
    remote: { create: async () => "repo", hasObject: async () => false, upload: async (_id: string, _hash: string, bytes: Uint8Array, progress?: (bytes: number) => void) => { progress?.(3); progress?.(bytes.length) }, mutate: async () => ({}) } as any,
  })
  await system.publish(manifest(entries), "alice")
  const upload = events.filter(event => event.stage === "upload")
  expect(upload[0].files?.[0]).toMatchObject({ path: "config/a.json", status: "downloading" })
  expect(upload.some(event => event.done > 0 && event.done < event.total)).toBe(true)
  expect(upload.at(-1).done).toBe(upload.at(-1).total)
  expect(upload.at(-1).files[0]).toMatchObject({ path: "config/b.json", status: "complete" })
})

test("переиспользованные объекты тоже продвигают прогресс, не вызывая upload", async () => {
  const files = new MemoryFiles({ "config/a.json": "{}" })
  const entry = await external("config/a.json", "{}")
  const events: any[] = []
  const system = new ShareSystem({ files, hash, sources: [], now: () => "2026-11-18T00:00:00Z", progress: event => events.push(event),
    remote: { create: async () => "repo", hasObject: async () => true, upload: async () => { throw new Error("Unexpected upload") }, mutate: async () => ({}) } as any,
  })
  await system.publish(manifest([entry]), "alice")
  const last = events.filter(event => event.stage === "upload").at(-1)
  expect(last).toBeDefined()
  expect(last.done).toBe(last.total)
  expect(last.bytes).toBe(0)
})
