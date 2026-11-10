import { readdirSync } from "node:fs"
import path from "node:path"
import { build } from "esbuild"

const root = "electrobun"
await build({
  entryPoints: readdirSync(root, { recursive: true }).filter(file => file.endsWith(".ts") && !file.endsWith(".d.ts"))
    .map(file => path.join(root, file)),
  outbase: root,
  outdir: "dist-electrobun-tests",
  platform: "node",
  format: "cjs",
  logLevel: "warning",
})
