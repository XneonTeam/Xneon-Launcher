import fs from "node:fs"
import path from "node:path"
import vm from "node:vm"
import { transformSync } from "esbuild"
import type { ElectrobunConfig } from "electrobun"
import packageJson from "../../package.json"
import * as appIdentity from "../../electrobun/main/app-identity"
import * as appMeta from "../../lib/app-meta"
import * as updatePublicKeys from "../../electrobun/main/update-public-keys"

const root = path.resolve(import.meta.dir, "../..")

/**
 * Внутренние конфиги читаются из настоящих модулей проекта, поэтому тест
 * замечает изменение версии, имени, identity и адресов обновлений.
 */
const localModules: Readonly<Record<string, unknown>> = Object.freeze({
  "./package.json": packageJson,
  "./electrobun/main/app-identity": appIdentity,
  "./lib/app-meta": appMeta,
  "./electrobun/main/update-public-keys": updatePublicKeys,
})

export type ElectrobunConfigEnvironment = {
  platform?: NodeJS.Platform
  arch?: string
  env?: Record<string, string | undefined>
}

/**
 * Загружает electrobun.config.ts в изолированный vm-контекст. Подменяются
 * только платформа, архитектура и окружение; любая другая внешняя
 * зависимость считается ошибкой, а не поводом для заглушки.
 */
export function loadElectrobunConfig({
  platform = process.platform,
  arch = process.arch,
  env = {},
}: ElectrobunConfigEnvironment = {}): ElectrobunConfig {
  const source = fs.readFileSync(path.join(root, "electrobun.config.ts"), "utf8")
  const code = transformSync(source, { loader: "ts", format: "cjs" }).code
  const module = { exports: {} as { default?: ElectrobunConfig } }
  vm.runInNewContext(code, {
    module,
    exports: module.exports,
    process: { platform, arch, env },
    require: (name: string) => {
      if (Object.hasOwn(localModules, name)) return localModules[name]
      throw new Error(`Unexpected dependency: ${name}`)
    },
  })
  if (!module.exports.default) throw new Error("electrobun.config.ts did not export a config")
  return module.exports.default
}
