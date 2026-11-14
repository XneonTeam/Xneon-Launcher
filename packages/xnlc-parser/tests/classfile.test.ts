import { describe, expect, test } from "bun:test"
import TestZip from "../../../tests/helpers/zip"
import { ArchiveContext, forgeModAnnotations, parseClassFile, scanArchiveClasses } from "../src"

const fixture = Buffer.from((await Bun.file(new URL("./fixtures/classfile/Example.class.base64", import.meta.url)).text()).trim(), "base64")

describe("анализ Java class", () => {
  test("читает аннотации и modified UTF-8 из настоящего javac", () => {
    const info = parseClassFile(fixture)
    expect(info.name).toBe("net/minecraftforge/fml/common/Example")
    expect(info.superName).toBe("java/lang/Object")
    expect(info.interfaces).toEqual(["java/lang/Runnable"])
    const mod = forgeModAnnotations(info)[0]
    expect(mod.visible).toBe(true)
    expect(mod.values.value).toBe("example\0😀")
    expect(mod.values.number).toBe(42)
    expect(mod.values.aliases).toEqual(["first", "second"])
    expect(mod.values.target).toBe("Ljava/lang/String;")
    expect(info.annotations.find(item => item.descriptor.endsWith("/Hidden;"))?.visible).toBe(false)
  })

  test("отклоняет усечённые и повреждённые файлы", () => {
    for (let length = 0; length < fixture.length; length++) {
      expect(() => parseClassFile(fixture.subarray(0, length))).toThrow()
    }
    const badMagic = Buffer.from(fixture); badMagic[0] = 0
    expect(() => parseClassFile(badMagic)).toThrow("Invalid class magic")
    const badPool = Buffer.from(fixture); badPool[10] = 255
    expect(() => parseClassFile(badPool)).toThrow("Unsupported constant pool tag")
    expect(() => parseClassFile(fixture, { maxClassSize: 1 })).toThrow("Class size limit")
    expect(() => parseClassFile(fixture, { maxAnnotationValues: 1 })).toThrow("Annotation limit")
  })

  test("ограничивает сканирование и сообщает об ошибках отдельных классов", async () => {
    const zip = new TestZip()
    zip.addFile("Example.class", fixture)
    zip.addFile("broken.class", Buffer.from([0, 1, 2]))
    const archive = await ArchiveContext.open(new Uint8Array(zip.toBuffer()))
    const result = await scanArchiveClasses(archive)
    expect(result.classes).toHaveLength(1)
    expect(result.diagnostics.map(item => item.path)).toEqual(["broken.class"])
    expect(result.complete).toBe(false)
    const limited = await scanArchiveClasses(archive, { maxClasses: 0 })
    expect(limited.classes).toHaveLength(0)
    expect(limited.complete).toBe(false)
    archive.close()
  })
})
