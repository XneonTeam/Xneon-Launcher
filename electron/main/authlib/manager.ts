// ============================================================
// XNLC — AuthlibInjectorManager
// Java agent для запуска с аккаунтом Authlib-Injector.
// Скачивание/кэш JAR делегируется существующему
// ensureAuthlibInjector() из @xnlc/core (он же используется
// настройкой «Скины authlib-injector») — второй downloader
// НЕ создаётся. Менеджер только гарантирует наличие файла,
// отдаёт путь и собирает launch-аргументы.
// ============================================================

import path from "node:path"
import type { AuthlibInjectorServer } from "@xnlc/types" with { "resolution-mode": "import" }
import { AuthServerConnectionError, AuthlibError } from "./errors"
import { fetchMetadata } from "./server"
import type { AuthlibInjectorMetadata } from "@xnlc/types" with { "resolution-mode": "import" }

export class AuthlibInjectorManager {
  /** Директория, в которой лежит authlib-injector.jar (gameDir инстанса). */
  private readonly gameDir: string

  constructor(gameDir: string) {
    this.gameDir = gameDir
  }

  /** Ожидаемый путь к JAR (без скачивания). */
  getInjectorPath(): string {
    return path.join(this.gameDir, "authlib-injector.jar")
  }

  /**
   * Гарантирует, что JAR скачан и валиден (сигнатуру и атомарную запись
   * проверяет @xnlc/core). Возвращает путь.
   *
   * Версии здесь нет намеренно: всегда скачивается «latest», поэтому
   * локальная константа версии (раньше v1.2.8) только вводила в заблуждение.
   */
  async ensureInjectorAvailable(signal?: AbortSignal): Promise<string> {
    try {
      const { ensureAuthlibInjector } = await import("@xnlc/core")
      const jarPath: string = await ensureAuthlibInjector(this.gameDir, signal)
      return jarPath
    } catch (error) {
      throw new AuthlibError(
        "connection",
        `Failed to prepare authlib-injector: ${error instanceof Error ? error.message : String(error)}`,
      )
    }
  }

  /**
   * Аргументы JVM для запуска:
   *   -javaagent:<jar>=<serverUrl>
   *   -Dauthlibinjector.side=client
   *   -Dauthlibinjector.yggdrasil.prefetched=<base64 metadata>
   *
   * Prefetched передаётся как одно значение аргумента — воркер склеивает
   * argv массивом (не строкой), поэтому спецсимволы безопасны.
   */
  async getLaunchArguments(
    server: Pick<AuthlibInjectorServer, "url">,
    metadata?: AuthlibInjectorMetadata | null,
    signal?: AbortSignal,
  ): Promise<{ injectorPath: string; serverUrl: string; prefetched?: string }> {
    const injectorPath = await this.ensureInjectorAvailable(signal)

    // Метаданные для prefetched: стараемся взять свежие, иначе кэш,
    // иначе вообще без prefetched (инжектор сам подтянет при старте).
    let effectiveMetadata = metadata ?? null
    if (!effectiveMetadata) {
      effectiveMetadata = await fetchMetadata(server.url, { allowCached: true, signal })
    }

    const prefetched = effectiveMetadata
      ? Buffer.from(JSON.stringify(effectiveMetadata), "utf8").toString("base64")
      : undefined

    return { injectorPath, serverUrl: server.url, prefetched }
  }
}

/**
 * Собирает аргументы для воркера запуска (worker получает готовую структуру).
 * Ошибка вместо null: запуск падает с понятной причиной, а не молча уходит
 * без инжектора.
 */
export async function buildWorkerAuthlibPayload(
  gameDir: string,
  server: AuthlibInjectorServer,
  metadata?: AuthlibInjectorMetadata | null,
  signal?: AbortSignal,
): Promise<{ injectorPath: string; serverUrl: string; prefetchedMetadata?: string }> {
  const manager = new AuthlibInjectorManager(gameDir)
  try {
    const args = await manager.getLaunchArguments(server, metadata, signal)
    return {
      injectorPath: args.injectorPath,
      serverUrl: args.serverUrl,
      ...(args.prefetched ? { prefetchedMetadata: args.prefetched } : {}),
    }
  } catch (error) {
    if (error instanceof AuthlibError) throw error
    throw new AuthServerConnectionError(
      `Failed to prepare authlib-injector: ${error instanceof Error ? error.message : String(error)}`,
    )
  }
}
