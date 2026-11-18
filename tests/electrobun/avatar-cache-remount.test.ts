import { expect, test } from "bun:test"
import fs from "node:fs"
import vm from "node:vm"
import { createRequire } from "node:module"
import { transformSync } from "esbuild"

const require = createRequire(import.meta.url)

function fixture() {
  const source = fs.readFileSync(new URL("../../components/ui/cached-avatar.tsx", import.meta.url), "utf8") + "\nexport { loadImage, useCachedImageUrl };"
  const effects: Function[] = []
  let state: any, initialized = false, calls = 0
  const storage = new Map<string, string>()
  const module = { exports: {} as any }
  vm.runInNewContext(transformSync(source, { loader: "tsx", format: "cjs", jsx: "automatic" }).code, {
    module, exports: module.exports, Blob, Date,
    URL: { createObjectURL: () => "blob:avatar", revokeObjectURL() {} },
    localStorage: { getItem: (key: string) => storage.get(key) ?? null, setItem: (key: string, value: string) => storage.set(key, value) },
    FileReader: class { result = "data:image/png;base64,cached"; onload: Function = () => {}; readAsDataURL() { this.onload() } },
    fetch: async () => { calls++; return new Response(new Uint8Array([1, 2, 3])) },
    require(name: string) {
      if (name === "@/lib/launcher-assets") return { launcherAssetUrl: (url: string) => url }
      if (name === "@/lib/decoded-image-cache") return { retainDecodedImage() {} }
      if (name === "react") return {
        useState: (initial: any) => {
          if (!initialized) { state = typeof initial === "function" ? initial() : initial; initialized = true }
          return [state, (value: any) => { state = value }]
        },
        useEffect: (effect: Function) => effects.push(effect),
      }
      return require(name)
    },
  })
  return {
    load: module.exports.loadImage,
    mount(url: string) { initialized = false; effects.length = 0; return module.exports.useCachedImageUrl(url) },
    runEffects() { effects.splice(0).forEach(effect => effect()) },
    get state() { return state }, get calls() { return calls }, storage,
  }
}

test("повторный mount аватарки сразу использует тот же blob-URL, не переключает data → blob", async () => {
  const cache = fixture()
  const url = "avatar://head/Player?v=1"
  expect(await cache.load(url)).toBe("blob:avatar")
  await Promise.resolve()
  expect(cache.storage.size).toBe(1)
  for (let cycle = 0; cycle < 20; cycle++) {
    const initial = cache.mount(url)
    expect(initial).toBe("blob:avatar")
    cache.runEffects()
    expect(cache.state).toBe(initial)
  }
  expect(cache.calls).toBe(1)
})

test("холодный mount сохраняет использование дискового кэша без сети", async () => {
  const cache = fixture()
  const url = "avatar://head/Player?v=1"
  cache.storage.set("xnlc:avatar-cache:v2", JSON.stringify({ [url]: { d: "data:image/png;base64,disk", t: Date.now() } }))
  expect(cache.mount(url)).toBe("data:image/png;base64,disk")
  cache.runEffects()
  expect(await cache.load(url)).toBe("data:image/png;base64,disk")
  expect(cache.calls).toBe(0)
})
