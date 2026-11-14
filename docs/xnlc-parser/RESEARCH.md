# XNLC Parser: исследование исходников

Дата: 14 ноября 2026. **Статус: исследование не завершено.** Это рабочий отчёт, а не подтверждение выполнения всех критериев задания.

| Источник | HEAD основной ветки | Версии |
|---|---|---|
| [modcrawl](https://github.com/SirCesarium/modcrawl/tree/f60c025214de2c7852da5352381d17e86d2be985) | `f60c025214de2c7852da5352381d17e86d2be985` | 0.14.0; lock: zipcrawl 4.0.1 |
| [x-minecraft-launcher](https://github.com/Voxelum/x-minecraft-launcher/tree/cca4b9a905664e2942e62f3a1b4cf341a82de966) | `cca4b9a905664e2942e62f3a1b4cf341a82de966` | `@xmcl/mod-parser` 3.4.3, `@xmcl/asm` 1.0.1, `@xmcl/system` 2.3.0 |
| [zipcrawl](https://github.com/SirCesarium/zipcrawl/tree/161da0a953cddb2932b552e62fe5f3edd14a8c1a) | `161da0a953cddb2932b552e62fe5f3edd14a8c1a` | 4.0.1 |

HEAD проверен через `git ls-remote`, код — в локальных shallow-копиях. Проверены ключевые пути registry, metadata, dependency, embedded, classfile и часть тестов modcrawl; `archive.rs` zipcrawl; публичные входы и Forge/Quilt/LiteLoader XMCL, `ClassReader`, `@xmcl/system`; код перечисленных ниже модулей лаунчера. Не проверены исчерпывающе все обработчики, тесты и транзитивные лицензии; не выполнены реальные тестовые векторы, benchmark и измерения памяти. Отсутствие упоминания функции ниже не доказывает её отсутствие во всём репозитории. Ранее исследованный архивный `minecraft-launcher-core-node` не использован вместо актуального XMCL: версия актуального mod-parser отличается (3.4.3 вместо 3.4.2).

## modcrawl и zipcrawl

`src/core/loaders/mod.rs::register_all`, `registry.rs::detect` выбирают первый совпавший sentinel: Paper перед Bukkit, NeoForge перед Forge, Fabric перед Quilt. `detect_archive` дополнительно читает `mods.toml` для распознавания NeoForge. Это быстро для простого определения, но скрывает вторую идентичность dual-loader JAR. JSON/TOML/YAML обрабатываются специализированными модулями `src/core/loaders/{fabric,quilt,forge_modern,forge_legacy,neoforge,bukkit,paper,bungee,velocity}`. Полнота всех полей не проверена.

`src/core/metadata/mod.rs::read_metadata_string` ограничивает распакованные метаданные 10 МиБ. `embedded.rs::visit_embedded` ограничивает вложенный JAR 128 МиБ, пропускает повреждённые и читает только один уровень; каждый вложенный архив собирается в `Vec`, после чего `ZipManager::from_reader` в изученном zipcrawl копирует поток ещё в один буфер. `dep/mod.rs::find_embedded_jars` ищет все имена `.jar`, а `is_bundled` сопоставляет ID по имени файла и версии-подобному суффиксу; `analyze_impl` удаляет совпавшую зависимость из отчёта. Возможны ложные совпадения, поэтому сведения о зависимости и вложенном архиве лучше сохранять отдельно.

В zipcrawl `archive.rs::new` открывает `zip::ZipArchive` поверх файла; библиотека `zip`, а не собственный декодер zipcrawl, обрабатывает архив. `entries` заново строит `Vec<ZipEntry>` и имена, `open_file` предоставляет `Read`, проверяет путь, размер до 1 ГиБ и целочисленное отношение распаковки к сжатию выше 100. `from_reader` читает весь поток в память. `Cargo.toml` modcrawl использует zipcrawl без default features; ZIP feature `deflate` и stored следует проверять на конкретных тестах, не приравнивая CLI zipcrawl с `full-zip` к конфигурации modcrawl. Проверки CRC/ZIP64 делегированы `zip`; их конкретные гарантии ещё не исследованы. Проверки metadata и вложенных JAR не заменяют общий лимит всех записей, суммарной распаковки и расхода CPU.

`classfile/mod.rs` применяет `java-class-rs`, ограничивает `.class` 32 МиБ; операции списка, поиска constant pool и mixin открывают архив отдельно. `extract_mixin_targets` ищет аннотации `@Mixin`, `group_mixin_overlaps` группирует цели между архивами; общая цель означает потенциальное пересечение, не доказанный конфликт. `classfile/dupes.rs::ClassIndex` индексирует пути `.class`, в том числе во вложенном JAR, не сравнивая байты классов. `side.rs` комбинирует явные данные и эвристики, включая секции mixin и содержимое; эвристический вывод не равен декларации автора. Тесты `tests/{identify,metadata,side,grep,analyze}_integration.rs` и модульные тесты существуют; полный запуск и покрытие не проверены. При нескольких отдельных API нельзя считать, что архив открывается или распаковывается только один раз.

## XMCL

`packages/mod-parser/index.ts` экспортирует отдельные функции, а не единый детектор. `fabric.ts::readFabricMod` и `quilt.ts::readQuiltMod` читают соответствующий JSON, удаляют BOM и возвращают исходную структуру; созданный ими filesystem закрывается в `finally`. Типы Quilt документируют `versions`, `unless`, `optional` и смысл альтернатив; само чтение JSON не разрешает граф и не проверяет семантику. `liteloader.ts::readLiteloaderMod` читает `litemod.json` и при отсутствии версии строит её из `mcversion:revision`.

`forge.ts::readForgeMod` последовательно вызывает JSON, manifest, TOML и ASM. `readForgeModJson` пробует `mcmod.info`, `cccmod.info`, `neimod.info` либо первый `.info`, подавляя ошибки JSON. `readForgeModManifest` читает tweak metadata; его разбиение по `:` и строкам не равно полному синтаксису manifest. `readForgeModToml` принимает имя файла, но полный `readForgeMod` вызывает его с `mods.toml` по умолчанию: автоматического чтения `neoforge.mods.toml` в этом вызове не обнаружено. Поддерживаются несколько `mods` и `${file.jarVersion}` из manifest. `readForgeModAsm` читает каждый `.class` через `walkFiles`, создаёт `ClassReader` и visitor; ошибка всего ASM-этапа в `readForgeMod` заменяется пустым результатом. `forge.test.ts`, `fabric.test.ts`, `liteloader.test.ts` присутствуют; отдельный тест Quilt в этом каталоге не обнаружен. Тесты не запускались.

`@xmcl/system/index.ts::openFileSystem` для файла открывает ZIP через `@xmcl/unzip`/`@xmcl/yauzl`, собирает записи в словарь; для каталога используется обычная FS. В ветке пути отфильтрованы `..`, а обработку буфера надо исследовать отдельно: в показанном коде этот фильтр к ней не применяется. На каждой отдельной операции с путём создаётся filesystem; передача уже открытого объекта позволяет переиспользовать его. Не следует считать объявления TypeScript runtime-валидацией JSON.

## ASM

`packages/asm/libs/ClassReader.ts` строит таблицу смещений constant pool и кэш строк, учитывает двойные слоты long/double, затем `accept` читает заголовок, интерфейсы, атрибуты, поля и методы и вызывает `ClassVisitor`, `FieldVisitor`, `MethodVisitor`, `AnnotationVisitor`. Есть разбор обоих атрибутов `RuntimeVisibleAnnotations` и `RuntimeInvisibleAnnotations`. Код включает разбор инструкций и других атрибутов, более широкий, чем необходим для извлечения class-level аннотаций. Полнота поддержки современных тегов и повреждённых class-файлов отдельно не проверена; например, у конструктора есть ветка default для неизвестных тегов, поэтому совместимость нельзя предположить.

`forge.ts::ModClassVisitor` извлекает Forge `@Mod`, `IFMLLoadingPlugin$MCVersion`, имена/флаги и эвристические константы, обрабатывает coremod/DummyModContainer и специальные случаи. Чтение всех классов масштабируется по сумме их распакованных размеров, создаёт буферы и объекты visitor; конкретная стоимость не измерена. Упрощённый parser сможет извлечь аннотации, но без анализа инструкций не гарантирует эквивалентность эвристикам DummyModContainer/OptiFine.

## Текущий лаунчер



Лаунчер получает метаданные, зависимости, требования загрузчиков и диагностику от `@xnlc/parser`. Контракт лаунчера передаёт обязательные зависимости как ID и строковый диапазон; структурированные условия сохраняются в API парсера. `content-resolver.ts` обрабатывает файлы группами, сопоставляет SHA-1 с ресурсами в БД и обогащает записи данными из каталогов.

Fingerprint CurseForge рассчитывает `@xnlc/parser`: MurmurHash2 с seed 1 по файлу после удаления байтов 09, 0A, 0D, 20. ZIP CRC является отдельной проверкой целостности.

## Сравнение и решения

Таблица фиксирует результаты исходного исследования. M — modcrawl, X — XMCL mod-parser, L — лаунчер на момент исследования. `?` означает, что проверка неполная. CPU/RAM — качественная оценка, не измерение.

| Возможность | M | X | L | Решение |
|---|---|---|---|---|
| ZIP | zipcrawl/zip, выборочная распаковка; новые списки при `entries` | system/unzip, индекс записей | `@xnlc/archives`, потоковая обработка на `fflate` | общий контекст, лимиты, независимый reader |
| Fabric/Quilt | loader handlers, первый sentinel | JSON и типы, без разрешения графа | UI-поля; Quilt schema 1 | IMPROVE: хранить обе идентичности и raw |
| Forge/NeoForge | TOML/legacy handlers | Forge TOML/JSON/ASM; NeoForge имя не вызывается автоматически | оба TOML, только первый mod | REIMPLEMENT: несколько mods, формат и raw отдельно |
| LiteLoader | отдельный handler не найден | `readLiteloaderMod` | `parseLiteModJson` | TAKE: сохранить поддержку и исходные поля |
| Bukkit/Paper/Bungee/Velocity | отдельные handlers | отдельного parser в mod-parser не найдено | в metadata не найдено | IMPROVE: независимые форматы, не терять Bungee/Velocity |
| Ресурсы/шейдеры | отдельного handler не найдено | вне mod-parser | ZIP и папки | TAKE: сохранить оба вида входа |
| Зависимости | нормализация, имя вложенного JAR как эвристика | оригинальные loader-specific данные | обязательные ID/range | IMPROVE: AST условий, источник, подтверждённое вложение |
| Side | `side.rs` декларации и эвристики | поля metadata, Forge ASM-флаги | требования загрузчика | IMPROVE: provenance и неизвестность |
| Классы/mixins | java-class-rs; полное чтение классов, лимит 32 МиБ | полный Forge ASM обход | ? | REIMPLEMENT: выборочный bounded parser; не обещать parity инструкций |
| Дубликаты | индекс имён, не байтов | не найдено в mod-parser | ? | IMPROVE: отдельное сравнение содержимого по запросу |
| Иконки | данные metadata; извлечение не подтверждено | путь в исходном JSON; извлечение не подтверждено | data URL | IMPROVE: bytes с лимитом, адаптер data URL |
| Hash | наличие не подтверждено | вне mod-parser | SHA-1 и CF | TAKE: сохранить совместимость; тестовые векторы |
| Ошибки | лимиты и ошибки, часть вложенных ошибок пропускается | Forge подавляет ошибку ASM/часть JSON | пустой результат | IMPROVE: частичный результат и диагностика |
| Batch | отдельные API/CLI, переоткрытие | вызывающий код | worker, БД и кэш | IMPROVE: ограниченный параллелизм и текущий контракт |
| Производительность | не измерена | не измерена | не измерена | NEW: сопоставимый benchmark и profiling |

Решения архитектуры, методика и незакрытые вопросы — в соседних документах. Для завершения аудита нужны пофайловая проверка всех handlers и тестов, лицензий lockfile, референсные векторы и проверка на реальных архивах.
