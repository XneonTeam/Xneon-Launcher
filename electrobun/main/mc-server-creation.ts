import fs from "node:fs/promises"
import path from "node:path"
import { randomUUID } from "node:crypto"
import { constants } from "node:fs"
import type { McServerRow } from "../db/mc-servers"

type CreationOptions = {
  directory: (id: string) => string
  store: {
    createMcServer: (row: McServerRow) => Promise<void>
    getMcServer: (id: string) => Promise<McServerRow | null>
    listMcServers: () => Promise<McServerRow[]>
    deleteMcServer: (id: string) => Promise<void>
  }
}

export async function copyCustomServerJar(source: string, directory: string): Promise<void> {
  const before = await fs.lstat(source)
  if (!before.isFile() || before.isSymbolicLink()) throw new Error("Custom server JAR must be a regular file")
  await fs.copyFile(source, path.join(directory, "custom-server.jar"), constants.COPYFILE_EXCL)
  const after = await fs.lstat(source)
  if (after.isSymbolicLink() || before.size !== after.size || before.mtimeMs !== after.mtimeMs || before.ctimeMs !== after.ctimeMs) throw new Error("Custom server JAR changed during copy")
}

// Одно место выбора имён/портов для локальных и удалённых вызовов.
let creationQueue: Promise<unknown> = Promise.resolve()
function serialize<T>(operation: () => Promise<T>): Promise<T> {
  const result = creationQueue.then(operation)
  creationQueue = result.catch(() => {})
  return result
}

async function publish(row: McServerRow, options: CreationOptions, populate?: (stage: string) => Promise<void>): Promise<McServerRow> {
  if (!/^[a-zA-Z0-9-]+$/.test(row.id)) throw new Error("Invalid server id")
  if (await options.store.getMcServer(row.id)) throw new Error("Server already exists")
  const destination = options.directory(row.id)
  await fs.mkdir(path.dirname(destination), { recursive: true })
  const stage = await fs.mkdtemp(path.join(path.dirname(destination), ".server-create-"))
  let reservation: Awaited<ReturnType<typeof fs.open>> | undefined
  let published = false
  try {
    await populate?.(stage)
    // На Windows rename не заменяет даже пустой каталог. Резервируем имя
    // отдельным эксклюзивным файлом, оставляя конечный путь свободным.
    reservation = await fs.open(destination + ".creating", "wx")
    const existing = await fs.lstat(destination).catch(error => { if (error.code === "ENOENT") return null; throw error })
    if (existing) throw new Error("Server directory already exists")
    await fs.rename(stage, destination)
    published = true
    await options.store.createMcServer(row)
    const saved = await options.store.getMcServer(row.id)
    if (!saved) throw new Error("Server was not persisted")
    return saved
  } catch (error) {
    // Если хранилище успело записать строку перед ошибкой, компенсируем её.
    // При отказе компенсации оставляем файлы: запись не должна указывать в пустоту.
    try {
      if (published && await options.store.getMcServer(row.id)) await options.store.deleteMcServer(row.id)
    } catch (rollbackError) {
      throw new AggregateError([error, rollbackError], "Server creation rollback failed; files retained")
    }
    if (published) await fs.rm(destination, { recursive: true, force: true })
    throw error
  } finally {
    if (reservation) {
      await reservation.close()
      await fs.rm(destination + ".creating", { force: true })
    }
    await fs.rm(stage, { recursive: true, force: true })
  }
}

export function createServerWithFiles(row: McServerRow, options: CreationOptions, populate?: (stage: string) => Promise<void>): Promise<McServerRow> {
  return serialize(() => publish(row, options, populate))
}

export function duplicateServerWithFiles(id: string, options: CreationOptions): Promise<McServerRow | null> {
  return serialize(async () => {
    const original = await options.store.getMcServer(id)
    if (!original) return null
    const source = options.directory(id)
    const stat = await fs.lstat(source).catch(error => {
      if (error.code === "ENOENT") throw Object.assign(new Error("Server source directory is missing"), { code: "SERVER_SOURCE_MISSING" })
      throw error
    })
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error("Server source contains a link or is not a directory")
    const existing = await options.store.listMcServers()
    let name = `${original.name} (копия)`
    for (let index = 2; existing.some(row => row.name.normalize("NFC").toLowerCase() === name.normalize("NFC").toLowerCase()); index++) {
      name = `${original.name} (копия ${index})`
    }
    const ports = new Set(existing.map(row => row.port))
    let port = original.port
    if (!Number.isInteger(port) || port < 1 || port > 65535) port = 25565
    for (let count = 0; ports.has(port); count++) {
      if (count >= 65535) throw new Error("No free server port")
      port = port === 65535 ? 1024 : port + 1
    }
    const row = { ...original, id: randomUUID(), name, port, createdAt: new Date().toISOString(), trashedAt: null }
    return publish(row, options, async stage => {
      const seen = new Set<string>()
      await fs.cp(source, stage, { recursive: true, force: false, filter: async file => {
        const stat = await fs.lstat(file)
        if (stat.isSymbolicLink()) throw new Error("Server copy contains a link")
        if (!stat.isDirectory() && !stat.isFile()) throw new Error("Invalid server file")
        const normalized = path.relative(source, file).normalize("NFC").toLowerCase()
        if (seen.has(normalized)) throw new Error("Duplicate normalized server path")
        seen.add(normalized)
        return true
      } })
      const properties = path.join(stage, "server.properties")
      let content: string
      try { content = await fs.readFile(properties, "utf8") } catch (error) { if (error.code === "ENOENT") return; throw error }
      // Все вхождения порта приводим к новому значению; прочие настройки сохраняем.
      const line = /^\s*server-port\s*[:=].*$/gm
      content = line.test(content) ? content.replace(line, `server-port=${port}`) : content + `\nserver-port=${port}\n`
      await fs.writeFile(properties, content)
    })
  })
}
