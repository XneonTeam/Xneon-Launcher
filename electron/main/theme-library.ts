import fs from "node:fs/promises"
import path from "node:path"
import { createHash, randomUUID } from "node:crypto"
import type { LocalThemeFile, LocalThemeSnapshot, Theme } from "@xnlc/types"

export const THEME_TEXT_LIMIT = 1024 * 1024
export const THEME_MEDIA_LIMIT = 128 * 1024 * 1024
export const THEME_MEDIA_TYPES: Record<string, string> = {
  css: "text/css", png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", webp: "image/webp", gif: "image/gif", avif: "image/avif", bmp: "image/bmp", svg: "image/svg+xml",
  mp4: "video/mp4", webm: "video/webm", ogv: "video/ogg", ttf: "font/ttf", otf: "font/otf", woff: "font/woff", woff2: "font/woff2",
}

export function themeFileName(value: unknown): string {
  if (typeof value !== "string" || !value || value !== path.basename(value) || /[<>:"/\\|?*\x00-\x1f]/.test(value) || !/\.css$/i.test(value) || value.length > 180) throw new Error("Invalid theme file name")
  return value
}

/** Обрабатываем URL вне комментариев; неизвестные сетевые схемы оставляем браузеру. */
export async function rewriteThemeUrls(css: string, resolve: (url: string) => Promise<string>): Promise<string> {
  const pattern = /\/\*[\s\S]*?\*\/|@import\s+(?:"((?:\\.|[^"\\])*)"|'((?:\\.|[^'\\])*)')|url\(\s*(?:"((?:\\.|[^"\\])*)"|'((?:\\.|[^'\\])*)'|((?:\\.|[^\s)])+))\s*\)|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'/gi
  let result = "", last = 0
  for (const match of css.matchAll(pattern)) {
    result += css.slice(last, match.index)
    if (match[0].startsWith("/*") || /^["']/.test(match[0])) result += match[0]
    else {
      const source = (match[1] ?? match[2] ?? match[3] ?? match[4] ?? match[5]).replace(/\\([a-f\d]{1,6}\s?|[^\r\n])/gi, (_full, escaped: string) => {
        if (/^[a-f\d]/i.test(escaped)) {
          const point = parseInt(escaped.trim(), 16)
          return point > 0 && point <= 0x10ffff ? String.fromCodePoint(point) : "\ufffd"
        }
        return escaped
      })
      const rewritten = await resolve(source)
      result += `${/^@import/i.test(match[0]) ? "@import " : ""}url(${JSON.stringify(rewritten)})`
    }
    last = match.index! + match[0].length
  }
  return result + css.slice(last)
}

/** Файловая библиотека не зависит от Electron: диалоги и события находятся в адаптере. */
export class ThemeLibrary {
  private revision = 0
  private queue: Promise<unknown> = Promise.resolve()
  constructor(readonly directory: string, readonly mediaDirectory: string) {}

  private serial<T>(operation: () => Promise<T>): Promise<T> {
    const next = this.queue.then(operation)
    this.queue = next.catch(() => {})
    return next
  }

  private async bounded(file: string, max: number): Promise<Buffer> {
    if ((await fs.stat(file)).size > max) throw new Error("Theme file exceeds size limit")
    const content = await fs.readFile(file)
    if (content.length > max) throw new Error("Theme file exceeds size limit")
    return content
  }

  /** Относительные ресурсы привязаны к папке CSS, импортированные ресурсы становятся переносимыми. */
  private async materialize(css: string, baseDirectory: string, allowedRoot: string, seen = new Set<string>(), budget = { count: 0, bytes: 0, cache: new Map<string, string>() }): Promise<string> {
    return rewriteThemeUrls(css, async source => {
      if (!source || source.startsWith("#") || /^(?:[a-z][a-z\d+.-]*:|\/\/)/i.test(source)) return source
      const suffix = source.search(/[?#]/)
      const relative = suffix < 0 ? source : source.slice(0, suffix), fragment = suffix < 0 ? "" : source.slice(suffix)
      if (path.isAbsolute(relative)) throw new Error("Absolute theme resource path is not allowed")
      const target = await fs.realpath(path.resolve(baseDirectory, decodeURIComponent(relative)))
      const root = await fs.realpath(allowedRoot)
      const within = path.relative(root, target)
      if (within.startsWith(".." + path.sep) || within === ".." || path.isAbsolute(within)) throw new Error("Theme resource is outside its directory")
      const ext = path.extname(target).slice(1).toLowerCase()
      if (!THEME_MEDIA_TYPES[ext]) throw new Error("Unsupported theme resource")
      if (seen.has(target) || seen.size >= 32) throw new Error("Cyclic or excessive CSS imports")
      const cached = budget.cache.get(target)
      if (cached) return cached + fragment
      if (++budget.count > 1024) throw new Error("Too many theme resources")
      let data = await this.bounded(target, ext === "css" ? THEME_TEXT_LIMIT : THEME_MEDIA_LIMIT)
      budget.bytes += data.length
      if (budget.bytes > 512 * 1024 * 1024) throw new Error("Theme resources exceed size limit")
      if (ext === "css") data = Buffer.from(await this.materialize(data.toString("utf8"), path.dirname(target), root, new Set([...seen, target]), budget))
      const name = `${createHash("sha256").update(data).digest("hex")}.${ext}`
      await fs.mkdir(this.mediaDirectory, { recursive: true })
      await fs.writeFile(path.join(this.mediaDirectory, name), data, { flag: "wx" }).catch((error: NodeJS.ErrnoException) => { if (error.code !== "EEXIST") throw error })
      const result = `xnl-theme://asset/${name}`
      budget.cache.set(target, result)
      return result + fragment
    })
  }

  async importCss(file: string): Promise<LocalThemeFile> {
    return this.serial(async () => {
      const content = await this.bounded(file, THEME_TEXT_LIMIT)
      const css = await this.materialize(content.toString("utf8"), path.dirname(file), path.dirname(file), new Set([await fs.realpath(file)]))
      const stem = path.basename(file, path.extname(file)).replace(/[<>:"/\\|?*\x00-\x1f]/g, "_").slice(0, 80) || "theme"
      const fileName = `${stem}-${randomUUID().slice(0, 8)}.css`
      await fs.mkdir(this.directory, { recursive: true })
      await fs.writeFile(path.join(this.directory, fileName), css, { flag: "wx" })
      return { fileName, name: stem, css }
    })
  }

  async save(theme: Theme, css: string): Promise<LocalThemeFile> {
    return this.serial(async () => {
      if (!theme || typeof theme.id !== "string" || !theme.id.startsWith("custom-") || typeof theme.name !== "string" || typeof css !== "string" || Buffer.byteLength(css) > THEME_TEXT_LIMIT) throw new Error("Invalid local theme")
      const fileName = themeFileName(theme.localFile ?? `${theme.id.replace(/[^a-z\d_-]/gi, "_").slice(0, 150)}.css`)
      await fs.mkdir(this.directory, { recursive: true })
      const resolvedCss = await this.materialize(css, this.directory, this.directory)
      const resolvedTheme = { ...theme, localFile: fileName }
      if (resolvedTheme.readerCss) resolvedTheme.readerCss = await this.materialize(resolvedTheme.readerCss, this.directory, this.directory)
      const target = path.join(this.directory, fileName)
      // Временные файлы не читаются наблюдателем. CSS записываем последним.
      const metadata = `${target}.json`, metaText = JSON.stringify({ ...theme, localFile: fileName })
      if (Buffer.byteLength(metaText) > 2 * THEME_TEXT_LIMIT) throw new Error("Theme metadata exceeds size limit")
      const token = randomUUID(), metaTemp = `${metadata}.${token}.tmp`, cssTemp = `${target}.${token}.tmp`
      try {
        await fs.writeFile(metaTemp, metaText, { flag: "wx" })
        await fs.writeFile(cssTemp, css, { flag: "wx" })
        await fs.rename(metaTemp, metadata)
        await fs.rename(cssTemp, target)
      } finally {
        await fs.rm(metaTemp, { force: true })
        await fs.rm(cssTemp, { force: true })
      }
      return { fileName, name: theme.name, css: resolvedCss, theme: resolvedTheme }
    })
  }

  async remove(fileName: string): Promise<void> {
    return this.serial(async () => {
      const target = path.join(this.directory, themeFileName(fileName))
      await fs.rm(target, { force: true })
      await fs.rm(`${target}.json`, { force: true })
    })
  }

  async snapshot(): Promise<LocalThemeSnapshot> {
    return this.serial(async () => {
      await fs.mkdir(this.directory, { recursive: true })
      const files: LocalThemeFile[] = [], errors: string[] = []
      for (const entry of (await fs.readdir(this.directory, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
        if (!entry.isFile() || !/\.css$/i.test(entry.name)) continue
        try {
          const fileName = themeFileName(entry.name), target = path.join(this.directory, fileName)
          const css = await this.materialize((await this.bounded(target, THEME_TEXT_LIMIT)).toString("utf8"), this.directory, this.directory, new Set([await fs.realpath(target)]))
          let theme: Theme | undefined
          try { theme = JSON.parse((await this.bounded(`${target}.json`, 2 * THEME_TEXT_LIMIT)).toString("utf8")) as Theme } catch { /* CSS работает и без метаданных. */ }
          if (typeof theme?.readerCss === "string") theme.readerCss = await this.materialize(theme.readerCss, this.directory, this.directory)
          files.push({ fileName, name: typeof theme?.name === "string" ? theme.name : fileName.slice(0, -4), css, theme })
        } catch (error) { errors.push(`${entry.name}: ${error instanceof Error ? error.message : String(error)}`) }
      }
      return { revision: ++this.revision, files, errors }
    })
  }

  /** CSS и соседняя папка ресурсов работают вне лаунчера и на другом устройстве. */
  async exportCss(target: string, css: string): Promise<void> {
    if (typeof css !== "string" || Buffer.byteLength(css) > THEME_TEXT_LIMIT) throw new Error("Invalid theme CSS")
    const assets = `${path.basename(target, path.extname(target))}.assets`
    const done = new Set<string>()
    const rewrite = async (text: string, nested: boolean): Promise<string> => rewriteThemeUrls(text, async source => {
      const match = /^xnl-theme:\/\/asset\/([a-f\d]{64}\.([a-z\d]+))([?#].*)?$/i.exec(source)
      if (!match) return source
      const [, name, ext, fragment] = match
      if (!THEME_MEDIA_TYPES[ext]) throw new Error("Unsupported theme resource")
      if (!done.has(name)) {
        done.add(name)
        let data = await this.bounded(path.join(this.mediaDirectory, name), THEME_MEDIA_LIMIT)
        if (createHash("sha256").update(data).digest("hex") !== name.split(".")[0]) throw new Error("Theme media checksum mismatch")
        if (ext === "css") data = Buffer.from(await rewrite(data.toString("utf8"), true))
        await fs.mkdir(path.join(path.dirname(target), assets), { recursive: true })
        await fs.writeFile(path.join(path.dirname(target), assets, name), data)
      }
      return `${nested ? "./" : `./${assets}/`}${name}${fragment ?? ""}`
    })
    const portable = await rewrite(css, false)
    await fs.writeFile(target, portable)
  }
}
