import fs from "node:fs/promises"
import path from "node:path"

/** Обновление названия переносит и папку: файловые операции лаунчера используют имя сборки. */
export async function prepareSharedRename(directory: string, currentName: string, incomingName: string, usedNames: string[], folderName: (name: string) => string) {
  const parent = path.dirname(directory)
  const original = path.resolve(directory).toLowerCase()
  const used = new Set(usedNames.map(name => folderName(name).toLowerCase()))
  let name = incomingName, suffix = 2
  for (;;) {
    const target = path.join(parent, folderName(name))
    if (path.resolve(target).toLowerCase() === original) return { name, directory, move: async () => {}, rollback: async () => {} }
    const exists = await fs.lstat(target).then(() => true).catch(error => { if (error.code === "ENOENT") return false; throw error })
    if (!exists && !used.has(folderName(name).toLowerCase())) {
      let moved = false
      return { name, directory: target, move: async () => { await fs.rename(directory, target); moved = true }, rollback: async () => { if (moved) await fs.rename(target, directory) } }
    }
    name = `${incomingName} (${suffix++})`
    if (name === currentName) return { name, directory, move: async () => {}, rollback: async () => {} }
  }
}
