import { expect, test } from "bun:test"
import fs from "node:fs"
import vm from "node:vm"
import { transformSync } from "esbuild"
import { createRequire } from "node:module"

test("иконки сборок закрепляют успешно загруженное изображение вне размонтируемой карточки", () => {
  const module = { exports: {} as any }
  const source = fs.readFileSync(new URL("../../components/launcher/instance/entity-icon.tsx", import.meta.url), "utf8")
  const require = createRequire(import.meta.url)
  const retained: unknown[] = []
  vm.runInNewContext(transformSync(source, { loader: "tsx", format: "cjs", jsx: "automatic" }).code, {
    module, exports: module.exports,
    require(name: string) {
      if (name === "@/lib/utils") return { cn: () => "", inheritSvgColor: (svg: string) => svg }
      if (name === "./builtin-logos") return { findBuiltinLogo: () => null }
      if (name === "@/lib/decoded-image-cache") return { retainDecodedImage: (image: unknown) => retained.push(image) }
      return require(name)
    },
  })
  const icon = module.exports.EntityIcon({ src: "data:image/png;base64,icon" })
  expect(icon.props.onLoad).toBeDefined()
  const image = { naturalWidth: 128, naturalHeight: 128 }
  icon.props.onLoad({ currentTarget: image })
  expect(retained).toEqual([image])
})

function fixture(failDecode = false) {
  let created = 0, decodes = 0
  const module = { exports: {} as any }
  const source = fs.readFileSync(new URL("../../lib/decoded-image-cache.ts", import.meta.url), "utf8")
  vm.runInNewContext(transformSync(source, { loader: "ts", format: "cjs" }).code, {
    module, exports: module.exports,
    Image: class {
      constructor() { created++ }
      src = ""; decoding = "auto"
      async decode() { decodes++; if (failDecode) throw new Error("invalid image") }
    },
  })
  return { ...module.exports, get created() { return created }, get decodes() { return decodes } }
}

test("повторные mount одной картинки сохраняют один независимый декодированный ресурс", () => {
  const cache = fixture()
  for (let cycle = 0; cycle < 20; cycle++) {
    cache.retainDecodedImage({ currentSrc: "blob:avatar", naturalWidth: 64, naturalHeight: 64 })
  }
  expect(cache.created).toBe(1)
  expect(cache.decodes).toBe(1)
  expect(cache.getDecodedImageCacheStats().entries).toBe(1)
})

test("кэш ограничен числом картинок и пиксельной памятью", () => {
  const cache = fixture()
  for (let index = 0; index < 100; index++) {
    cache.retainDecodedImage({ currentSrc: `blob:${index}`, naturalWidth: 256, naturalHeight: 256 })
  }
  const stats = cache.getDecodedImageCacheStats()
  expect(stats.entries).toBeLessThanOrEqual(64)
  expect(stats.estimatedBytes).toBeLessThanOrEqual(8 * 1024 * 1024)
})

test("огромные и битые картинки не закрепляются; React DOM-узел не удерживается", () => {
  const cache = fixture()
  cache.retainDecodedImage({ currentSrc: "blob:large", naturalWidth: 10000, naturalHeight: 10000 })
  cache.retainDecodedImage({ currentSrc: "blob:broken", naturalWidth: 0, naturalHeight: 0 })
  expect(cache.created).toBe(0)
  let reads = 0
  cache.retainDecodedImage({ currentSrc: "data:image/png;base64,small", naturalWidth: 32, naturalHeight: 32,
    get __reactFiber() { reads++; throw new Error("Do not retain React internals") },
  })
  expect(cache.created).toBe(1)
  expect(reads).toBe(0)
})

test("ошибка декодирования отпускает запись и её бюджет", async () => {
  const cache = fixture(true)
  cache.retainDecodedImage({ currentSrc: "blob:invalid", naturalWidth: 64, naturalHeight: 64 })
  await Promise.resolve()
  expect(cache.getDecodedImageCacheStats()).toEqual({ entries: 0, estimatedBytes: 0 })
})
