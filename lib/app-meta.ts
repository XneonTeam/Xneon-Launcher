import packageJson from "../package.json"

/**
 * Отображаемое имя продукта — единственный источник для title окна, NSIS,
 * VERSIONINFO и Linux-пакетов. Технические имена (`XneonLauncher`,
 * `xneon-launcher`, `org.xneon.launcher`) от него не зависят.
 */
export const APP_NAME = "Xneon Launcher"
export const APP_VERSION = packageJson.version
export const APP_USER_AGENT = `Xneon-Launcher/${APP_VERSION}`
