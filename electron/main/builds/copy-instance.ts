import fs from "node:fs/promises"
import path from "node:path"

/** Копия становится доступной только после завершения переноса всех файлов. */
export async function copyInstanceDirectory(source: string, destination: string): Promise<void> {
  const from = await fs.realpath(source)
  // realpath разворачивает и junction, и короткие Windows-пути вида MAINER~1.
  const segments: string[] = []
  let ancestor = path.resolve(destination)
  let target: string
  for (;;) {
    try { target = path.join(await fs.realpath(ancestor), ...segments); break }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error
      const parent = path.dirname(ancestor)
      if (parent === ancestor) throw error
      segments.unshift(path.basename(ancestor)); ancestor = parent
    }
  }
  const relative = path.relative(from, target)
  if (!relative || (!relative.startsWith(".." + path.sep) && relative !== ".." && !path.isAbsolute(relative))) throw new Error("Cannot copy an instance into itself")
  if (!(await fs.stat(from)).isDirectory()) throw new Error("Source instance is not a directory")
  await fs.mkdir(path.dirname(target), { recursive: true })
  // Резервируем папку атомарно. Чужие существующие каталоги не изменяем.
  await fs.mkdir(target)
  try {
    for (const entry of await fs.readdir(from)) {
      if (entry === ".xnlc-share") continue
      await fs.cp(path.join(from, entry), path.join(target, entry), {
        recursive: true, dereference: true, force: false, errorOnExist: true,
      })
    }
  } catch (error) {
    // target — проверенный выше абсолютный каталог, созданный этой операцией.
    await fs.rm(target, { recursive: true, force: true }).catch(() => {})
    throw error
  }
}
