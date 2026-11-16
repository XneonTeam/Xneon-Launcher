import { readFile, writeFile, rename, mkdir, readdir, unlink, stat } from "node:fs/promises"
import path from "node:path"

/** Один main-процесс пишет отдельный event-cache. Не использовать пользовательскую папку themes. */
export function createFileStorage(directory) {
  const valid = digest => { if (!/^[a-f0-9]{64}$/.test(digest)) throw new Error("Invalid package digest"); return digest }
  const file = digest => path.join(directory, valid(digest) + ".json")
  const read = async (file, limit) => {
    try { if ((await stat(file)).size > limit) return null; return await readFile(file) }
    catch (error) { if (error.code === "ENOENT") return null; throw error }
  }
  const atomic = async (file, data) => {
    await mkdir(directory, { recursive: true, mode: 0o700 })
    const temporary = file + ".tmp"
    await writeFile(temporary, data, { mode: 0o600 })
    await rename(temporary, file)
  }
  return {
    async loadState() {
      const bytes = await read(path.join(directory, "state.json"), 128_000)
      try { return bytes ? JSON.parse(bytes.toString("utf8")) : null } catch { return null }
    },
    async saveState(state) {
      const bytes = Buffer.from(JSON.stringify(state))
      if (bytes.length > 128_000) throw new Error("Event state exceeds limit")
      await atomic(path.join(directory, "state.json"), bytes)
    },
    readPackage: digest => read(file(digest), 4_000_000),
    async writePackage(digest, bytes) {
      if (bytes.length > 4_000_000) throw new Error("Event package exceeds limit")
      await atomic(file(digest), bytes)
    },
    async prunePackages(keep) {
      let entries
      try { entries = await readdir(directory) } catch (error) { if (error.code === "ENOENT") return; throw error }
      for (const entry of entries) {
        if (/^[a-f0-9]{64}\.json(?:\.tmp)?$/.test(entry) && entry !== `${keep}.json`) await unlink(path.join(directory, entry))
      }
    },
  }
}
