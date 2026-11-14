# @xnlc/parser

Текущий статус: [готовность к эксплуатации](PRODUCTION_READINESS.md), [изменения API](CHANGELOG.md) и [поддержка форматов](SUPPORTED_FORMATS.md).

Версия 1.0.0 — библиотека для анализа архивов Minecraft.

Runtime — Bun 1.4.4 или новее; использование непосредственно из Node.js/Electron main не поддерживается. Пакет предоставляет основные `ParserWorker`, `ParserCache` и консервативный `assessDependency`. Установка, отмена, управление ресурсами и ограничения описаны в [руководстве по интеграции](INTEGRATION_GUIDE.md); приоритеты аудита — в [AUDIT.md](AUDIT.md).

`ArchiveContext.open(pathOrBytes, options)` индексирует ZIP, `entries()` и `get()` возвращают записи, `read(name, maxSize)` выборочно читает stored/deflate с проверкой CRC, `close()` закрывает контекст. Поддерживаются настраиваемые ограничения и `AbortSignal`. ZIP64, шифрование и другие методы сжатия отклоняются. Для DEFLATE используется потоковый совместимый API `node:zlib` в Bun с чанками 16 КиБ и проверкой лимита в процессе чтения; это не требует Node.js runtime. Набор проверок архивных бомб пока не исчерпывающий.

`identify` возвращает обнаруженные признаки форматов; `analyze` и `analyzeBatch` дают частичный разбор Fabric, Quilt, Forge/NeoForge TOML, `mcmod.info`/`cccmod.info`/`neimod.info`, LiteLoader, Velocity, Bukkit/Paper/Bungee и ресурспаков. Для YAML используются встроенные возможности Bun, anchors и aliases пока отклоняются. Сырые данные и Quilt-условия сохраняются; полное разрешение зависимостей не реализовано. `extractIcon` проверяет структуру и размеры PNG/JPEG/GIF/WebP без декодирования пикселей. `sha1` и `curseforgeFingerprint` принимают байты, не изменяя их; `sha1File` и `curseforgeFingerprintFile` читают файл потоком и поддерживают ограничение размера и отмену. Для fingerprint требуются два прохода по файлу.

Если Fabric/Quilt JSON не разбирается из-за буквальных LF внутри строк, выполняется повтор с удалением LF, как в XMCL. Корректный JSON читается без изменения; при таком восстановлении сохранённый объект отражает нормализованный текст.

```ts
import { ArchiveContext, analyze, analyzeBatch, extractIcon, identify } from "@xnlc/parser"

const result = await analyze("example.jar", { nested: true })
console.log(result.formats, result.mods, result.diagnostics)

const archive = await ArchiveContext.open("example.jar", {
  limits: { maxMetadataSize: 1024 * 1024 },
})
try {
  console.log(identify(archive))
  const icon = await extractIcon(archive, "assets/example/icon.png")
  console.log(icon?.mimeType)
} finally {
  archive.close()
}

const batch = await analyzeBatch(["a.jar", "b.jar"], { concurrency: 2 })
for (const item of batch) {
  if (item.status === "fulfilled") console.log(item.value.formats)
  else console.error(item.reason)
}
```

`ArchiveOptions` принимает `AbortSignal` и частичные лимиты; непереданные значения берутся из стандартных. Архивные ошибки выбрасываются как `ParserError` с кодом, ошибки отдельных metadata возвращаются в `diagnostics`. `analyzeBatch` сохраняет порядок входов и возвращает `PromiseSettledResult` для каждого файла. Для получения metadata и иконки из одного открытого архива доступны `analyzeOpen` и `extractIcon`.

Стандартные пределы: архив — 512 МиБ, центральный каталог — 16 МиБ, 100 000 записей, одна запись — 64 МиБ, общий объём распаковки — 256 МиБ, metadata — 2 МиБ, иконка — 4 МиБ. Для вложений: глубина 2, 64 архива, 32 МиБ на архив и 128 МиБ суммарно. Общий бюджет распаковки разделяется между родительским и вложенными архивами. Превышение лимита возвращает `LIMIT_EXCEEDED` или диагностику `NESTED_LIMIT_EXCEEDED` в зависимости от этапа.

CurseForge fingerprint сверяется с прежней реализацией лаунчера и независимым [тестовым вектором Aternos](https://github.com/aternosorg/php-curseforge-api/blob/25b57ad1ee35b554c44ed0ae0f43d460b28124c1/tests/Unit/Client/FingerprintHelperTest.php). Проверка реального fingerprint через API CurseForge пока не выполнена.

Типы NeoForge `required`, `optional`, `incompatible` и `discouraged` сохраняют различие между обязательным модом, необязательной интеграцией, запретом и предупреждением; неизвестный тип помечается `unknown`. Семантика типов проверена по [документации NeoForged](https://docs.neoforged.net/docs/gettingstarted/modfiles/).

Вложенные архивы, объявленные Fabric/Quilt, а также расположенные в `META-INF/jars` и `META-INF/jarjar`, обнаруживаются автоматически. Их ограниченный рекурсивный анализ включается параметром `nested: true`. Совпадения ID зависимости и вложенной metadata возвращаются в `matches`, а версия помечается `exact` только при равенстве строк; остальные диапазоны получают `unknown`. Это не означает, что все условия зависимости выполнены, и сама зависимость сохраняется в результате.

Пакет не зависит от кода конкретного лаунчера. Файловый `ArchiveContext` проверяет размер, mtime и ctime вокруг чтений; это не гарантирует обнаружение подмены с сохранением всех проверяемых атрибутов.

Для воспроизводимой проверки внешних архивов в каталоге пакета можно выполнить `XNLC_PARSER_LIVE_TESTS=1 bun run test:live` (в PowerShell сначала установить `$env:XNLC_PARSER_LIVE_TESTS='1'`). По зафиксированным SHA-1 через Modrinth проверяются Fabric, legacy и modern Forge, NeoForge, Quilt, Paper, ресурспак и шейдерпак; LiteLoader проверяется на зафиксированном fixture XMCL. Сетевые тесты не входят в обычный автономный набор `bun run test`.

`analyzeDirectory` поддерживает распакованные ресурспаки и шейдерпаки, не обходя дерево каталогов; иконка представлена путём, её чтение из папки не реализовано.

`analyzeDatapack(pathOrBytes)` анализирует ZIP-архив или распакованную папку: возвращает тип пака, пространства имён из `data/`, описание, `pack_format`, `supported_formats`, `min_format`, `max_format`, overlays и features. Исходный `pack.mcmeta` и диагностика сохраняются в результате. Значения диапазонов передаются как объявлены в metadata; API не вычисляет совместимость с конкретной версией Minecraft и не проверяет синтаксис отдельных функций, рецептов и других файлов датапака.

```ts
import { analyzeDatapack } from "@xnlc/parser"

const pack = await analyzeDatapack("world/datapacks/example.zip")
console.log(pack.format, pack.namespaces, pack.packFormat, pack.minFormat, pack.maxFormat)
```

Необязательные `parseClassFile` и `scanArchiveClasses` читают имена классов, интерфейсы и аннотации уровня класса, включая невидимые во время выполнения. `forgeModAnnotations` выделяет известные аннотации Forge. Сканирование имеет отдельные пределы числа и размера классов и сложности аннотаций; повреждённые классы возвращаются в `diagnostics`, а `complete` показывает полноту сканирования. Анализ инструкций и автоматическое извлечение metadata из классов пока не реализованы. Формат class-файла описан в [спецификации JVM](https://docs.oracle.com/javase/specs/jvms/se17/html/jvms-4.html).

Ещё не реализовано полное разрешение зависимостей. Предварительные измерения в исходном репозитории не доказывают преимущество над XMCL во всех сценариях. YAML metadata плагинов проверены только на одном реальном Paper JAR. Текущая версия проверена на Windows и Bun 1.4.4.

