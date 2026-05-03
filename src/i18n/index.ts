import i18n from "i18next"
import { initReactI18next } from "react-i18next"
import translationRU from "./locales/ru/translation.json"
import translationEN from "./locales/en/translation.json"
import translationUK from "./locales/uk/translation.json"
import translationDE from "./locales/de/translation.json"
import translationES from "./locales/es/translation.json"

const resources = {
  ru: { translation: translationRU },
  en: { translation: translationEN },
  uk: { translation: translationUK },
  de: { translation: translationDE },
  es: { translation: translationES },
}

const stored = typeof window !== "undefined" ? localStorage.getItem("language") : null
const lang = stored || "ru"

i18n.use(initReactI18next).init({
  resources,
  lng: lang,
  fallbackLng: "ru",
  interpolation: {
    escapeValue: false,
  },
})

export function changeLanguage(lng: string) {
  i18n.changeLanguage(lng)
  if (typeof window !== "undefined") {
    localStorage.setItem("language", lng)
  }
}

export default i18n
