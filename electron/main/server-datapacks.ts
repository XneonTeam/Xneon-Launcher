import fs from "node:fs/promises"
import path from "node:path"
import AdmZip from "adm-zip"

/** Мир сервера определяется level-name; вложенные каталоги допустимы только внутри сервера. */
export async function serverDatapackDirectory(root: string, levelName?: string): Promise<string> {
  const world = levelName?.trim() || "world"
  if (path.isAbsolute(world) || /^[a-z]:/i.test(world) || world.replace(/\\/g, "/").split("/").some(part => !part || part === "." || part === "..")) throw new Error("Invalid level-name")
  const target = path.resolve(root, world, "datapacks")
  const relative = path.relative(path.resolve(root), target)
  if (relative.startsWith("..") || path.isAbsolute(relative)) throw new Error("Invalid world path")
  let current = path.resolve(root)
  for (const part of relative.split(path.sep)) {
    current = path.join(current, part)
    const stat = await fs.lstat(current).catch(error => { if (error.code === "ENOENT") return null; throw error })
    if (stat?.isSymbolicLink()) throw new Error("Symbolic links are not supported for datapacks")
  }
  return target
}

export function validateDatapack(buffer: Buffer): void {
  const zip = new AdmZip(buffer)
  const entry = zip.getEntry("pack.mcmeta")
  if (!entry || entry.isDirectory || entry.header.size > 1024 * 1024) throw new Error("Datapack requires pack.mcmeta at archive root")
  const metadata = JSON.parse(zip.readAsText(entry))
  if (!metadata?.pack || typeof metadata.pack !== "object") throw new Error("Invalid pack.mcmeta")
}

export function datapackFileName(name: string): string {
  if (!name || path.basename(name) !== name || /[\\/:\x00-\x1f]/.test(name) || name === "." || name === "..") throw new Error("Invalid datapack filename")
  return name
}

export async function installServerDatapack(directory: string, name: string, buffer: Buffer, signal?: AbortSignal): Promise<void> {
  signal?.throwIfAborted()
  datapackFileName(name)
  if (!/\.zip$/i.test(name)) throw new Error("Datapack must be a ZIP archive")
  validateDatapack(buffer)
  await fs.mkdir(directory, { recursive: true })
  const target = path.join(directory, name)
  const stat = await fs.lstat(target).catch(error => { if (error.code === "ENOENT") return null; throw error })
  if (stat?.isSymbolicLink() || stat?.isDirectory()) throw new Error("Invalid datapack target")
  signal?.throwIfAborted()
  await fs.writeFile(target, buffer)
}

/** Не следуем ссылкам внутри распакованного датапака при удалении. */
export async function deleteServerDatapack(directory: string, name: string): Promise<void> {
  const target = path.join(directory, datapackFileName(name))
  const check = async (file: string): Promise<void> => {
    const stat = await fs.lstat(file)
    if (stat.isSymbolicLink()) throw new Error("Symbolic links are not supported for datapacks")
    if (stat.isDirectory()) for (const item of await fs.readdir(file)) await check(path.join(file, item))
  }
  await check(target)
  await fs.rm(target, { recursive: true, force: true })
}

export async function downloadDatapack(url: string, abortSignal?: AbortSignal): Promise<Buffer> {
  const signal = abortSignal ? AbortSignal.any([abortSignal, AbortSignal.timeout(60000)]) : AbortSignal.timeout(60000)
  for (let count = 0; count < 5; count++) {
    const parsed = new URL(url)
    if (parsed.protocol !== "https:" || parsed.username || parsed.password || !["cdn.modrinth.com", "edge.forgecdn.net", "mediafilez.forgecdn.net", "media.forgecdn.net"].includes(parsed.hostname)) throw new Error("Unsupported datapack download URL")
    const response = await fetch(url, { redirect: "manual", signal })
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const next = response.headers.get("location")
      await response.body?.cancel()
      if (!next) throw new Error("Invalid download redirect")
      url = new URL(next, url).href
      continue
    }
    if (!response.ok || !response.body) throw new Error("Datapack download failed")
    const chunks: Uint8Array[] = []
    let size = 0
    for await (const chunk of response.body as unknown as AsyncIterable<Uint8Array>) {
      size += chunk.byteLength
      if (size > 32 * 1024 * 1024) throw new Error("Datapack exceeds 32 MiB")
      chunks.push(chunk)
    }
    return Buffer.concat(chunks)
  }
  throw new Error("Too many download redirects")
}
