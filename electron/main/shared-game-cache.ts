import fs from "fs"
import path from "path"
import { createHash } from "crypto"
import { isDeepStrictEqual } from "util"

const RESOURCE_FOLDERS = ["versions", "libraries", "assets"] as const

/** Корень ресурсов задаётся main и наследуется процессом запуска. */
export function getMinecraftResourceRoot(): string {
  const root = process.env.XNLC_RESOURCE_DIR
  if (!root) throw new Error("Minecraft resource directory is not configured")
  return path.resolve(root)
}

function exists(file: string): boolean {
  try { fs.lstatSync(file); return true } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false
    throw error
  }
}

function sameFile(a: string, b: string): boolean {
  const hash = (file: string) => createHash("sha256").update(fs.readFileSync(file)).digest("hex")
  if (fs.statSync(a).size === fs.statSync(b).size && hash(a) === hash(b)) return true
  // Ядро дополняет Mojang JSON вычисляемым Maven-путём. Это тот же профиль,
  // даже если в старой копии поле path ещё не было записано.
  if (path.extname(a) !== ".json" || path.extname(b) !== ".json") return false
  try {
    const normalize = (file: string) => {
      const data = JSON.parse(fs.readFileSync(file, "utf8"))
      if (data?.id !== path.basename(file, ".json") || !Array.isArray(data.libraries)) return data
      for (const lib of data.libraries) {
        const artifact = lib.downloads?.artifact
        if (!artifact || artifact.path || typeof lib.name !== "string") continue
        const [coordinate, extension = "jar"] = lib.name.split("@")
        const [group, name, version, classifier] = coordinate.split(":")
        if (!group || !name || !version) continue
        artifact.path = `${group.replace(/\./g, "/")}/${name}/${version}/${name}-${version}${classifier ? `-${classifier}` : ""}.${extension}`
      }
      return data
    }
    return isDeepStrictEqual(normalize(a), normalize(b))
  } catch { return false }
}

/** Сначала проверяем всё дерево: конфликт не должен оставлять половину старой установки. */
function checkMerge(source: string, target: string): void {
  const sourceStat = fs.lstatSync(source)
  if (sourceStat.isSymbolicLink()) throw new Error(`Unexpected resource link: ${source}`)
  if (!exists(target)) return
  const targetStat = fs.lstatSync(target)
  if (targetStat.isSymbolicLink()) throw new Error(`Unexpected resource link: ${target}`)
  if (sourceStat.isDirectory() && targetStat.isDirectory()) {
    for (const name of fs.readdirSync(source)) checkMerge(path.join(source, name), path.join(target, name))
  } else if (!sourceStat.isFile() || !targetStat.isFile() || !sameFile(source, target)) {
    throw new Error(`Conflicting Minecraft resources: ${source} -> ${target}`)
  }
}

/** Перемещаем без повторного скачивания; одинаковые дубликаты удаляем только после сверки. */
function mergeTree(source: string, target: string): void {
  if (!exists(target)) {
    fs.mkdirSync(path.dirname(target), { recursive: true })
    fs.renameSync(source, target)
    return
  }
  if (fs.lstatSync(source).isDirectory()) {
    for (const name of fs.readdirSync(source)) mergeTree(path.join(source, name), path.join(target, name))
    fs.rmdirSync(source)
  } else {
    // Повторная проверка защищает от изменения файла после предварительной сверки.
    if (!sameFile(source, target)) throw new Error(`Resource changed during migration: ${source}`)
    fs.unlinkSync(source)
  }
}

/** Миграция выполняется один раз в main до создания обработчика и процессов запуска. */
export function initializeMinecraftStorageSync(dataRoot: string): void {
  const data = path.resolve(dataRoot)
  const root = path.join(data, "minecraft")
  fs.mkdirSync(root, { recursive: true })
  const legacy = path.resolve(process.env.XNEON_SHARED_MC_DIR ?? path.join(data, "shared-minecraft"))
  // Поддерживаем и прежний shared-minecraft, и ошибочно вынесенные в корень папки.
  for (const sourceRoot of new Set([legacy, data])) {
    if (sourceRoot === root || !exists(sourceRoot)) continue
    const folders = [...RESOURCE_FOLDERS, "runtime", "installers"]
    for (const folder of folders) {
      const source = path.join(sourceRoot, folder)
      const target = path.join(root, folder)
      const relativeTarget = path.relative(source, target)
      if (!relativeTarget.startsWith("..") && !path.isAbsolute(relativeTarget)) {
        throw new Error("Minecraft resource target cannot be inside its source")
      }
      if (exists(source)) checkMerge(source, target)
    }
    for (const folder of folders) {
      const source = path.join(sourceRoot, folder)
      if (exists(source)) mergeTree(source, path.join(root, folder))
    }
    // Корень лаунчера и неизвестные пользовательские файлы не удаляем.
    if (sourceRoot === legacy && sourceRoot !== data && fs.readdirSync(sourceRoot).length === 0) fs.rmdirSync(sourceRoot)
  }
  process.env.XNLC_RESOURCE_DIR = root
}

/** Инстанс всегда использует свои файлы. Старые управляемые ссылки заменяем независимыми копиями. */
export function prepareInstanceStorageSync(gameDir: string): string {
  const root = getMinecraftResourceRoot()
  const legacy = path.resolve(process.env.XNEON_SHARED_MC_DIR ?? path.join(path.dirname(root), "shared-minecraft"))
  fs.mkdirSync(gameDir, { recursive: true })
  for (const folder of RESOURCE_FOLDERS) {
    const link = path.join(gameDir, folder)
    if (!exists(link) || !fs.lstatSync(link).isSymbolicLink()) continue
    const target = path.resolve(path.dirname(link), fs.readlinkSync(link))
    if ([root, path.dirname(root), legacy].some(base => path.relative(path.join(base, folder), target) === "")) {
      const source = fs.existsSync(target) ? target : path.join(root, folder)
      // Копируем до снятия ссылки: ошибка копирования не лишает сборку исходных файлов.
      const temporary = fs.mkdtempSync(path.join(gameDir, "." + folder + "-migration-"))
      try {
        if (fs.existsSync(source)) fs.cpSync(source, temporary, { recursive: true, dereference: true })
        fs.unlinkSync(link)
        fs.renameSync(temporary, link)
      } catch (error) {
        if (!exists(link)) fs.symlinkSync(source, link, process.platform === "win32" ? "junction" : "dir")
        throw error
      } finally {
        if (exists(temporary)) fs.rmSync(temporary, { recursive: true, force: true })
      }
    }
  }
  return gameDir
}

/** Старые абсолютные пути из настроек и customVersionPath после переноса ресурсов. */
export function resolveMinecraftResourcePath(file: string | undefined, gameDir: string, resourceDir: string): string | undefined {
  if (!file || !path.isAbsolute(file) || fs.existsSync(file)) return file
  const root = getMinecraftResourceRoot()
  const legacy = process.env.XNEON_SHARED_MC_DIR ?? path.join(path.dirname(root), "shared-minecraft")
  for (const base of [gameDir, legacy, path.dirname(root)]) {
    const relative = path.relative(base, file)
    if (relative.startsWith("..") || path.isAbsolute(relative)) continue
    const [folder] = relative.split(path.sep)
    if (![...RESOURCE_FOLDERS, "runtime"].includes(folder)) continue
    const target = path.join(folder === "runtime" ? root : resourceDir, relative)
    if (fs.existsSync(target)) return target
  }
  return file
}
