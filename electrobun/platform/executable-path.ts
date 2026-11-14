import path from "node:path"
import { constants, accessSync, statSync } from "node:fs"

/** Все совпадения, в порядке PATH/PATHEXT; не выполняет найденные файлы. */
export function findExecutablesInPath(name: string, environment = process.env): string[] {
  const windows = process.platform === "win32"
  const extensions = windows && !path.extname(name)
    ? (environment.PATHEXT || ".COM;.EXE;.BAT;.CMD").split(";").filter(Boolean)
    : [""]
  const found: string[] = []
  const seen = new Set<string>()
  for (const entry of (environment.PATH ?? environment.Path ?? "").split(path.delimiter)) {
    const directory = entry.replace(/^"(.*)"$/, "$1")
    if (!directory) continue
    for (const extension of extensions) {
      const candidate = path.resolve(directory, name + extension)
      const key = windows ? candidate.toLowerCase() : candidate
      if (seen.has(key)) continue
      try {
        if (!statSync(candidate).isFile()) continue
        if (!windows) accessSync(candidate, constants.X_OK)
        seen.add(key)
        found.push(candidate)
      } catch { /* Отсутствующий/недоступный каталог PATH не прерывает поиск. */ }
    }
  }
  return found
}
