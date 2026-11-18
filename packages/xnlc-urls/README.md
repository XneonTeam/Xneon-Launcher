# @xnlc/urls

Общие адреса сервисов, используемые пакетами и лаунчером. Не зависит от main,
React или других XNLC-пакетов.

- `@xnlc/urls`: статические `SERVICE_URLS`, `AUTH_URLS`, `CONTENT_URLS`,
  `SERVER_URLS`, `AI_ENDPOINTS` и `curseforgeDownloadUrl`. Доступны в renderer.
- `@xnlc/urls/minecraft`: `URLS`, `rewriteMinecraftUrl`, `applyBmclapiEnv`.
  Core и Servers используют один реестр и одинаковые правила подмены источников.

## Источники Minecraft

`URLS` читает переменные при обращении, а не при импорте. Пустые значения
означают официальный источник; пробелы по краям и завершающие слэши удаляются.
Переопределения могут содержать путь, например `https://mirror.example/maven`.

Поддерживаются `XNLC_URL_` с суффиксами:

- `MOJANG_META`, `MOJANG_LIBRARIES`, `MOJANG_ASSETS`, `MOJANG_JAVA_RUNTIME`;
- `FABRIC_META`, `FABRIC_MAVEN`, `FORGE_MAVEN`, `NEOFORGE_MAVEN`;
- `PRISM_META`, `PRISM_FILES`, `FML_LIBRARIES`;
- `QUILT_META`, `QUILT_MAVEN_RELEASE`;
- `OPTIFINE_ROOT`, `AUTHLIB_INJECTOR_ROOT`, `AZUL_METADATA_API`.

`rewriteMinecraftUrl` изменяет только известные адреса Mojang и загрузчиков,
сохраняет query и не трогает сторонние CDN. Maven Fabric, Forge и Quilt имеют
собственные настройки, не перенаправляются по умолчанию на Mojang Libraries.

`applyBmclapiEnv()` меняет окружение текущего процесса и действует даже после
импорта Core. В лаунчере настройка BMCLAPI применяется в отдельном launch worker;
не следует включать её глобально в main на время одной конкурентной операции.

Адреса из окружения — доверенная конфигурация оператора. Ограничения загрузки
исполняемых файлов и политики CDN проверяются потребителями отдельно;
реестр не заменяет allowlist или проверку контрольной суммы.
