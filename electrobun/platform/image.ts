import { PNG } from "pngjs"

class NativeImage {
  private readonly png: PNG | undefined

  constructor(buffer: Buffer) {
    try { this.png = PNG.sync.read(buffer) } catch { /* Повреждённое изображение. */ }
  }

  isEmpty() { return !this.png }
  getSize() { return { width: this.png?.width ?? 0, height: this.png?.height ?? 0 } }
  toPNG() { return this.png ? PNG.sync.write(this.png) : Buffer.alloc(0) }

  resize({ width, height }: { width: number; height?: number }) {
    const source = this.png
    if (!source) return this
    const target = new PNG({ width, height: height ?? Math.max(1, Math.round(source.height * width / source.width)) })
    for (let y = 0; y < target.height; y++) {
      for (let x = 0; x < target.width; x++) {
        const from = (Math.floor(y * source.height / target.height) * source.width + Math.floor(x * source.width / target.width)) * 4
        const to = (y * target.width + x) * 4
        source.data.copy(target.data, to, from, from + 4)
      }
    }
    return new NativeImage(PNG.sync.write(target))
  }
}

export const nativeImage = {
  createFromBuffer: (buffer: Buffer) => new NativeImage(buffer),
  createFromDataURL: (url: string) => new NativeImage(Buffer.from(url.split(",")[1] ?? "", "base64")),
}
