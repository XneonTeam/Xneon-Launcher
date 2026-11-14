# Исследование XNLC Parser — незавершённые заметки

**Устаревший источник XMCL:** эти заметки использовали архивный `minecraft-launcher-core-node`. Продолжение исследования актуального `x-minecraft-launcher` и новые SHA находятся в [xnlc-parser/RESEARCH.md](xnlc-parser/RESEARCH.md).

Это промежуточный документ, а не требуемый итоговый `RESEARCH.md`. Полный аудит,
реализация и измерения ещё не выполнены.

## Проверенные исходники

- [modcrawl](https://github.com/SirCesarium/modcrawl/tree/f60c025214de2c7852da5352381d17e86d2be985), commit `f60c025214de2c7852da5352381d17e86d2be985`, версия 0.14.0, MIT.
- [minecraft-launcher-core-node](https://github.com/Voxelum/minecraft-launcher-core-node/tree/154e2719b1ac962631d80ae4a280382f4f1ac09d), commit `154e2719b1ac962631d80ae4a280382f4f1ac09d`, `@xmcl/mod-parser` 3.4.2, MIT. Проверены HEAD обеих веток на момент исследования.

## Наблюдения по коду

- modcrawl: `src/core/registry.rs` выбирает первый зарегистрированный обработчик по наличию файла; для `mods.toml` есть дополнительная проверка NeoForge. Метаданные читаются ограниченно (10 МиБ, `src/core/metadata/mod.rs`). Отдельные публичные операции создают собственный `ZipManager`; нельзя предполагать, что несколько операций вместе делают один проход.
- modcrawl: `src/core/embedded.rs` последовательно раскрывает вложенные JAR в память, ограничивая каждый 128 МиБ и одним уровнем вложенности. `src/core/dep/mod.rs` определяет встроенную зависимость по имени файла и удаляет её из результата; это эвристика, а не проверка ID внутри вложенного JAR. Сохранение обеих сущностей с указанием уверенности предпочтительнее.
- XMCL: `packages/mod-parser/forge.ts` в `readForgeMod` вызывает JSON, manifest, TOML и затем `readForgeModAsm`; последний обходит и читает каждый `.class`, передавая его `ClassReader`. Ошибка ASM подавляется при полном разборе. Отдельный metadata-only режим имеет другой объём работы и не может честно сравниваться с полным Forge-анализом.
- XMCL: `readForgeModToml` поддерживает несколько записей `mods` и подстановку `${file.jarVersion}` из manifest. `readForgeModJson` читает `mcmod.info`, `cccmod.info`, `neimod.info` или первый `.info` с подавлением ошибок JSON. Manifest-парсер разбивает строку по двоеточию и не обрабатывает надлежащим образом продолжение строк.
- XMCL: `packages/mod-parser/quilt.ts` сохраняет Quilt-специфичные `unless`, альтернативы и `versions`; плоское представление зависимости без исходного выражения теряет семантику.
- XMCL использует `@xmcl/system` с `@xmcl/unzip`, `yauzl` и `jszip`, а для Forge — `@xmcl/asm` и `smol-toml`. Лицензии транзитивных зависимостей и заголовки файлов ASM ещё требуют отдельной проверки; MIT пакета не отменяет сохранения сторонних уведомлений при копировании.
- Текущий лаунчер: `electrobun/main/builds/jar-inspector.ts` совмещает вычисления и кэширует по размеру и времени изменения; `metadata.ts`, `jar-dependencies.ts`, `loader-requirements.ts` и `fingerprint.ts` остаются важными для проверки совместимости. Интеграция не менялась.

## CurseForge fingerprint

Формулировка задания о CRC отдельных записей противоречит действующему `electrobun/main/builds/fingerprint.ts`: там вычисляется MurmurHash2 с seed 1 по байтам **всего файла** после удаления байтов 09, 0a, 0d, 20. [Описание реализации CurseForge API client](https://github.com/aternosorg/php-curseforge-api#fingerprints) независимо подтверждает такой подход; [описание API](https://github.com/aternosorg/php-curseforge-api/blob/master/openapi.yaml) указывает Murmur2 с seed 1. Перед реализацией нужны тестовые векторы и сверка с реальным значением API. CRC ZIP служит проверке целостности записи и не должен подменять файловый fingerprint.

## Что ещё необходимо исследовать

Исходники и тесты zipcrawl, все обработчики metadata и зависимостей обеих библиотек, ASM и ограничения class/mixin анализа, лицензии зависимостей, набор реальных архивов и методику равного benchmark. Только после полного сравнительного отчёта допустимо приступать к реализации согласно заданному порядку.
