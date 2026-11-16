import { createInstance } from "i18next"
import ru from "../../src/i18n/locales/ru/translation.json"
import en from "../../src/i18n/locales/en/translation.json"
import uk from "../../src/i18n/locales/uk/translation.json"
import de from "../../src/i18n/locales/de/translation.json"
import es from "../../src/i18n/locales/es/translation.json"
import pl from "../../src/i18n/locales/pl/translation.json"

export type RuntimeTranslator = (key: string, values?: Record<string, string | number>) => string
const dictionaries: Record<string, Record<string, string>> = { ru, en, uk, de, es, pl }
const instances = new Map<string, Promise<RuntimeTranslator>>()

export function translatorForLocale(language: string): Promise<RuntimeTranslator> {
  const requested = language.toLowerCase().split(/[-_]/)[0]
  const locale = Object.hasOwn(dictionaries, requested) ? requested : "ru"
  let ready = instances.get(locale)
  if (!ready) {
    const instance = createInstance()
    ready = instance.init({ lng: locale, fallbackLng: "en", resources: {
      [locale]: { translation: dictionaries[locale] }, en: { translation: en },
    }, interpolation: { escapeValue: false } }).then(() => (key, values) => String(instance.t(key, values)))
    instances.set(locale, ready)
  }
  return ready
}

export async function getMainTranslator(): Promise<RuntimeTranslator> {
  const { dbHelpers } = await import("../db")
  const locale = await dbHelpers.getSetting("language").catch(() => undefined)
  return translatorForLocale(locale || "ru")
}
