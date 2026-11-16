# Форматы

| Формат | Извлекаемые сведения и ограничения | Проверки |
|---|---|---|
| Fabric, Quilt | ID, версия, имя, авторы, описание, декларации и вложения. Полного resolver нет; версии схем ограничены имеющимися fixtures. | tests/metadata.test.ts, tests/real-world.test.ts |
| Forge, NeoForge, LiteLoader | Современные TOML, часть legacy JSON и litemod.json; manifest и декларации. Версии JVM и legacy Forge не покрыты исчерпывающе. | tests/metadata.test.ts, tests/real-world.test.ts |
| Bukkit, Paper, Bungee, Velocity | Имя/ID, версия и декларации; Bungee использует depends/softDepends; отдельная версия Waterfall не определяется. | tests/metadata.test.ts, Paper в tests/real-world.test.ts |
| Паки и шейдеры | pack.mcmeta + assets/data: resourcepack, datapack, hybridpack или unknownpack; pack_format не доказывает совместимость. Шейдеры определяются по признакам структуры. | tests/metadata.test.ts, tests/directory.test.ts |
| ZIP/JAR | Stored и DEFLATE, CRC, descriptor, строгие имена; ZIP64, шифрование и multi-disk не поддерживаются. | tests/archive.test.ts |
| Иконки | Структурный probe PNG, JPEG, GIF, WebP; лимиты 4096 на сторону, 16 777 216 пикселей суммарно, 64 кадра GIF. APNG и animated WebP не поддерживаются. | tests/utilities.test.ts |

Sponge, Modrinth и CurseForge manifest не имеют полноценного обработчика в API пакета.
