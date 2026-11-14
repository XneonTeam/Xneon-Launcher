import { expect, test } from "bun:test"
import TestZip from "../../../tests/helpers/zip"
import { analyze, analyzeBatch, analyzeOpen, ArchiveContext } from "../src"

function archive(files: Record<string, string>): Uint8Array {
  const zip = new TestZip()
  for (const [path, contents] of Object.entries(files)) zip.addFile(path, Buffer.from(contents))
  return new Uint8Array(zip.toBuffer())
}

test("версия из именованной секции manifest не подставляется", async () => {
  const result = await analyze(archive({
    "META-INF/mods.toml": '[[mods]]\nmodId="demo"\nversion="${file.jarVersion}"',
    "META-INF/MANIFEST.MF": "Manifest-Version: 1.0\r\n\r\nName: other\r\nImplementation-Version: 9.9\r\n",
  }))
  expect(result.mods[0]?.version).toBe("${file.jarVersion}")
  expect(result.completeness.metadata).toBe(false)
})

test("Bungee использует собственные обязательные и необязательные зависимости", async () => {
  const result = await analyze(archive({ "bungee.yml": "name: Demo\nversion: '1'\nmain: demo.Main\nauthor: Dev\ndepends: [Base]\nsoftDepends: [Extra]" }))
  expect(result.mods[0]).toMatchObject({ main: "demo.Main", authors: ["Dev"] })
  expect(result.dependencies).toMatchObject([{ id: "Base", optional: false }, { id: "Extra", optional: true }])
})

test("неверные декларации зависимостей не считаются полным результатом", async () => {
  for (const depends of [null, "bad", [], { lib: [] }, { lib: "" }]) {
    const result = await analyze(archive({ "fabric.mod.json": JSON.stringify({ id: "demo", version: "1", depends }) }))
    expect(result.mods[0]?.raw).toMatchObject({ depends })
    expect(result.completeness.dependencies).toBe(false)
    expect(result.diagnostics.some(d => d.code === "INVALID_DEPENDENCY")).toBe(true)
  }
})

test("тип пака определяется по содержимому, а не по pack_format", async () => {
  for (const [paths, expected] of [[[], "unknownpack"], [["data/demo/a"], "datapack"], [["assets/demo/a"], "resourcepack"], [["assets/demo/a", "data/demo/a"], "hybridpack"]] as const) {
    const result = await analyze(archive({ "pack.mcmeta": '{"pack":{"pack_format":15}}', ...Object.fromEntries(paths.map(path => [path, "x"])) }))
    expect(result.formats).toEqual([expected])
  }
})

test("глубокое дерево metadata отклоняется до нормализации", async () => {
  const json = '{"id":"demo","version":"1","extra":' + "[".repeat(70) + "0" + "]".repeat(70) + "}"
  const result = await analyze(archive({ "fabric.mod.json": json }))
  expect(result.diagnostics).toMatchObject([{ code: "LIMIT_EXCEEDED" }])
  expect(result.completeness.metadata).toBe(false)
})

test("analyzeOpen учитывает отдельный сигнал до и во время чтения", async () => {
  const context = await ArchiveContext.open(archive({ "fabric.mod.json": '{"id":"demo","version":"1"}' }))
  try {
    await expect(analyzeOpen(context, { signal: AbortSignal.abort() })).rejects.toMatchObject({ code: "ABORTED" })
    const controller = new AbortController()
    const pending = analyzeOpen(context, { signal: controller.signal })
    controller.abort()
    await expect(pending).rejects.toMatchObject({ code: "ABORTED" })
    expect((await analyzeOpen(context)).mods[0]?.id).toBe("demo")
  } finally { context.close() }
})

test("читает Fabric и Quilt metadata с неэкранированными LF, как XMCL", async () => {
  const result = await analyze(archive({
    "fabric.mod.json": '{"id":"demo","version":"1","description":"first\nsecond"}',
    "quilt.mod.json": '{"quilt_loader":{"id":"quilt","version":"2","metadata":{"description":"first\nsecond"}}}',
  }))
  expect(result.mods.map(mod => mod.id)).toEqual(["demo", "quilt"])
  expect(result.mods.map(mod => mod.description)).toEqual(["firstsecond", "firstsecond"])
  expect(result.diagnostics).toEqual([])
})

test("сохраняет оба loader и выражение Quilt unless", async () => {
  const result = await analyze(archive({
    "fabric.mod.json": JSON.stringify({ id: "fabric_example", version: "1", depends: { minecraft: ">=1.20" } }),
    "quilt.mod.json": JSON.stringify({ quilt_loader: { id: "quilt_example", version: "2", depends: [{ id: "sodium", versions: [">=1", "2"], unless: { id: "indium" } }], metadata: { contributors: { Alice: "Owner" } } } }),
  }))
  expect(result.formats).toEqual(["fabric", "quilt"])
  expect(result.mods.map(m => m.id)).toEqual(["fabric_example", "quilt_example"])
  expect(result.mods[0].minecraftVersions).toEqual([">=1.20"])
  expect(result.dependencies[1]).toMatchObject({ id: "sodium", versions: [">=1", "2"], interpretation: "unknown", raw: { unless: { id: "indium" } } })
  expect(result.completeness).toMatchObject({ metadata: true, dependencies: false, classes: false })
  expect(result.mods[1].authors).toEqual(["Alice"])
})

test("читает несколько модов Forge и их зависимости", async () => {
  const result = await analyze(archive({ "META-INF/mods.toml": 'modLoader="javafml"\nlicense="MIT"\n[[mods]]\nmodId="one"\nversion="1"\n[[mods]]\nmodId="two"\nversion="2"\n[[dependencies.one]]\nmodId="minecraft"\nmandatory=true\nversionRange="[1.20,)"\nside="BOTH"\n' }))
  expect(result.mods.map(m => m.id)).toEqual(["one", "two"])
  expect(result.mods[0].minecraftVersions).toEqual(["[1.20,)"])
  expect(result.mods[0].dependencies).toMatchObject([{ id: "minecraft", versions: "[1.20,)", optional: false, side: "BOTH" }])
  expect(result.mods[1].dependencies).toEqual([])
})

test("Forge подставляет версию из продолженной строки manifest", async () => {
  const result = await analyze(archive({ "META-INF/mods.toml": '[[mods]]\nmodId="demo"\nversion="${file.jarVersion}"\n', "META-INF/MANIFEST.MF": "Manifest-Version: 1.0\r\nImplementation-Version: 1.2.\r\n 3\r\n\r\n" }))
  expect(result.mods[0]).toMatchObject({ id: "demo", version: "1.2.3" })
  expect(result.mods[0].raw).toMatchObject({ mod: { version: "${file.jarVersion}" } })
})

test("неподставленная версия Forge и отсутствующий ID помечаются неполными", async () => {
  const forge = await analyze(archive({ "META-INF/mods.toml": '[[mods]]\nmodId="demo"\nversion="${file.jarVersion}"\n' }))
  expect(forge.completeness.metadata).toBe(false)
  const fabric = await analyze(archive({ "fabric.mod.json": '{"name":"Missing ID","version":"1"}' }))
  expect(fabric.completeness.metadata).toBe(false)
})

test("NeoForge сохраняет тип, сторону и порядок зависимостей", async () => {
  const result = await analyze(archive({ "META-INF/neoforge.mods.toml": 'loaderVersion="[4,)"\n[[mods]]\nmodId="demo"\n[[dependencies.demo]]\nmodId="other"\ntype="optional"\nordering="AFTER"\nside="CLIENT"\n[[dependencies.demo]]\nmodId="broken"\ntype="incompatible"\n[[dependencies.demo]]\nmodId="warned"\ntype="discouraged"\n[[dependencies.demo]]\nmodId="future"\ntype="future_kind"\n' }))
  expect(result.mods[0]).toMatchObject({ loader: "neoforge", loaderVersion: "[4,)" })
  expect(result.dependencies).toMatchObject([{ id: "other", optional: true, ordering: "AFTER", side: "CLIENT" }, { id: "broken", kind: "breaks", optional: true }, { id: "warned", kind: "discouraged", optional: true }, { id: "future", interpretation: "unknown", optional: undefined }])
})

test("поддерживает legacy cccmod.info и сохраняет исходные метаданные", async () => {
  const result = await analyze(archive({ "cccmod.info": '[{"modid":"old","name":"Old","version":"1","authorList":["Alice"]}]' }))
  expect(result.formats).toContain("forge")
  expect(result.mods[0]).toMatchObject({ id: "old", name: "Old", version: "1", authors: ["Alice"], raw: { modid: "old" } })
})

test("разбирает metadata и зависимости Velocity", async () => {
  const result = await analyze(archive({ "velocity-plugin.json": JSON.stringify({ id: "example", name: "Example", version: "1", authors: ["Alice"], dependencies: [{ id: "core", optional: false }, { id: "extra", optional: true }] }) }))
  expect(result.formats).toEqual(["velocity"])
  expect(result.mods[0]).toMatchObject({ id: "example", name: "Example", environment: "server", authors: ["Alice"] })
  expect(result.dependencies).toMatchObject([{ id: "core", optional: false }, { id: "extra", optional: true }])
})

test("разбирает зависимости Bukkit и Paper, сохраняя оригинал", async () => {
  const result = await analyze(archive({ "plugin.yml": 'name: Example\nversion: "1"\ndepend: [Core]\nsoftdepend: [Extra]\nloadbefore: [Other]\n', "paper-plugin.yml": 'name: PaperExample\nversion: "2"\ndependencies:\n  server:\n    Core:\n      load: BEFORE\n      required: true\n' }))
  expect(result.formats).toEqual(["bukkit", "paper"])
  expect(result.mods[0]).toMatchObject({ name: "Example", version: "1", environment: "server", raw: { depend: ["Core"] } })
  expect(result.dependencies).toMatchObject([{ id: "Core", optional: false }, { id: "Extra", optional: true }, { id: "Other", kind: "loadBefore" }, { id: "Core", ordering: "BEFORE", side: "server" }])
})

test("не обрабатывает YAML aliases и возвращает диагностику", async () => {
  const result = await analyze(archive({ "plugin.yml": "name: &a Demo\ndescription: *a\n" }))
  expect(result.mods).toEqual([])
  expect(result.diagnostics).toMatchObject([{ code: "INVALID_METADATA", source: "plugin.yml" }])
})

test("возвращает диагностику одного повреждённого формата и результат другого", async () => {
  const result = await analyze(archive({ "fabric.mod.json": "{", "litemod.json": '{"name":"Lite","revision":4}' }))
  expect(result.formats).toEqual(["fabric", "liteloader"])
  expect(result.diagnostics[0]).toMatchObject({ code: "INVALID_METADATA", source: "fabric.mod.json" })
  expect(result.mods[0]).toMatchObject({ name: "Lite", version: "4" })
})

test("не выдаёт скалярные JSON metadata за успешно разобранный мод", async () => {
  for (const input of ["null", "42", "[]"]) {
    const result = await analyze(archive({ "fabric.mod.json": input }))
    expect(result.mods).toEqual([])
    expect(result.diagnostics).toMatchObject([{ code: "INVALID_METADATA", source: "fabric.mod.json" }])
  }
})

test("неизвестный корректный архив отличается от повреждённого", async () => {
  const result = await analyze(archive({ "library.txt": "hello" }))
  expect(result.formats).toEqual([])
  expect(result.diagnostics).toMatchObject([{ code: "METADATA_NOT_FOUND" }])
  expect(result.completeness).toMatchObject({ metadata: false, classes: false })
  await expect(analyze(new Uint8Array([1, 2]))).rejects.toMatchObject({ code: "INVALID_ARCHIVE" })
})

test("слишком большие metadata дают диагностику без потери других форматов", async () => {
  const bytes = archive({ "fabric.mod.json": JSON.stringify({ id: "example", description: "x".repeat(300) }), "litemod.json": '{"name":"Lite"}' })
  const result = await analyze(bytes, { limits: { maxMetadataSize: 64 } })
  expect(result.diagnostics).toMatchObject([{ code: "LIMIT_EXCEEDED", source: "fabric.mod.json" }])
  expect(result.mods).toMatchObject([{ loader: "liteloader", name: "Lite" }])
})

test("пакетная обработка сохраняет порядок и ошибки отдельных архивов", async () => {
  const result = await analyzeBatch([archive({ "pack.mcmeta": '{"pack":{"pack_format":15,"description":"Example"}}' }), new Uint8Array([1])], { concurrency: 2 })
  expect(result[0].status).toBe("fulfilled")
  if (result[0].status === "fulfilled") expect(result[0].value.mods[0]).toMatchObject({ loader: "unknownpack", version: "15", description: "Example" })
  expect(result[1].status).toBe("rejected")
})

test("находит объявленные вложенные JAR и разбирает metadata только по запросу", async () => {
  const child = archive({ "fabric.mod.json": '{"id":"inner","version":"1"}' })
  const zip = new TestZip()
  zip.addFile("fabric.mod.json", Buffer.from(JSON.stringify({ id: "outer", depends: { inner: "1" }, jars: [{ file: "META-INF/jars/inner.jar" }, { file: "missing.jar" }] })))
  zip.addFile("META-INF/jars/inner.jar", Buffer.from(child))
  const data = new Uint8Array(zip.toBuffer())
  const listing = await analyze(data)
  expect(listing.embeddedJars).toMatchObject([{ path: "META-INF/jars/inner.jar", declared: true, present: true }, { path: "missing.jar", declared: true, present: false }])
  expect(listing.embeddedJars[0].result).toBeUndefined()
  expect(listing.completeness.embeddedJars).toBe(false)
  const result = await analyze(data, { nested: true })
  expect(result.embeddedJars[0].result?.mods[0]).toMatchObject({ id: "inner", version: "1" })
  expect(result.embeddedJars[0].matches).toEqual([{ dependencyId: "inner", embeddedVersion: "1", versionCheck: "exact" }])
  expect(result.dependencies).toMatchObject([{ id: "inner", versions: "1" }])
  const limited = await analyze(data, { nested: true, limits: { maxNestedArchives: 0 } })
  expect(limited.diagnostics).toMatchObject([{ code: "NESTED_LIMIT_EXCEEDED", source: "META-INF/jars/inner.jar" }])
})

test("совпадение ID вложенного мода не подтверждает диапазон версий", async () => {
  const child = archive({ "fabric.mod.json": '{"id":"inner","version":"1.2"}' })
  const zip = new TestZip()
  zip.addFile("fabric.mod.json", Buffer.from(JSON.stringify({ id: "outer", depends: { inner: ">=2" }, jars: [{ file: "META-INF/jars/not-the-id.jar" }] })))
  zip.addFile("META-INF/jars/not-the-id.jar", Buffer.from(child))
  const result = await analyze(new Uint8Array(zip.toBuffer()), { nested: true })
  expect(result.embeddedJars[0].matches).toEqual([{ dependencyId: "inner", embeddedVersion: "1.2", versionCheck: "unknown" }])
  expect(result.dependencies).toMatchObject([{ id: "inner", versions: ">=2" }])
})

test("повреждённый вложенный JAR не скрывает metadata родителя", async () => {
  const zip = new TestZip()
  zip.addFile("fabric.mod.json", Buffer.from('{"id":"parent","jars":[{"file":"META-INF/jars/broken.jar"}]}'))
  zip.addFile("META-INF/jars/broken.jar", Buffer.from("not a zip"))
  const result = await analyze(new Uint8Array(zip.toBuffer()), { nested: true })
  expect(result.mods[0]).toMatchObject({ id: "parent" })
  expect(result.embeddedJars[0]).toMatchObject({ path: "META-INF/jars/broken.jar", present: true })
  expect(result.diagnostics).toMatchObject([{ code: "INVALID_ARCHIVE", source: "META-INF/jars/broken.jar" }])
})
