import "./settings-motion.css"

/** Явные кадры анимации не зависят от переменных анимаций диалогов и списков. */
export const SETTINGS_CONTENT_ENTER = "settings-content-enter"

/** У AI паузу даёт загрузка конфигурации; остальные вкладки выдерживают её через CSS. */
export const SETTINGS_CONTENT_ENTER_DELAYED = `${SETTINGS_CONTENT_ENTER} settings-content-enter-delayed`
