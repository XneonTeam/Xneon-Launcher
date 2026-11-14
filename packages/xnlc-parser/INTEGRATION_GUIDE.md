# Подключение `@xnlc/parser`

В текущем API `analyzeOpen` учитывает и сигнал контекста, и сигнал операции: отмена любого прерывает чтение. `ParserWorker(maxPending, timeoutMs)` ограничивает время с постановки в очередь (30 секунд по умолчанию). `ParserCache(maxEntries, maxBytes)` объединяет параллельные одинаковые запросы и ограничивает оценочный вес кэша; отмена подписчика не отменяет остальных.

Руководство для версии 1.0.0. Примеры проверены на Bun 1.4.4. Текущая реализация использует `Bun.file`, `Bun.hash`, `Bun.TOML`, `Bun.YAML` и `Bun.CryptoHasher`: **в обычном Node.js и Electron main она не работает**. Для Electron запускайте пакет в отдельном процессе Bun и передавайте данные в main через контролируемый IPC. Не импортируйте его непосредственно в renderer или preload.

Установите опубликованный пакет `bun add @xnlc/parser`, либо до публикации соберите архив `npm pack` и установите его в изолированный проект командой `bun add <путь-к-tgz>`. Поддержка реестра зависит от настроек вашего проекта; включение в конкретный лаунчер выполняется отдельным изменением.

```ts
import { analyze, analyzeBatch, ArchiveContext, ParserError, assessDependency } from "@xnlc/parser"

const controller = new AbortController()
try {
  const result = await analyze("/path/to/mod.jar", { signal: controller.signal, nested: true })
  for (const mod of result.mods) console.log(mod.id, mod.name, mod.version)
  for (const dependency of result.dependencies) {
    // complete=true допустим только при полном перечне модов и системных зависимостей.
    const assessment = assessDependency(dependency, { mods: [], complete: false })
    console.log(dependency.id, assessment.status) // unknown при неполном перечне
  }
  for (const diagnostic of result.diagnostics) console.warn(diagnostic.code, diagnostic.source)
} catch (error) {
  if (error instanceof ParserError && error.code === "ABORTED") console.log("Отменено")
  else throw error
}

const batch = await analyzeBatch(["/path/a.jar", "/path/b.jar"], { concurrency: 2 })
for (const item of batch) {
  if (item.status === "fulfilled") console.log(item.value.formats)
  else console.error(item.reason)
}
```

Для выборочного чтения и повторного использования индекса:

```ts
import { ArchiveContext, analyzeOpen, extractIcon } from "@xnlc/parser"

const archive = await ArchiveContext.open("/path/to/mod.jar", {
  limits: { maxMetadataSize: 1024 * 1024 },
})
try {
  const entries = archive.entries()
  const info = await analyzeOpen(archive)
  const icon = await extractIcon(archive, "assets/example/icon.png")
  console.log(entries.length, info.mods, icon?.mimeType)
} finally {
  archive.close()
}
```

`close()` делает контекст непригодным к дальнейшему использованию. Входной `Uint8Array` не копируется: не изменяйте его до окончания работы. Лимиты задаются при открытии, затем `archive.limits` неизменяем. Чтение резервирует общий бюджет распаковки, включая параллельные и вложенные архивы; успешные повторные чтения также расходуют бюджет. Передавайте `AbortSignal` в `open` или `analyze` и вызывайте `abort()` при отмене. Структурные ошибки передаются через `ParserError.code`; ошибки отдельных metadata присутствуют в `diagnostics`, поэтому успешное завершение не означает полный результат. `completeness` и необработанные значения нужно учитывать при принятии решений.

Для пакетной обработки используйте `runScanWorker(files, request, onResult, signal)`. Большие списки делятся между потоками, результаты приходят порциями. Поля запроса позволяют выбрать метаданные, зависимости, требования загрузчика, SHA-1, отпечаток CurseForge или анализ датапака. Перед удалением файла вызовите `pauseScanFiles(paths, remove)`: функция дождётся освобождения выбранных файлов и не позволит потоку снова открыть их до окончания удаления. В собранном приложении путь к отдельной точке входа указывается через `setScanWorkerEntry`; при обычном импорте пакета worker запускается из его каталога.

Для получения требований из готовых метаданных используйте `getLoaderRequirements(result.mods)`, для сравнения версий — `satisfiesLoaderRequirement(version, requirement)`.

Для отдельных полных разборов доступен `ParserWorker`. Он обрабатывает ограниченную очередь последовательно; `close()` обязателен:

```ts
import { ParserWorker } from "@xnlc/parser"

const worker = new ParserWorker(8) // максимум задач, включая активную
const controller = new AbortController()
try {
  const result = await worker.analyze("/path/to/mod.jar", { signal: controller.signal })
  console.log(result.mods)
} finally {
  await worker.close()
}
```

Для межпроцессного обмена выбирайте явный сериализуемый протокол, ограничивайте очередь и проверяйте пути на стороне приложения. Работайте с файлами внутри доверенных каталогов. При уничтожении процесса корректно отклоняйте ожидающие запросы. Результаты class parser могут содержать `bigint`; JSON без преобразования такие значения не сериализует.

Необязательный `ParserCache` ограничен числом и приблизительным весом записей и проверяет путь, размер, mtime и ctime до использования. Он не является постоянным кэшем и не доказывает неизменность файла при подмене атрибутов. Результат копируется для защиты от изменения вызывающей стороной. Для кэша между запусками приложение должно учитывать версию своего формата, параметры анализа и надёжный отпечаток файла.

```ts
import { ParserCache } from "@xnlc/parser"

const cache = new ParserCache(64)
const info = await cache.analyze("/path/to/mod.jar")
console.log(cache.stats) // hits / misses с момента создания кэша
cache.invalidate("/path/to/mod.jar")
cache.clear()
```

Публичные экспорты версии 1.0.0 описаны в этом руководстве. `assessDependency` намеренно не разрешает диапазоны, альтернативы, `unless`, стороны и граф: в этих случаях возвращается `unknown`, а не ложное подтверждение. См. [ограничения](LIMITATIONS.md) и [аудит](AUDIT.md); измерения хранятся в исходном репозитории.

