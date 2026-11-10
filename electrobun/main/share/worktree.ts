import fs from "node:fs/promises"
import path from "node:path"
import { createHash, randomUUID } from "node:crypto"
import { createReadStream } from "node:fs"
import { normalizePath, excluded, ShareError, type Worktree, type FileInfo } from "@xnlc/share"

export class ShareWorktree implements Worktree {
  constructor(private root: string) {}
  private async safe(relative: string): Promise<string> {
    const normalized = normalizePath(relative)
    const base = await fs.realpath(this.root)
    let target = base
    for (const segment of normalized.split("/")) {
      target = path.join(target, segment)
      const stat = await fs.lstat(target).catch(e => { if (e.code === "ENOENT") return null; throw e })
      if (stat?.isSymbolicLink()) throw new ShareError("PATH", "Symbolic links are forbidden in shared content")
      if (stat && target !== path.join(base, normalized) && !stat.isDirectory()) throw new ShareError("PATH", "Parent is not a directory")
    }
    if (!target.startsWith(base + path.sep)) throw new ShareError("PATH", "Path escapes instance")
    return target
  }
  async list(): Promise<FileInfo[]> {
    const result: FileInfo[] = []
    const walk = async (directory: string, prefix = "") => {
      for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
        const relative = prefix + entry.name
        if (excluded(relative)) continue
        if (entry.isSymbolicLink()) continue
        const target = await this.safe(relative)
        if (entry.isDirectory()) await walk(target, relative + "/")
        else if (entry.isFile()) {
          const stat = await fs.stat(target, { bigint: true })
          result.push({ path: relative, size: Number(stat.size), fingerprint: `${stat.dev}:${stat.ino}:${stat.size}:${stat.mtimeNs}:${stat.ctimeNs}` })
          if (result.length > 20000) throw new ShareError("SIZE", "Instance file limit exceeded")
        }
      }
    }
    await fs.mkdir(this.root, { recursive: true }); await walk(this.root); return result
  }
  async read(relative: string): Promise<Uint8Array> {
    const target = await this.safe(relative), stat = await fs.stat(target)
    if (stat.size > 32 * 1024 * 1024) throw new ShareError("SIZE", "External file exceeds limit")
    return fs.readFile(target)
  }
  async hash(relative: string) {
    const target = await this.safe(relative), before = await fs.stat(target, { bigint: true })
    const sha256 = createHash("sha256"), sha512 = createHash("sha512"), sha1 = createHash("sha1")
    for await (const chunk of createReadStream(target)) { sha256.update(chunk); sha512.update(chunk); sha1.update(chunk) }
    const after = await fs.stat(target, { bigint: true })
    if (before.ino !== after.ino || before.size !== after.size || before.mtimeNs !== after.mtimeNs || before.ctimeNs !== after.ctimeNs) throw new ShareError("CHANGED", "File changed while hashing")
    return { sha256: sha256.digest("hex"), sha512: sha512.digest("hex"), sha1: sha1.digest("hex") }
  }
  async recover(): Promise<void> {
    const state = path.join(this.root, ".xnlc-share")
    const stat = await fs.lstat(state).catch(() => null)
    if (stat?.isSymbolicLink()) throw new ShareError("PATH", "Share state directory cannot be a link")
    await fs.mkdir(state, { recursive: true })
    for (const name of await fs.readdir(state)) {
      if (!/^transaction-[a-f0-9-]+$/.test(name)) continue
      const dir = path.join(state, name)
      const journalPath = path.join(dir, "journal.json")
      const journal = await fs.readFile(journalPath, "utf8").then(JSON.parse).catch(e => { if (e.code === "ENOENT") return null; throw e }) as { committed: boolean; entries: { path: string; existed: boolean; applied: boolean; index: number }[] } | null
      if (!journal) continue
      if (!journal.committed) for (const item of [...journal.entries].reverse()) {
        if (!item.applied) continue
        const target = await this.safe(item.path)
        if (item.existed) await fs.copyFile(path.join(dir, `${item.index}.old`), target)
        else await fs.rm(target, { force: true })
      }
      await fs.rm(dir, { recursive: true, force: true })
    }
  }
  async apply(changes: { path: string; bytes: Uint8Array | null; expected: string | null }[]): Promise<void> {
    await this.recover()
    const dir = path.join(this.root, ".xnlc-share", `transaction-${randomUUID()}`)
    await fs.mkdir(dir, { recursive: true })
    const journal = { committed: false, entries: [] as { path: string; existed: boolean; applied: boolean; index: number }[] }
    const persist = async () => {
      await fs.writeFile(path.join(dir, "journal.next"), JSON.stringify(journal))
      await fs.rename(path.join(dir, "journal.next"), path.join(dir, "journal.json"))
    }
    try {
      for (const [index, change] of changes.entries()) {
        const target = await this.safe(change.path)
        const current = await this.hash(change.path).then(h => h.sha256).catch(e => { if (e.code === "ENOENT") return null; throw e })
        if (current !== change.expected) throw new ShareError("LOCAL_CHANGED", `Local file changed after preview: ${change.path}`)
        if (current !== null) await fs.copyFile(target, path.join(dir, `${index}.old`))
        if (change.bytes !== null) await fs.writeFile(path.join(dir, `${index}.new`), change.bytes)
        journal.entries.push({ path: change.path, existed: current !== null, applied: false, index })
      }
      await persist()
      for (const item of journal.entries) {
        const change = changes[item.index], target = await this.safe(item.path)
        const current = await this.hash(item.path).then(h => h.sha256).catch(e => { if (e.code === "ENOENT") return null; throw e })
        if (current !== change.expected) throw new ShareError("LOCAL_CHANGED", `Local file changed during update: ${item.path}`)
        await fs.mkdir(path.dirname(target), { recursive: true })
        item.applied = true; await persist()
        if (change.bytes === null) await fs.rm(target)
        else await fs.rename(path.join(dir, `${item.index}.new`), target)
      }
      journal.committed = true; await persist()
    } catch (e) { await this.recover(); throw e }
    await fs.rm(dir, { recursive: true, force: true })
  }
}
