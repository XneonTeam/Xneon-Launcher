/**
 * Единый идентификатор приложения (reverse-DNS от нашего домена xneon.org).
 *
 * От него зависят AppUserModelID в Windows, каталог установки канала
 * `%LOCALAPPDATA%\org.xneon.launcher\<channel>` и ключ в «Установленные
 * приложения». Менять его на выпущенной версии нельзя: установленные копии
 * перестанут находить свои данные и ярлыки.
 *
 * Данные лаунчера лежат отдельно (`%APPDATA%\xneonlauncher`) и от этого
 * идентификатора не зависят.
 */
export const appIdentifier = "org.xneon.launcher"

/** Идентификатор portable-сборки: обновления и установка ей не нужны. */
export const portableAppIdentifier = "org.xneon.launcher.portable"
