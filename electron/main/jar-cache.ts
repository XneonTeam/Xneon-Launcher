// ============================================================
// XNLC — кэш скачанных jar-файлов
// Author: MAINER4IK
// ============================================================
//
// Мод, который мы анализируем перед установкой, скачивается целиком. Второй раз
// тянуть те же байты при самой установке незачем, поэтому файл кладём в кэш по
// хэшу URL и оттуда же потом забираем при сохранении в сборку.

import crypto from "crypto"
import fs from "fs/promises"
import os from "os"
import path from "path"

/** Кэш живёт три дня: этого хватает, чтобы не копить мусор, и не мешает обновлениям. */
const JAR_CACHE_MAX_AGE_MS = 3 * 24 * 60 * 60 * 1000

function getJarCacheDir(): string {
  return path.join(os.tmpdir(), "xneon-jar-cache")
}

function getJarCacheFile(url: string): string {
  const key = crypto.createHash("sha1").update(url).digest("hex")
  return path.join(getJarCacheDir(), `${key}.jar`)
}

/** Путь к уже скачанному файлу, если он есть в кэше и ещё не устарел. */
export async function getCachedJarPath(url: string): Promise<string | null> {
  const file = getJarCacheFile(url)
  try {
    const stat = await fs.stat(file)
    if (stat.size > 0 && Date.now() - stat.mtimeMs < JAR_CACHE_MAX_AGE_MS) {
      return file
    }
  } catch {
    // Файла нет — обычная ситуация, скачаем.
  }
  return null
}

/** Скачивает jar в кэш и возвращает путь. Загрузчик передаёт вызывающий код. */
export async function cacheJarFromUrl(
  url: string,
  download: (url: string) => Promise<Buffer>,
): Promise<string | null> {
  const cached = await getCachedJarPath(url)
  if (cached) return cached

  try {
    const dir = getJarCacheDir()
    await fs.mkdir(dir, { recursive: true })
    const file = getJarCacheFile(url)
    await fs.writeFile(file, await download(url))
    return file
  } catch (error) {
    console.warn("[jar-cache] не удалось скачать файл для анализа:", error)
    return null
  }
}
