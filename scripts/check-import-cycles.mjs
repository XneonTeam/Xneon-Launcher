import fs from "node:fs"
import path from "node:path"

const root = process.cwd()
const files = []
const walk = directory => {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const file = path.join(directory, entry.name)
    if (entry.isDirectory()) walk(file)
    else if (/\.(?:ts|tsx|mts)$/.test(file) && !file.endsWith(".d.ts")) files.push(path.resolve(file))
  }
}
for (const directory of ["src", "lib", "components", "electrobun"]) walk(directory)
const workspaces = new Map()
for (const directory of fs.readdirSync("packages")) {
  const source = path.resolve("packages", directory, "src")
  if (!fs.existsSync(source) || !fs.existsSync(path.resolve("packages", directory, "package.json"))) continue
  walk(source)
  const manifest = JSON.parse(fs.readFileSync(path.resolve("packages", directory, "package.json"), "utf8"))
  workspaces.set(manifest.name, path.join(source, "index.ts"))
}
const fileSet = new Set(files)
const transpiler = new Bun.Transpiler({ loader: "tsx" })
function resolveImport(name, from) {
  if (workspaces.has(name)) return workspaces.get(name)
  const base = name.startsWith("@/") ? path.resolve(root, name.slice(2))
    : name.startsWith(".") ? path.resolve(path.dirname(from), name) : null
  if (!base) return null
  const stem = base.replace(/\.(?:js|jsx|mjs)$/, "")
  return [base, stem + ".ts", stem + ".tsx", stem + ".mts", path.join(base, "index.ts"), path.join(base, "index.tsx")]
    .find(candidate => fileSet.has(candidate))
}
const graph = new Map()
for (const file of files) {
  const targets = new Set()
  // Transpiler удаляет type-only импорты; динамические import()/require()
  // не являются статическими рёбрами графа и рассматриваются отдельно.
  for (const item of transpiler.scanImports(fs.readFileSync(file, "utf8"))) {
    if (item.kind !== "import-statement") continue
    const target = resolveImport(item.path, file)
    if (target && fileSet.has(path.resolve(target))) targets.add(path.resolve(target))
  }
  graph.set(file, targets)
}
let next = 0
const indices = new Map(), low = new Map(), stack = [], active = new Set(), cycles = []
function visit(file) {
  indices.set(file, next); low.set(file, next++)
  stack.push(file); active.add(file)
  for (const target of graph.get(file) ?? []) {
    if (!indices.has(target)) { visit(target); low.set(file, Math.min(low.get(file), low.get(target))) }
    else if (active.has(target)) low.set(file, Math.min(low.get(file), indices.get(target)))
  }
  if (indices.get(file) !== low.get(file)) return
  const members = []
  let target
  do { target = stack.pop(); active.delete(target); members.push(target) } while (target !== file)
  if (members.length > 1 || graph.get(file)?.has(file)) cycles.push(members.map(member => path.relative(root, member).replaceAll("\\", "/")).sort())
}
for (const file of files) if (!indices.has(file)) visit(file)
console.log(JSON.stringify({ files: files.length, cycles }, null, 2))
if (cycles.length) process.exitCode = 1
