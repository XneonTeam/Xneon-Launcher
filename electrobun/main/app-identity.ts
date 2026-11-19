/**
 * Единый идентификатор приложения (reverse-DNS от нашего домена xneon.org).
 *
 * От него зависят AppUserModelID в Windows, каталог управляемых обновлений
 * `%LOCALAPPDATA%\org.xneon.launcher\<channel>`, ключ в «Установленные
 * приложения» и поле `identifier` в подписанных манифестах обновлений.
 * Менять его на выпущенной версии нельзя: установленные копии перестанут
 * принимать новые манифесты и обновления.
 *
 * Данные лаунчера лежат отдельно (`%APPDATA%\xneonlauncher`) и от этого
 * идентификатора не зависят.
 */
export const appIdentifier = "org.xneon.launcher"

/** Идентификатор portable-сборки: обновления и установка ей не нужны. */
export const portableAppIdentifier = "org.xneon.launcher.portable"
