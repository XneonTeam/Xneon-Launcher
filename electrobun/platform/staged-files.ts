import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { app } from "./desktop"

const directories = new Set<string>()
const maxFileBytes = 64 * 1024 * 1024
let stagedBytes = 0

export async function stageFile(name: string, encoded: string) {
  if (typeof name !== "string" || !name || name.length > 240 || /[<>:"/\\|?*\x00-\x1f]/.test(name)
    || name === "." || name === ".." || /[. ]$/.test(name) || typeof encoded !== "string"
    || encoded.length > Math.ceil(maxFileBytes / 3) * 4) throw new Error("Invalid local file")
  const bytes = Buffer.from(encoded, "base64")
  if (bytes.length > maxFileBytes || stagedBytes + bytes.length > 256 * 1024 * 1024) throw new Error("Local file limit exceeded")
  stagedBytes += bytes.length
  let directory: string | undefined
  try {
    directory = await mkdtemp(path.join(tmpdir(), "xneon-bun-upload-"))
    const file = path.join(directory, name)
    await writeFile(file, bytes, { flag: "wx" })
    directories.add(directory)
    return file
  } catch (error) {
    stagedBytes -= bytes.length
    if (directory) await rm(directory, { recursive: true, force: true }).catch(() => {})
    throw error
  }
}

export function registerStagedFileCleanup() {
  app.on("before-quit", event => {
    if (directories.size === 0) return
    event.preventDefault()
    const pending = [...directories]
    directories.clear()
    void Promise.allSettled(pending.map(directory => rm(directory, { recursive: true, force: true }))).then(() => app.quit())
  })
}
