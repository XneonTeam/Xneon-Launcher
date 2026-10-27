import fs from "fs/promises"
import path from "path"
import { dbHelpers } from "../db"
import { logRuntime, logRuntimeDebug } from "./runtime"

// ============================================================
// XNLC — Minecraft language sync
// Тумблер «ставить язык Minecraft по языку лаунчера».
//
// Язык в игре хранится в options.txt строкой `lang:<код>` (опция
// появилась в 1.1 — https://minecraft.wiki/w/Options.txt). Важные
// вехи формата кодов (https://minecraft.wiki/w/Language):
//   - до 1.11 (в т.ч. 1.6–1.10) файлы языков назывались en_US.lang,
//     поэтому в options.txt писался «смешанный» регистр: ru_RU;
//   - начиная с 16w32a (1.11) коды стали строчными: ru_ru;
//   - до 1.1 (Beta и старее) меню языков и самой опции lang не было.
// Остальное (переход на .json в 1.13, отвязка языков от версий в
// 1.19.3) на выбор локали не влияет — нас интересует только код.
// ============================================================

/** Коды Minecraft-локалей: современный (1.11+) и устаревший (до 1.11) регистр. */
const MC_LOCALES: Record<string, { modern: string; legacy: string }> = {
  ru: { modern: "ru_ru", legacy: "ru_RU" },
  en: { modern: "en_us", legacy: "en_US" },
  uk: { modern: "uk_ua", legacy: "uk_UA" },
  de: { modern: "de_de", legacy: "de_DE" },
  es: { modern: "es_es", legacy: "es_ES" },
  pl: { modern: "pl_pl", legacy: "pl_PL" },
}

/** Коды для подсказки в UI (та же карта, но в одном месте — см. дубль в settings-language-about.tsx). */
export function mcLocaleCodes(launcherLang: string): { modern: string; legacy: string } | null {
  const base = (launcherLang || "").toLowerCase().split(/[-_]/)[0]
  return MC_LOCALES[base] ?? null
}

/**
 * Определяет регистр кода локали для конкретной версии игры.
 *
 * @returns `true` — нужен устаревший регистр (ru_RU, версии до 1.11),
 *          `false` — строчный (ru_ru, 1.11 и новее),
 *          `null` — версия не поддерживает выбор языка (до 1.1) либо
 *                   не распознана: в таком случае файл не трогаем.
 */
function needsLegacyLocaleCase(mcVersion: string): boolean | null {
  const version = (mcVersion || "").trim()
  if (!version) return null

  // Идентификаторы старых сборок из манифеста: a1.2.6 (alpha), b1.7.3 (beta) —
  // меню языков появилось только в 1.1, писать lang в их options.txt бессмысленно.
  if (/^[ab]\d/i.test(version)) return null

  // Классические снапшоты YYwNNx (например 16w32a).
  const snapshot = /^(\d{2})w(\d{2})/i.exec(version)
  if (snapshot) {
    const year = Number(snapshot[1])
    const week = Number(snapshot[2])
    if (year < 12) return null // снапшоты до 1.1 (декабрь 2011 и раньше)
    if (year === 16) return week < 32 // 16w32a перевела коды в нижний регистр
    return year < 16 // 12w…15w — до 1.11, 17w… — после
  }

  // Релизы 1.x (в т.ч. пререлизы/кандидаты 1.12-pre7, 1.18-rc4),
  // а также новый формат YY.D(.H) с 2026 года (26.2, 26.2.1, 26.1-snapshot-1).
  const release = /^(\d+)\.(\d+)/.exec(version)
  if (release) {
    const major = Number(release[1])
    const minor = Number(release[2])
    if (major === 1) {
      if (minor < 1) return null // релиз 1.0 — опции lang ещё нет
      return minor < 11
    }
    return false // 26.x и новее — только строчный регистр
  }

  return null
}

/** Ставит `lang:<locale>` в текст options.txt, не трогая остальные строки. */
function withLangOption(content: string, locale: string): string {
  const line = `lang:${locale}`
  if (/^lang:[^\r\n]*$/m.test(content)) {
    return content.replace(/^lang:[^\r\n]*$/m, line)
  }
  if (content === "") return `${line}\n`
  const eol = content.includes("\r\n") ? "\r\n" : "\n"
  const body = content.replace(/\r?\n$/, "")
  return `${body}${eol}${line}${eol}`
}

/**
 * Если тумблер включён — выставляет язык игры по языку лаунчера.
 * Вызывается перед каждым запуском; ошибки не прерывают запуск.
 */
export async function syncMinecraftLanguage(gameDir: string, mcVersion: string): Promise<void> {
  try {
    if ((await dbHelpers.getSetting("autoGameLanguage")) !== "true") return

    const launcherLang = (await dbHelpers.getSetting("language")) || "ru"
    const codes = mcLocaleCodes(launcherLang)
    if (!codes) {
      logRuntimeDebug(`[Language] Unknown launcher language "${launcherLang}" — skipping game language sync`)
      return
    }

    const legacy = needsLegacyLocaleCase(mcVersion)
    if (legacy === null) {
      logRuntimeDebug(`[Language] Version ${mcVersion} has no language option — skipping`)
      return
    }
    const locale = legacy ? codes.legacy : codes.modern

    await fs.mkdir(gameDir, { recursive: true })
    const optionsPath = path.join(gameDir, "options.txt")

    let content = ""
    try {
      content = await fs.readFile(optionsPath, "utf8")
    } catch {
      // options.txt ещё не создан — игра сама дозапишет остальные настройки.
    }

    const next = withLangOption(content, locale)
    if (next === content) return

    await fs.writeFile(optionsPath, next, "utf8")
    logRuntime(`[Language] Set Minecraft language to ${locale} (${legacy ? "pre-1.11" : "1.11+"}) in ${optionsPath}`)
  } catch (error) {
    logRuntime(`[Language] Failed to sync game language: ${String(error)}`)
  }
}
