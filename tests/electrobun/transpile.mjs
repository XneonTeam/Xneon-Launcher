import { transformSync } from "esbuild"

export function stripTypeScriptTypes(source) {
  return transformSync(source, { loader: "ts" }).code
}
