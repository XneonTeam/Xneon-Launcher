import i18n from "i18next"
import { initReactI18next } from "react-i18next"

// ru и en держим в статическом импорте: ru — язык по умолчанию, en — первый fallback
// гарантированный язык. Иначе при холодном старте с сохранённым, например, "de"
// в resources попадал только de, и fallbackLng: "ru" было нечем обслужить — i18next
// возвращал сам ключ вместо русского текста.
import enTranslation from "./locales/en/translation.json"
import ruTranslation from "./locales/ru/translation.json"

const stored = typeof window !== "undefined" ? localStorage.getItem("language") : null
const lang = stored || "ru"

const localeMap: Record<string, () => Promise<Record<string, string>>> = {
  ru: () => import("./locales/ru/translation.json").then(m => m.default || m),
  en: () => import("./locales/en/translation.json").then(m => m.default || m),
  uk: () => import("./locales/uk/translation.json").then(m => m.default || m),
  de: () => import("./locales/de/translation.json").then(m => m.default || m),
  es: () => import("./locales/es/translation.json").then(m => m.default || m),
}

let initPromise: Promise<void> | null = null

function initI18n(): Promise<void> {
  if (!initPromise) {
    initPromise = (async () => {
      // ru и en уже в памяти, остальные языки подтягиваются лениво.
      const resources: Record<string, { translation: Record<string, string> }> = {
        ru: { translation: ruTranslation },
        en: { translation: enTranslation },
      }

      if (lang !== "ru" && lang !== "en") {
        const translation = await (localeMap[lang] || localeMap.ru)()
        resources[lang] = { translation }
      }

      await i18n.use(initReactI18next).init({
        resources,
        lng: lang,
        fallbackLng: ["en", "ru"],
        interpolation: {
          escapeValue: false,
        },
      })
    })()
  }
  return initPromise
}

export { initI18n }

export async function changeLanguage(lng: string) {
  if (!i18n.hasResourceBundle(lng, "translation")) {
    const translation = await (localeMap[lng] || localeMap.ru)()
    i18n.addResourceBundle(lng, "translation", translation)
  }
  await i18n.changeLanguage(lng)
  if (typeof window !== "undefined") {
    localStorage.setItem("language", lng)
  }
}

export default i18n
