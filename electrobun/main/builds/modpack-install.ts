import fs from "node:fs/promises"
import { createReadStream } from "node:fs"
import path from "node:path"
import { createHash } from "node:crypto"

const STATE = ".xnlc-modpack"
const MANIFEST = `${STATE}/managed.json`
const active = new Set<string>()
const applying = new Set<string>()
const key = (directory: string) => process.platform === "win32" ? path.resolve(directory).toLowerCase() : path.resolve(directory)
const absent = (error: unknown) => (error as NodeJS.ErrnoException).code === "ENOENT"
type Managed = { version: 1; files: Record<string, string> }
type Change = { path: string; before: string | null; after: string | null; source?: string }
type Journal = { version: 1; committed: boolean; changes: Change[]; metadata?: { token: string } }

export interface ModpackPersistencePort {
  begin(root: string, buildId: string): Promise<string>
  write(root: string, token: string, fields: Record<string, unknown>): Promise<void>
  rollback(root: string, token: string): Promise<void>
  finalize(root: string, token: string): Promise<void>
}
let persistence: ModpackPersistencePort | undefined
export function setModpackPersistence(port?: ModpackPersistencePort): void {
  if (active.size) throw new Error("Cannot replace persistence during modpack installation")
  persistence = port
}
export function isModpackInstalling(directory: string): boolean { return active.has(key(directory)) }

export function isModpackApplying(directory: string): boolean { return applying.has(key(directory)) }

function checkName(relative: string, internal = false): void {
  if (!relative || relative.includes("\\") || relative.startsWith("/") || relative.split("/").some(segment =>
    !segment || segment === "." || segment === ".." || /[<>:"|?*\x00-\x1f]/.test(segment) || /[. ]$/.test(segment)
    || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(segment))) throw new Error("Invalid modpack file path")
  if (!internal && relative.split("/")[0].toLowerCase() === STATE) throw new Error("Modpack cannot replace its installation state")
}

/** Канонические коллизии проверяются до загрузки, а не после записи в staging. */
export function createModpackPathClaims(): (relative: string) => void {
  const claimed = new Set<string>()
  const directories = new Set<string>()
  return relative => {
    checkName(relative)
    const canonical = relative.normalize("NFC").toLowerCase()
    if (claimed.has(canonical)) throw new Error("Duplicate normalized modpack path")
    const parts = canonical.split("/")
    const parents = parts.slice(0, -1).map((_part, index) => parts.slice(0, index + 1).join("/"))
    if (directories.has(canonical) || parents.some(parent => claimed.has(parent))) throw new Error("Modpack file conflicts with a directory")
    for (const parent of parents) directories.add(parent)
    claimed.add(canonical)
  }
}

export function validateModpackPaths(paths: Iterable<string>): void {
  const claim = createModpackPathClaims()
  for (const relative of paths) claim(relative)
}

/** Не следуем ссылкам ни в staging, ни в каталоге пользователя, ни в журнале. */
async function safe(root: string, relative: string, internal = false): Promise<string> {
  checkName(relative, internal)
  let target = root
  const segments = relative.split("/")
  for (let i = 0; i < segments.length; i++) {
    target = path.join(target, segments[i])
    const stat = await fs.lstat(target).catch(error => { if (absent(error)) return null; throw error })
    if (stat?.isSymbolicLink() || stat && i < segments.length - 1 && !stat.isDirectory()) throw new Error("Modpack path contains a link or invalid parent")
  }
  return target
}

async function digest(file: string, signal?: AbortSignal): Promise<string | null> {
  const stat = await fs.lstat(file).catch(error => { if (absent(error)) return null; throw error })
  if (!stat) return null
  if (!stat.isFile()) throw new Error("Modpack target is not a regular file")
  const hash = createHash("sha256")
  for await (const chunk of createReadStream(file, { signal })) hash.update(chunk)
  const after = await fs.stat(file)
  if (stat.ino !== after.ino || stat.size !== after.size || stat.mtimeMs !== after.mtimeMs || stat.ctimeMs !== after.ctimeMs) throw new Error("Modpack file changed while reading")
  return hash.digest("hex")
}

async function readJson(file: string): Promise<unknown | null> {
  const stat = await fs.lstat(file).catch(error => { if (absent(error)) return null; throw error })
  if (!stat) return null
  if (!stat.isFile() || stat.size > 16 * 1024 * 1024) throw new Error("Invalid modpack state file")
  return JSON.parse(await fs.readFile(file, "utf8"))
}

async function writeJson(file: string, value: unknown): Promise<void> {
  const text = JSON.stringify(value)
  if (Buffer.byteLength(text) > 16 * 1024 * 1024) throw new Error("Modpack journal exceeds size limit")
  await fs.writeFile(file + ".next", text, { flag: "wx" })
  await fs.rename(file + ".next", file)
}

async function rootPath(directory: string): Promise<string> {
  const stat = await fs.lstat(directory)
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error("Modpack root must be a local directory")
  return fs.realpath(directory)
}

function isHash(value: unknown): value is string { return typeof value === "string" && /^[a-f0-9]{64}$/.test(value) }
function userData(relative: string): boolean { return /^(saves|screenshots|logs|backups|assets|libraries|runtime|versions)(\/|$)/i.test(relative) }

async function inBatches<T>(items: T[], run: (item: T, index: number) => Promise<void>): Promise<void> {
  for (let offset = 0; offset < items.length; offset += 8) {
    const results = await Promise.allSettled(items.slice(offset, offset + 8).map((item, index) => run(item, offset + index)))
    const failure = results.find((result): result is PromiseRejectedResult => result.status === "rejected")
    if (failure) throw failure.reason
  }
}

async function rollback(root: string, transaction: string, journal: Journal): Promise<void> {
  if (journal.metadata && !persistence) throw new Error("Modpack metadata recovery is unavailable")
  for (let index = journal.changes.length - 1; index >= 0; index--) {
    const change = journal.changes[index]
    const target = await safe(root, change.path, change.path === MANIFEST)
    const backup = path.join(transaction, `${index}.old`)
    const saved = await digest(backup)
    const current = await digest(target)
    if (saved !== null) {
      if (saved !== change.before || current !== null && current !== change.after) throw new Error(`Modpack recovery conflict; backup retained: ${change.path}`)
      await fs.mkdir(path.dirname(target), { recursive: true })
      if (current !== null) await fs.rm(target)
      await fs.rename(backup, target)
    } else if (current !== change.before) {
      if (change.before !== null || current !== change.after) throw new Error(`Modpack recovery conflict; journal retained: ${change.path}`)
      if (current !== null) await fs.rm(target)
    }
  }
  if (journal.metadata) await persistence!.rollback(root, journal.metadata.token)
}

/** Восстановление незавершённой установки до следующего импорта или запуска. */
export async function recoverModpackInstall(directory: string): Promise<void> {
  const exists = await fs.lstat(directory).catch(error => { if (absent(error)) return null; throw error })
  if (!exists) return
  const root = await rootPath(directory)
  if (active.has(key(root))) throw new Error("Modpack installation is already running")
  active.add(key(root))
  try { await recoverAtRoot(root) } finally { active.delete(key(root)) }
}

async function recoverAtRoot(root: string): Promise<void> {
  const state = await safe(root, STATE, true)
  const stat = await fs.lstat(state).catch(error => { if (absent(error)) return null; throw error })
  if (!stat) return
  const transaction = await safe(root, `${STATE}/transaction`, true)
  const parsed = await readJson(path.join(transaction, "journal.json")) as Journal | null
  if (parsed) {
    if (parsed.version !== 1 || typeof parsed.committed !== "boolean" || !Array.isArray(parsed.changes) || parsed.changes.length > 100000) throw new Error("Invalid modpack journal")
    if (parsed.metadata && (typeof parsed.metadata.token !== "string" || !/^[a-zA-Z0-9_-]{1,128}$/.test(parsed.metadata.token))) throw new Error("Invalid modpack metadata token")
    if (parsed.metadata && !persistence) throw new Error("Modpack metadata recovery is unavailable")
    const seen = new Set<string>()
    for (const change of parsed.changes) {
      if (!change || typeof change.path !== "string" || change.before !== null && !isHash(change.before)
        || change.after !== null && !isHash(change.after)) throw new Error("Invalid modpack journal entry")
      checkName(change.path, change.path === MANIFEST)
      const name = change.path.normalize("NFC").toLowerCase()
      if (seen.has(name)) throw new Error("Duplicate modpack journal entry")
      seen.add(name)
      await safe(root, change.path, change.path === MANIFEST)
    }
    if (!parsed.committed) await rollback(root, transaction, parsed)
    else if (parsed.metadata) await persistence!.finalize(root, parsed.metadata.token)
  }
  // Без журнала stage ещё не изменял установленное содержимое.
  await fs.rm(transaction, { recursive: true, force: true })
}

/** Проверка опубликованных хешей до записи в staging, без изменения клиентов API. */
export async function writeModpackDownload(file: string, bytes: Buffer, hashes: { sha1?: string; sha512?: string; size?: number } = {}): Promise<void> {
  if (hashes.size !== undefined && (!Number.isSafeInteger(hashes.size) || hashes.size < 0 || bytes.length !== hashes.size)) throw new Error("Modpack file size mismatch")
  for (const algorithm of ["sha1", "sha512"] as const) {
    const expected = hashes[algorithm]
    if (expected !== undefined && (!new RegExp(`^[a-fA-F0-9]{${algorithm === "sha1" ? 40 : 128}}$`).test(expected)
      || createHash(algorithm).update(bytes).digest("hex") !== expected.toLowerCase())) throw new Error(`Modpack ${algorithm} mismatch`)
  }
  await fs.mkdir(path.dirname(file), { recursive: true })
  await fs.writeFile(file, bytes, { flag: "wx" })
}

export async function stageModpackInstall(directory: string, signal?: AbortSignal, beforeApply?: () => void) {
  await fs.mkdir(directory, { recursive: true })
  const root = await rootPath(directory)
  if (active.has(key(root))) throw new Error("Modpack installation is already running")
  active.add(key(root))
  const transaction = path.join(root, STATE, "transaction")
  const stage = path.join(transaction, "stage")
  let retain = false
  let closed = false
  let applied = false
  try {
    await recoverAtRoot(root)
    await fs.mkdir(stage, { recursive: true })
  } catch (error) { active.delete(key(root)); throw error }
  return {
    directory: stage,
    claimFile: createModpackPathClaims(),
    async apply<T>(validate: () => Promise<T>, metadata?: { buildId: string; fields: (result: T) => Record<string, unknown> }): Promise<T> {
      if (closed || applied) throw new Error("Modpack installation is already finished")
      applied = true
      signal?.throwIfAborted()
      const oldState = await readJson(await safe(root, MANIFEST, true)) as Managed | null
      if (oldState && (oldState.version !== 1 || !oldState.files || typeof oldState.files !== "object" || Array.isArray(oldState.files))) throw new Error("Invalid managed modpack manifest")
      const previous = oldState?.files ?? {}
       const previousByName = new Map<string, { name: string; hash: string }>()
      for (const [relative, hash] of Object.entries(previous)) {
        checkName(relative)
         const canonical = relative.normalize("NFC").toLowerCase()
         if (!isHash(hash) || previousByName.has(canonical)) throw new Error("Invalid managed modpack hash")
         previousByName.set(canonical, { name: relative, hash })
      }
      const next: Managed = { version: 1, files: Object.create(null) }
      const changes: Change[] = []
      const supplied = new Set<string>()
      const destinations = new Set<string>()
      const stagedFiles: string[] = []
      const walk = async (folder: string, prefix = "") => {
        for (const entry of await fs.readdir(folder, { withFileTypes: true })) {
          signal?.throwIfAborted()
          const relative = prefix + entry.name
          checkName(relative)
          const canonical = relative.normalize("NFC").toLowerCase()
          if (supplied.has(canonical)) throw new Error("Duplicate modpack file")
          supplied.add(canonical)
          if (supplied.size > 100000) throw new Error("Modpack file limit exceeded")
          if (entry.isSymbolicLink()) throw new Error("Modpack staging contains a link")
          if (entry.isDirectory()) { await walk(path.join(folder, entry.name), relative + "/"); continue }
          if (!entry.isFile()) throw new Error("Invalid staged file")
          stagedFiles.push(relative)
        }
      }
       await walk(stage)
       // Имя JAR меняется между релизами. Для известных управляемых disabled
       // файлов сопоставляем точные loader/modId, а не похожие имена/версии.
       const renamedDisabled = new Map<string, string>()
       const retiredDisabled = new Map<string, string>()
       const disabledFrom = new Map<string, string>()
       const candidates: Array<{ name: string; hash: string; owned: boolean; disabled: boolean; identities: string[] }> = []
       const installedMods = new Map<string, { name: string; disabled: boolean }>()
       const installedHashes = new Map<string, string | null>()
       let visitedMods = 0
       const findInstalledMods = async (directory: string, prefix: string) => {
         const stat = await fs.lstat(directory).catch(error => { if (absent(error)) return null; throw error })
         if (!stat?.isDirectory() || stat.isSymbolicLink()) return
         for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
           signal?.throwIfAborted()
           if (++visitedMods > 100000) throw new Error("Installed mod file limit exceeded")
           const relative = prefix + entry.name
           if (entry.isDirectory() && !entry.isSymbolicLink()) await findInstalledMods(path.join(directory, entry.name), relative + "/")
           else if (entry.isFile() && /\.jar(?:\.disabled)?$/i.test(entry.name)) {
             const canonical = relative.normalize("NFC").toLowerCase()
             if (installedMods.has(canonical)) throw new Error("Duplicate normalized installed mod path")
             installedMods.set(canonical, { name: relative, disabled: /\.disabled$/i.test(entry.name) })
           }
         }
       }
       // Один обход имён вместо lstat для каждого обычного enabled JAR.
       if (stagedFiles.some(relative => /^mods\/.*\.jar$/i.test(relative))) await findInstalledMods(path.join(root, "mods"), "mods/")
       let analyze: typeof import("@xnlc/parser").analyze | undefined
       const identities = async (file: string): Promise<string[]> => {
         analyze ??= (await import("@xnlc/parser")).analyze
         const parsed = await analyze(file, { signal, nested: false })
         if (parsed.diagnostics.length) return []
         return parsed.mods.filter(mod => typeof mod.id === "string" && mod.id.length > 0).map(mod => `${mod.loader}:${mod.id}`)
       }
       await inBatches([...installedMods], async ([canonical, entry]) => {
         signal?.throwIfAborted()
         const relative = entry.name
         const base = entry.disabled ? canonical.slice(0, -".disabled".length) : canonical
         // Для прежнего пути identity не нужна: существующая ветка сохраняет layout.
         if (supplied.has(base)) return
         const file = await safe(root, relative)
         const current = await digest(file, signal)
         installedHashes.set(relative, current)
         if (current === null) return
         const expected = previousByName.get(canonical)?.hash ?? previousByName.get(base)?.hash
         const owned = current === expected
         if (!entry.disabled && owned) return
         try { candidates.push({ name: relative, hash: current, owned, disabled: entry.disabled, identities: await identities(file) }) }
         catch (error) { signal?.throwIfAborted(); /* Неизвестные metadata не дают права удаления. */ }
       })
       const byIdentity = new Map<string, typeof candidates>()
       for (const candidate of candidates) for (const identity of candidate.identities) {
         const same = byIdentity.get(identity) ?? []
         same.push(candidate)
         byIdentity.set(identity, same)
       }
       if (byIdentity.size) {
         for (const relative of stagedFiles) {
           if (!/^mods\/.*\.jar$/i.test(relative)) continue
           signal?.throwIfAborted()
           let ids: string[]
           try { ids = await identities(path.join(stage, relative)) }
           catch (error) { signal?.throwIfAborted(); continue }
           const matches = [...new Set(ids.flatMap(id => byIdentity.get(id) ?? []))]
           if (!matches.length) continue
           const conflict = matches.find(candidate => !candidate.disabled)
           if (conflict) throw Object.assign(new Error("Unmanaged mod conflicts with the requested pack; installed files retained"), { code: "UNMANAGED_MOD_CONFLICT", file: conflict.name })
           const target = relative + ".disabled"
           const canonical = relative.normalize("NFC").toLowerCase()
           if (supplied.has(target.normalize("NFC").toLowerCase())) continue
           renamedDisabled.set(canonical, target)
           if (matches.length === 1 && matches[0].owned) {
             disabledFrom.set(canonical, matches[0].name)
             retiredDisabled.set(matches[0].name, matches[0].hash)
           }
         }
       }
       await inBatches(stagedFiles, async relative => {
        signal?.throwIfAborted()
         const canonical = relative.normalize("NFC").toLowerCase()
         let targetName = renamedDisabled.get(canonical) ?? previousByName.get(canonical)?.name ?? previousByName.get(canonical + ".disabled")?.name ?? relative
        // Выключенный файл не включается обратно при обновлении того же пути.
         if (/^(mods|resourcepacks|shaderpacks)\//i.test(relative) && !/\.disabled$/i.test(targetName)) {
           const disabled = await digest(await safe(root, targetName + ".disabled"))
          if (disabled !== null) targetName += ".disabled"
        }
         if (destinations.has(targetName.normalize("NFC").toLowerCase())) throw new Error("Duplicate modpack destination")
         destinations.add(targetName.normalize("NFC").toLowerCase())
        const target = await safe(root, targetName)
        const current = await digest(target, signal)
        const incoming = await digest(path.join(stage, relative), signal)
        if (!incoming) throw new Error("Staged modpack file disappeared")
         const expected = previousByName.get(canonical)?.hash ?? previousByName.get(targetName.normalize("NFC").toLowerCase())?.hash
        // Неизвестные legacy-файлы и изменённые overrides принадлежат пользователю.
         if (current !== null && (userData(targetName) || current !== expected && current !== incoming)) {
           const retired = disabledFrom.get(canonical)
           if (retired) retiredDisabled.delete(retired)
          if (expected) next.files[targetName] = expected
          return
        }
        next.files[targetName] = incoming
        if (current !== incoming) changes.push({ path: targetName, before: current, after: incoming, source: relative })
      })
       await inBatches(Object.entries(previous), async ([relative, expected]) => {
          if (destinations.has(relative.normalize("NFC").toLowerCase()) || userData(relative) || /\.disabled$/i.test(relative)) return
         const current = installedHashes.has(relative) ? installedHashes.get(relative)! : await digest(await safe(root, relative), signal)
        if (current === expected) changes.push({ path: relative, before: current, after: null })
       })
       for (const [relative, expected] of retiredDisabled) {
         signal?.throwIfAborted()
         if (destinations.has(relative.normalize("NFC").toLowerCase())) continue
         const current = installedHashes.has(relative) ? installedHashes.get(relative)! : await digest(await safe(root, relative), signal)
         if (current !== expected) throw new Error("Disabled mod changed during update")
         changes.push({ path: relative, before: current, after: null })
       }
      changes.sort((left, right) => left.path.localeCompare(right.path))
      next.files = Object.fromEntries(Object.entries(next.files).sort(([left], [right]) => left.localeCompare(right)))
      const nextManifest = path.join(transaction, "manifest.new")
      await fs.writeFile(nextManifest, JSON.stringify(next), { flag: "wx" })
      changes.push({ path: MANIFEST, before: await digest(await safe(root, MANIFEST, true)), after: await digest(nextManifest), source: undefined })
      const journal: Journal = { version: 1, committed: false, changes }
      beforeApply?.()
      signal?.throwIfAborted()
      if (metadata) {
        if (!persistence) throw new Error("Modpack metadata persistence is unavailable")
        const token = await persistence.begin(root, metadata.buildId)
        if (typeof token !== "string" || !/^[a-zA-Z0-9_-]{1,128}$/.test(token)) throw new Error("Invalid modpack metadata token")
        journal.metadata = { token }
      }
      // Один write-ahead журнал на операцию; файлы остаются на том же томе.
      try { await writeJson(path.join(transaction, "journal.json"), journal) }
      catch (error) {
        if (journal.metadata) {
          try { await persistence!.rollback(root, journal.metadata.token) }
          catch (rollbackError) { retain = true; throw new AggregateError([error, rollbackError], "Metadata preparation rollback failed; backup retained") }
        }
        throw error
      }
      retain = true
      applying.add(key(root))
      applying.add(key(directory))
      try {
        // На проверенном Windows параллельные rename оказались медленнее.
        // Переименования последовательны, подготовка хешей остаётся пакетной.
        for (const [index, change] of changes.slice(0, -1).entries()) {
          signal?.throwIfAborted()
          const target = await safe(root, change.path, change.path === MANIFEST)
          if (await digest(target) !== change.before) throw new Error("Local content changed during modpack installation")
          await fs.mkdir(path.dirname(target), { recursive: true })
          if (change.before !== null) await fs.rename(target, path.join(transaction, `${index}.old`))
          if (change.after !== null) await fs.rename(path.join(stage, change.source!), target)
        }
        const manifestChange = changes[changes.length - 1]
        const manifestPath = await safe(root, MANIFEST, true)
        if (await digest(manifestPath) !== manifestChange.before) throw new Error("Managed modpack manifest changed during installation")
        if (manifestChange.before !== null) await fs.rename(manifestPath, path.join(transaction, `${changes.length - 1}.old`))
        await fs.rename(nextManifest, manifestPath)
        signal?.throwIfAborted()
        const result = await validate()
        signal?.throwIfAborted()
        if (journal.metadata && metadata) await persistence!.write(root, journal.metadata.token, metadata.fields(result))
        signal?.throwIfAborted()
        journal.committed = true
        await writeJson(path.join(transaction, "journal.json"), journal)
        // Marker — точка commit обоих хранилищ. Ошибка очистки backup после него
        // не откатывает успешное обновление; startup recovery повторит finalize.
        try {
          if (journal.metadata) await persistence!.finalize(root, journal.metadata.token)
          retain = false
        } catch (error) { console.warn("[Modpack] Committed metadata cleanup deferred:", error) }
        return result
      } catch (error) {
        await rollback(root, transaction, journal)
        retain = false
        throw error
      } finally { applying.delete(key(root)); applying.delete(key(directory)) }
    },
    async close(): Promise<void> {
      if (closed) return
      closed = true
      try {
        if (!retain) await fs.rm(transaction, { recursive: true, force: true })
      } finally { active.delete(key(root)) }
    },
  }
}
