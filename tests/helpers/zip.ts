import { unzipSync, zipSync } from "fflate"

export interface TestZipEntry {
  entryName: string
  isDirectory: boolean
  header: { size: number }
  getData(): Buffer
}

/**
 * Мини-хелпер для ZIP-фикстур в тестах: создание архивов и чтение готовых.
 *
 * Сжатие и распаковка — те же, что в продукте (`fflate`), поэтому фикстуры
 * проверяют реальные пути кода, а не поведение сторонней библиотеки.
 */
export class TestZip {
  private readonly files = new Map<string, Buffer>()

  constructor(input?: Uint8Array) {
    if (!input) return
    for (const [name, data] of Object.entries(unzipSync(new Uint8Array(input)))) {
      this.files.set(name, Buffer.from(data.buffer, data.byteOffset, data.byteLength))
    }
  }

  addFile(name: string, data: Uint8Array): void {
    this.files.set(name.replace(/\\/g, "/"), Buffer.from(data))
  }

  getEntries(): TestZipEntry[] {
    return [...this.files].map(([entryName, data]) => ({
      entryName,
      isDirectory: entryName.endsWith("/"),
      header: { size: data.length },
      getData: () => Buffer.from(data),
    }))
  }

  readAsText(name: string, encoding: BufferEncoding = "utf8"): string {
    const data = this.files.get(name)
    if (!data) throw new Error(`Archive entry is missing: ${name}`)
    return data.toString(encoding)
  }

  toBuffer(): Buffer {
    // Fingerprint сравнивает байты, поэтому дата фикстуры не зависит от часов.
    return Buffer.from(zipSync(Object.fromEntries(this.files), { mtime: new Date(2000, 0, 1) }))
  }
}

export default TestZip
