import assert from "node:assert/strict"
import { lstat, readFile } from "node:fs/promises"
import path from "node:path"
import packageJson from "../../package.json"
import { appIdentifier } from "./app-identity"
import type { PackageChannel } from "./verified-update-feed"

/**
 * Идентичность установленной Windows-сборки. Windows-апдейтер больше не
 * спрашивает её у нативного ядра Electrobun (`Updater.getLocalInfo`): SDK
 * требует, чтобы `realpath(exeDir)\..\..` совпадал с
 * `%LOCALAPPDATA%\org.xneon.launcher`, а установщик ставит приложение в
 * `%LOCALAPPDATA%\Programs\xneon-launcher`. Поэтому поля читаются из
 * `Resources/version.json`, который Electrobun пишет при сборке.
 */
export type WindowsUpdateIdentity = {
  channel: PackageChannel
  version: string
  hash: string
  baseUrl: string
}

const MAX_IDENTITY_BYTES = 64 * 1024

/**
 * `null` — не упакованная Windows-сборка (dev или portable): обновления ей
 * недоступны. Повреждённый или чужой `version.json` — ошибка `unsupported-package`.
 */
export async function readWindowsUpdateIdentity(): Promise<WindowsUpdateIdentity | null> {
  const file = path.resolve(path.dirname(process.execPath), "../Resources/version.json")
  let info
  try {
    info = await lstat(file)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null
    throw error
  }
  assert.ok(info.isFile() && info.size > 0 && info.size <= MAX_IDENTITY_BYTES, "unsupported-package")

  let local: Record<string, unknown>
  try {
    local = JSON.parse(await readFile(file, "utf8"))
  } catch {
    throw new Error("unsupported-package")
  }
  assert.ok(local && typeof local === "object" &&
    local.identifier === appIdentifier && local.version === packageJson.version &&
    typeof local.hash === "string" && /^[a-z0-9]{1,64}$/.test(local.hash) &&
    (local.channel === "stable" || local.channel === "canary") &&
    typeof local.baseUrl === "string", "unsupported-package")

  return { channel: local.channel as PackageChannel, version: local.version as string, hash: local.hash, baseUrl: local.baseUrl }
}