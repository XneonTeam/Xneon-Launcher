import { closeSync, lstatSync, openSync, readSync, readdirSync, realpathSync, statSync } from "node:fs"
import path from "node:path"

export function assertLinuxElf(file: string, machine = 62) {
  const fd = openSync(file, "r")
  try {
    const header = Buffer.alloc(64)
    if (readSync(fd, header, 0, header.length, 0) !== 64 || header.toString("hex", 0, 4) !== "7f454c46" || header[4] !== 2 || header[5] !== 1 || header.readUInt16LE(18) !== machine) throw new Error("Invalid Linux ELF architecture: " + file)
  } finally { closeSync(fd) }
}

/** Проверяется до загрузки native SDK: повреждённый CEF не должен включать GTK fallback. */
export function assertLinuxCefRuntime(bin: string, executable = "bun") {
  const root = realpathSync(bin)
  const inside = (file: string) => {
    const real = realpathSync(file)
    const relative = path.relative(root, real)
    if (relative.startsWith("..") || path.isAbsolute(relative)) throw new Error("CEF symlink escapes runtime: " + file)
    return real
  }
  const candidates = [path.join(root, "cef/libcef.so"), path.join(root, "libcef.so")].filter(file => { try { lstatSync(file); return true } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; return false } })
  if (!candidates.length) throw new Error("Bundled CEF is required; system WebView fallback is disabled")
  const targets = new Set(candidates.map(inside))
  if (targets.size !== 1) throw new Error("Conflicting bundled CEF libraries")
  const libcef = [...targets][0]
  assertLinuxElf(libcef)
  for (const name of ["icudtl.dat", "resources.pak", "chrome_100_percent.pak", "chrome_200_percent.pak", "v8_context_snapshot.bin"]) {
    const file = inside(path.join(root, name))
    if (!statSync(file).isFile() || statSync(file).size === 0) throw new Error("Missing CEF resource: " + name)
  }
  const locales = inside(path.join(root, "locales"))
  if (!readdirSync(locales).some(name => name.endsWith(".pak") && statSync(inside(path.join(locales, name))).size > 0)) throw new Error("CEF locales are missing")
  const helper = inside(path.join(root, executable + " Helper"))
  assertLinuxElf(helper)
  if (process.platform === "linux" && !(statSync(helper).mode & 0o111)) throw new Error("CEF helper is not executable")
  return { libcef, helper, resources: root }
}
