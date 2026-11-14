import fs from "node:fs"
import path from "node:path"
import { gzipSync } from "node:zlib"

const root = path.resolve(process.argv[2] ?? "dist")
const manifest = JSON.parse(fs.readFileSync(path.join(root, ".vite/manifest.json"), "utf8"))
const collect = keys => {
  const visited = new Set()
  const visit = key => {
    if (visited.has(key)) return
    visited.add(key)
    for (const dependency of manifest[key]?.imports ?? []) visit(dependency)
  }
  keys.forEach(visit)
  return [...visited].map(key => manifest[key]).filter(Boolean)
}
const summarize = chunks => {
  const files = [...new Set(chunks.map(chunk => chunk.file).filter(file => file.endsWith(".js")))]
  let bytes = 0, gzip = 0
  for (const file of files) {
    const data = fs.readFileSync(path.join(root, file))
    bytes += data.length
    gzip += gzipSync(data).length
  }
  return { files: files.length, bytes, gzip }
}
const entry = Object.keys(manifest).find(key => manifest[key].isEntry)
const startup = [entry, "src/App.tsx", "src/i18n/index.ts"].filter(key => manifest[key])
console.log(JSON.stringify({
  entry: summarize(collect([entry])),
  startup: summarize(collect(startup)),
  allJavaScript: summarize(Object.values(manifest)),
  skinviewInStartup: collect(startup).some(chunk => chunk.file.includes("skinview")),
  cssBytes: fs.readdirSync(path.join(root, "assets")).filter(file => file.endsWith(".css"))
    .reduce((total, file) => total + fs.statSync(path.join(root, "assets", file)).size, 0),
}, null, 2))
