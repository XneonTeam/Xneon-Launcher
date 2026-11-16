import type { DownloadProgress, ensureServerJar } from "@xnlc/servers"
import type { McServerInfo } from "@xnlc/types"
import type { McServerRow } from "../db/mc-servers"
import type { RuntimeTranslator } from "./i18n"

type RuntimePreparation = {
  info: McServerInfo
  row: McServerRow
  directory: string
  token: { cancelled: boolean }
  t: RuntimeTranslator
  progress(progress: DownloadProgress): void
  console(line: string): void
  cancelled(): void
  globalJava(): Promise<string | undefined>
  java(version: string, report: (percent: number, required: number) => void, preferred?: string): Promise<{ path: string }>
  jar: typeof ensureServerJar
}

/** Подготовка JVM/JAR не знает про RPC; stop-token проверяется на каждой границе. */
export async function prepareServerRuntime(input: RuntimePreparation): Promise<{ javaPath: string; jarPath: string } | null> {
  const stopped = () => { if (!input.token.cancelled) return false; input.cancelled(); return true }
  if (stopped()) return null
  const sendProgress = (progress: DownloadProgress) => { if (!input.token.cancelled) input.progress(progress) }
  const sendConsole = (line: string) => { if (!input.token.cancelled) input.console(line) }
  const stored = input.row.javaPath && input.row.javaPath !== "auto" ? input.row.javaPath : undefined
  const preferred = stored ?? await input.globalJava()
  if (stopped()) return null
  let javaPath: string
  try {
    sendProgress({ phase: "downloading", message: input.t("runtime.server.javaChecking"), percent: 0 })
    const runtime = await input.java(input.info.gameVersion, (percent, required) => {
      sendProgress({ phase: "downloading", message: input.t("runtime.server.javaPreparing", { required }), percent })
    }, preferred)
    javaPath = runtime.path
  } catch (error) {
    if (stopped()) return null
    const message = input.t("runtime.server.javaError", { message: error instanceof Error ? error.message : String(error) })
    sendProgress({ phase: "error", message })
    throw new Error(message, { cause: error })
  }
  if (stopped()) return null
  let jarPath: string
  try {
    jarPath = await input.jar(input.directory, input.info.modloader, input.info.gameVersion, input.info.modloaderVersion,
      javaPath, sendProgress, input.row.customJar, sendConsole)
  } catch (error) {
    if (stopped()) return null
    const message = error instanceof Error ? error.message : String(error)
    sendProgress({ phase: "error", message: input.t("runtime.server.downloadError", { message }) })
    throw new Error(`Failed to download server JAR: ${message}`, { cause: error })
  }
  if (stopped()) return null
  return { javaPath, jarPath }
}
