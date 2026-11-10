import { clipboard } from "../platform/desktop"
import fs from "node:fs/promises"
import path from "node:path"
import { fileURLToPath } from "node:url"

/** Разбираем пути только из файловых форматов буфера, а не из обычного текста. */
export function clipboardFilePaths(formats: string[], read: (format: string) => Buffer): string[] {
  const result: string[] = []
  for (const format of formats) {
    if (format === "FileNameW") result.push(...read(format).toString("utf16le").split("\0").filter(Boolean))
    else if (format === "CF_HDROP" || format === "FileDrop") {
      const bytes = read(format)
      if (bytes.length < 20) continue
      const offset = bytes.readUInt32LE(0)
      if (offset < 20 || offset >= bytes.length) continue
      const encoding = bytes.readUInt32LE(16) ? "utf16le" : "latin1"
      result.push(...bytes.subarray(offset).toString(encoding).split("\0").filter(Boolean))
    } else if (format === "text/uri-list") {
      for (const line of read(format).toString("utf8").split(/\r?\n/)) {
        try { if (line.startsWith("file:")) result.push(fileURLToPath(line)) } catch { /* Некорректная ссылка не является вложением. */ }
      }
    }
  }
  return [...new Set(result)].slice(0, 8)
}

export async function readClipboardFiles(): Promise<Array<{ name: string; dataUrl: string }>> {
  const buffers = new Map<string, Buffer>()
  const images: Array<{ name: string; dataUrl: string }> = []
  for (const item of (await clipboard.read()).slice(0, 8)) {
    for (const type of item.types) {
      const raw = /^electron application\/osclipboard;format="([^"]+)"$/.exec(type)?.[1] ?? type
      if (!["FileNameW", "CF_HDROP", "FileDrop", "text/uri-list", "image/png", "image/jpeg", "image/webp", "image/gif"].includes(raw)) continue
      const blob = await item.getType(type)
      if (!("size" in blob) || blob.size > 2_000_000) continue
      const data = Buffer.from(await blob.arrayBuffer())
      if (raw.startsWith("image/")) {
        if (!images.length) images.push({ name: `clipboard.${raw.split("/")[1]}`, dataUrl: `data:${raw};base64,${data.toString("base64")}` })
      } else buffers.set(raw, data)
    }
  }
  const paths = clipboardFilePaths([...buffers.keys()], format => buffers.get(format)!)
  const result: Array<{ name: string; dataUrl: string }> = []
  for (const filePath of paths) {
    try {
      const stat = await fs.stat(filePath)
      if (!stat.isFile() || stat.size > 2_000_000) continue
      const data = await fs.readFile(filePath)
      if (data.length > 2_000_000) continue
      const extension = path.extname(filePath).toLowerCase()
      const mime = ({ ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp", ".gif": "image/gif" } as Record<string, string>)[extension] ?? "application/octet-stream"
      result.push({ name: path.basename(filePath), dataUrl: `data:${mime};base64,${data.toString("base64")}` })
    } catch { /* Удалённый или недоступный файл пропускаем. */ }
  }
  return result.length ? result : images
}
