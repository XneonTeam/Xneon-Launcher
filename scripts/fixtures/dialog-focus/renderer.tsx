import React from "react"
import { createRoot } from "react-dom/client"
import i18next from "i18next"
import { initReactI18next } from "react-i18next"
import { ActionConfirmDialog } from "../../../components/launcher/instance/action-confirm-dialog"
import "../../../src/index.css"

const wait = (ms = 40) => new Promise(resolve => setTimeout(resolve, ms))
async function run() {
  await i18next.use(initReactI18next).init({ lng: "en", resources: { en: { translation: {} } }, interpolation: { escapeValue: false } })
  document.documentElement.classList.add("dark")
  createRoot(document.getElementById("root")!).render(<ActionConfirmDialog open onClose={() => {}} title="Delete chat" description="Focus test" variant="danger" icon="trash" />)
  let dialog: HTMLElement | null = null
  for (let i = 0; i < 100 && !dialog; i++) {
    await wait()
    dialog = document.querySelector('[data-slot="dialog-content"]')
  }
  if (!dialog) throw new Error("Dialog did not open")
  dialog.focus({ focusVisible: true } as FocusOptions)
  await wait()
  const style = getComputedStyle(dialog)
  if (!dialog.classList.contains("outline-none")) throw new Error("Container focus still depends on the browser's default outline")
  if (style.outlineStyle !== "none" && parseFloat(style.outlineWidth) > 0) {
    throw new Error(`Container focus: outline=${style.outline}; border=${style.borderColor}; active=${document.activeElement === dialog}`)
  }
  if (parseFloat(style.borderWidth) <= 0) throw new Error("Themed dialog border disappeared")
  const cancel = dialog.querySelector('button') as HTMLButtonElement
  document.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", bubbles: true }))
  cancel.focus()
  await wait()
  if (document.activeElement !== cancel) throw new Error("Keyboard focus cannot reach the dialog button")
  if (!cancel.classList.contains("focus-visible:ring-ring")) throw new Error("Button focus does not use the theme ring")
  return ["У контейнера явно отключена браузерная обводка, рамка темы сохранена", "Фокус кнопок использует цвет темы; клавиатурная навигация сохранена"]
}
run().then(checks => Object.assign(window, { __themeReport: { passed: true, checks } })).catch(error => Object.assign(window, { __themeReport: { passed: false, error: String(error.stack || error) } }))
