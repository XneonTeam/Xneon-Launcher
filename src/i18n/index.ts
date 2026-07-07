import i18n from "i18next"
import { initReactI18next } from "react-i18next"

const stored = typeof window !== "undefined" ? localStorage.getItem("language") : null
const lang = stored || "ru"

const localeMap: Record<string, () => Promise<Record<string, string>>> = {
  ru: () => import("./locales/ru/translation.json").then(m => m.default || m),
  en: () => import("./locales/en/translation.json").then(m => m.default || m),
  uk: () => import("./locales/uk/translation.json").then(m => m.default || m),
  de: () => import("./locales/de/translation.json").then(m => m.default || m),
  es: () => import("./locales/es/translation.json").then(m => m.default || m),
}

async function initI18n() {
  const translation = await (localeMap[lang] || localeMap.ru)()

  await i18n.use(initReactI18next).init({
    resources: {
      [lang]: { translation },
    },
    lng: lang,
    fallbackLng: "ru",
    interpolation: {
      escapeValue: false,
    },
  })
}

initI18n()

export async function changeLanguage(lng: string) {
  const translation = await (localeMap[lng] || localeMap.ru)()
  i18n.addResourceBundle(lng, "translation", translation)
  await i18n.changeLanguage(lng)
  if (typeof window !== "undefined") {
    localStorage.setItem("language", lng)
  }
}

export default i18n
