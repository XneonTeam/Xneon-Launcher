# A25 — совместимость options.txt — FIXED

Только обычный запуск без buildName/buildId, в общем game root. Инстансы и внешние каталоги исключены. Подготовка до worker и syncMinecraftLanguage.

В .xneon-options сохраняются полные снимки по SHA-256 ID версии, unattributed-снимок первого файла, семейный снимок для первого возвращения, резервные копии по содержимому и журнал pending.json. Перед переключением сохраняется файл, записанный игрой. Возврат восстанавливает настройки конкретной версии, а не обращает конвертацию. Совместимый файл не переписывается. Запись через временный файл, fsync и rename; ошибки подготовки и старта восстанавливают исходник, незавершённый журнал восстанавливается при следующем запуске.

## Подтверждённые несовместимости

| Поля | Решение |
|---|---|
| lang | Регистр региона до/после 1.11 (16w32a); наличие перевода конкретного языка не гарантируется |
| key_key.* | Integer LWJGL2 и отрицательные mouse codes против key.keyboard/key.mouse; таблица Mojang OptionsKeyLwjgl3Fix, включая keypad/F1–F19. Scancode переносится только современным клиентам |
| viewDistance/renderDistance | В 1.1 индекс 0–3, в 1.7.2+ chunks. Разные единицы не аппроксимируются: defaults целевой игры |
| fpsLimit/maxFps | Старый индекс и FPS. Только одноимённые допустимые значения |
| ao | Boolean старого клиента, integer промежуточных, boolean новых. On/off; степень сохраняется в исходном снимке |
| clouds/renderClouds | Boolean до 1.8, false/fast/true позже. Fast старому клиенту передаётся как включённые облака |
| fancyGraphics/graphicsMode | Boolean и 0/1/2. В 26.3 разделены cutoutLeaves/weatherRadius/vignette/improvedTransparency; перенесены значения OptionsGraphicsModeSplitFix |
| music/sound | Категории soundCategory_music/master. Остальные категории хранятся в версионном снимке |
| fov | В файле нормализованное число, не экранные градусы; codec 1.21.10/26.3 проверен |
| version | DataVersion, не номер релиза. Для изученных 1.21.10/26.3 — 4556/5023 из официального version.json; предотвращает повторный старый DataFixer над преобразованными полями |

Неизвестные и удалённые параметры сохраняются в полном исходном снимке. Через неподтверждённую границу передаётся только проверенное подмножество. Нельзя безопасно угадать семантику произвольного mod-параметра.

## Источники

- [Minecraft Wiki Options.txt](https://minecraft.wiki/w/Options.txt_%28Java_Edition%29), [Key codes](https://minecraft.wiki/w/Key_codes), [Language](https://minecraft.wiki/w/Language). Полное чтение Wiki ограничено; использованы индексированные разделы и независимая проверка клиента.
- [Официальный manifest Mojang](https://piston-meta.mojang.com/mc/game/version_manifest_v2.json). Метаданные 1.1/1.7.2/1.8/1.21.10/26.3; javap официальных JAR 1.1, 1.21.10, 26.3, official mappings 1.21.10. SHA-1: 1.1 f690d4136b0026d452163538495b9b0e8513d718; 1.21.10 d3bdf582a7fa723ce199f3665588dcfe6bf9aca8; 26.3 e877b6a07acd633fb3bb475002175cec036e7b87.
- [GameSettings 1.8.9](https://github.com/Marcelektro/MavenMCP-1.8.9/blob/master/src/main/java/net/minecraft/client/settings/GameSettings.java): clouds, FOV, звук, integer bindings.
- [Официальные изменения 26.3](https://www.minecraft.net/en-us/article/minecraft-java-edition-26-3); сериализация сверена с Options и DataFixers клиента.

## Пределы приёмки A25 (исторический срез)
16 целевых тестов / 55 assertions GREEN, typecheck GREEN на Windows/Bun 1.4.4. Добавлены commit после started, журнал до подтверждения запуска, проверка повреждённого журнала, идемпотентный rollback, фактическое аварийное завершение subprocess и проверка порядка launch pipeline. Общий desktop до последних трёх тестов: 412 pass / 5 skip / 6 fail — четыре account-boundary (requireTestDatabaseStorage), два db-storage-boundary (несогласованные экспорты БД). Эти модули не изменялись в A25. Windows build завершился успешно; две последние проверки сохранённых профилей и журнала внесены после начала сборки и проверены отдельно typecheck/целевыми тестами, поэтому этот установщик не объявляется финальным A25-артефактом. Для сборки был остановлен прежний dev. JVM/GPU всех обязательных версий и Linux/macOS не проверены; каждый промежуточный релиз не исследован. Статус FIXED принят по согласованным критериям: файловые преобразования, сохранение снимков, атомарная запись, rollback и исключение инстансов. Реальные JVM/GPU-запуски и отдельные Linux/macOS-прогоны — дополнительные проверки и не блокируют закрытие A25. Snapshots/pre-release/custom ID не конвертируются; нет обещания универсальной совместимости модов. Rename/fsync зависят от ОС/ФС; внешние конкурирующие launcher не координируются.
