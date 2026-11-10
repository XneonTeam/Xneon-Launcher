# Аудит нативных API Bun и зависимостей Xneon Launcher

## Итог

Из корневого манифеста удалены две неиспользуемые прямые зависимости. `wait-on` и его отдельная ветка Joi удалены из lockfile. Удалён относящийся только к этой ветке override. `form-data` остался транзитивно через Axios и присутствует в Stable bundle. Изменены `package.json` и `bun.lock`. Код HTTP, S3, ZIP, SQLite и Java-процессов сохранён.

Сфокусированный эксперимент выполнен на установленном Windows Bun 1.4.4. Он проверил конкретные свойства API на временных файлах, локальных HTTP/S3-ответах и SQLite в памяти. Проверка проводилась без живых сервисов, пользовательского профиля и сохранения секретов. Исходник и вывод эксперимента находятся в `.tmp/bun-native-audit/runtime-probe.mjs` и `runtime-probe.log`. [Обзор API](https://bun.com/docs/runtime/bun-apis) · [Справочник Bun](https://bun.com/reference)

## Среды исполнения

| Область | Среда и границы |
| --- | --- |
| Electrobun main и нативные адаптеры | Bun, локальные файлы, дочерние процессы, сеть, SQLite. RPC передаёт в WebView данные и результаты операций. |
| Scan, upload, Minecraft workers | Bun, сообщения воркеров и IPC дочерних процессов. Их протоколы включают `workerData`, `parentPort` и управление Java-процессом. |
| Восемь XNLC-пакетов | Общий код и публикации ESM/CJS. Нативные API Bun внутри общего кода меняют требования к потребителям. |
| Share | Локальный сервис под Bun с `better-sqlite3`. Cloudflare Workers и D1 используют собственную среду. |
| React, preload и WebView | Renderer и JS-мост используют браузерные API и RPC. В renderer при поиске не обнаружены импорты перечисленных Node-модулей. |
| Скрипты и инструменты | Bun выполняет скрипты, Hutch и Electrobun обслуживают нативную сборку, Vite и PostCSS собирают renderer. |

## Инвентарь Node API

Таблица показывает найденные строки импорта и обращения к глобальным именам в JS/TS-исходниках. Для `process` и `Buffer` это лексические совпадения. Точный индекс «файл, строка, API» лежит в `.tmp/bun-native-audit/node-api-occurrences.txt`. Префиксы `node:` и короткие формы объединены.

| API | Desktop | XNLC | Share | Build | Renderer | Tests |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| `fs/promises` | 57 | 3 | 7 | 1 | 0 | 19 |
| `fs` | 26 | 31 | 1 | 4 | 0 | 2 |
| `path` | 78 | 32 | 6 | 4 | 0 | 13 |
| `crypto` | 29 | 4 | 9 | 0 | 0 | 2 |
| `http` | 4 | 1 | 1 | 0 | 0 | 1 |
| `https` | 3 | 1 | 0 | 0 | 0 | 0 |
| `stream` | 0 | 0 | 0 | 0 | 0 | 0 |
| `worker_threads` | 4 | 0 | 0 | 0 | 0 | 0 |
| `child_process` | 8 | 9 | 0 | 3 | 0 | 0 |
| `dgram` | 1 | 0 | 0 | 0 | 0 | 0 |
| `net` | 2 | 1 | 0 | 0 | 0 | 1 |
| `dns` | 0 | 1 | 0 | 0 | 0 | 0 |
| `zlib` | 0 | 4 | 1 | 0 | 0 | 0 |
| `buffer` | 0 | 0 | 0 | 0 | 0 | 0 |
| `util` | 2 | 1 | 0 | 0 | 0 | 0 |
| `os` | 8 | 5 | 4 | 0 | 0 | 12 |
| `events` | 3 | 0 | 0 | 0 | 0 | 1 |
| `process` | 146 | 72 | 9 | 24 | 0 | 10 |
| `Buffer` | 199 | 33 | 24 | 0 | 0 | 27 |


| Группа | Использование и вывод |
| --- | --- |
| `fs`, `fs/promises`, `path` | Файлы, метаданные, ссылки, каталоги, атомарный rename. Проверены Bun.file/write/Glob с именем Unicode. Эти API пригодны для простого чтения и записи. Смена файловых примитивов не даёт автоматического сохранения атомарности, ACL и поведения ссылок. **NOT WORTH REPLACING** для текущих операций. |
| `crypto`, `zlib`, `Buffer` | SHA, подписи, HMAC, случайные значения, gzip/NBT, бинарные форматы и интеграция библиотек. Результат CryptoHasher SHA-256 совпал с node:crypto на синтетических данных. Для `Bun.hash` проверена доступность, его назначение некриптографическое. Замена им контрольных SHA недопустима. **NOT WORTH REPLACING**. |
| `http`, `https`, `net`, `dgram`, `dns`, `stream` | HTTP-сервис Share, OAuth callbacks, TCP relay, UDP и DNS Minecraft. Fetch эквивалентен только клиентскому HTTP в ограниченных случаях. Bun.serve и Bun.connect не являются взаимозаменяемыми с контрактами сервера, сокетов и жизненным циклом существующего кода. `node:stream` прямо не импортируется в сканируемом коде, потоковые контракты присутствуют у зависимостей. **REQUIRES FURTHER TESTING**. |
| `child_process`, `worker_threads`, `events` | Java, DPAPI, worker IPC, инструменты сборки и EventEmitter. Проверен Bun.spawnSync с cwd, Unicode и кодом выхода. Web Worker использует иной протокол обмена. Java и worker lifecycle требуют отдельного сравнения таймаутов, завершения, stdio и IPC. **NOT WORTH REPLACING** для простой смены синтаксиса. |
| `util`, `os`, `process`, `buffer` | Promisify, пути профиля, характеристики ОС, argv, cwd, env и Buffer. Имеющиеся импорты поддерживаются Bun в используемых путях. `Bun.env` не заменяет API процессов, а Blob и Uint8Array не заменяют все вызовы Buffer. **NOT WORTH REPLACING**. |

Статус поддержки зависит от конкретного API. Документация отдельно отмечает частичную совместимость отдельных методов. Сборки и сфокусированные пробы подтверждают проверенные пути, а не полную реализацию модулей. [Node.js compatibility](https://bun.com/docs/runtime/nodejs-compat) · [File I/O](https://bun.com/docs/runtime/file-io)

## Решения по npm и нативным заменам

| Текущая зависимость или механизм | Проверка Bun 1.4.4 и решение | Статус |
| --- | --- | --- |
| `wait-on` | В сценариях запуска, workflow и исходниках вызовов нет. Удалены прямая dev-зависимость и её scoped override Joi. Из Stable bundle маркер отсутствует. | **REPLACED AND VERIFIED** — удаление без замены |
| Прямой `form-data` | Прямых импортов нет. Существующие загрузки Authlib используют свой multipart. Browser FormData и Bun fetch остаются доступны. Axios продолжает требовать пакет транзитивно, что видно в lockfile и Stable bundle. | **REPLACED AND VERIFIED** — удаление прямого объявления |
| `axios`, `follow-redirects`, `https-proxy-agent`, `proxy-from-env` | `electrobun/main/avatar.ts` использует JSON GET/POST, бинарный ответ, 5-секундный таймаут, User-Agent и ошибки non-2xx. Проверены fetch, redirect, deadline, JSON и HTTP status. Требуется сопоставить env-прокси, NO_PROXY, поведение при переходе между origin, отмену чтения тела и нетипичные JSON-ответы на том же наборе запросов. Перенос не применён. | **REQUIRES FURTHER TESTING** |
| `node-fetch` и WebDAV | Транзитивный транспорт WebDAV. Замена внешнего транспорта требует проверок PROPFIND, аутентификации, XML, URL и передачи потоков. `undici`, `got`, `cross-fetch`, `isomorphic-fetch` и `request` не обнаружены как прямые сетевые клиенты приложения. | **REQUIRED BY EXTERNAL TOOLING** для транспорта WebDAV |
| Собственный S3 SigV4 | AWS SDK в провайдере не используется. В пробе Bun.S3Client подписал loopback PUT/GET/DELETE/LIST с custom endpoint, bucket, region и синтетическим ключом. Проверены локальная генерация presigned GET/PUT и форма virtual-hosted URL. Не проверены реальный MinIO, AWS и R2, multipart, большие файлы, прерывания, ретраи, отказ в доступе и пользовательские префиксы endpoint. Нужна эквивалентность прогресса, листинга с пагинацией и ошибок. Потоковая загрузка может снизить пиковую память, но замеров нет. | **REQUIRES FURTHER TESTING** |
| `adm-zip`, системный TAR | Bun.Archive выполнил tar.gz round-trip. API работает с TAR, тогда как JAR, .mrpack, темы и облачные архивы требуют ZIP. Сравнение метаданных, лимитов, ссылок и потоковой распаковки остаётся отдельным для TAR-путей. Проверки назначения извлечения сохраняются. Установщик и updater используют свой формат и инструменты. | **NOT SUPPORTED BY BUN 1.4.4** для замены ZIP |
| `better-sqlite3` | Desktop уже использует bun:sqlite. Проверен параметризованный запрос к базе в памяти. Share server, экспорт и тесты совместимости используют better-sqlite3. Миграция требует сравнения WAL, типов, транзакций, резервных копий и старых профилей. | **REQUIRES FURTHER TESTING** |
| DPAPI и `Bun.secrets` | Подтверждено наличие метода. Запись в системное хранилище не выполнялась. Переход меняет способ хранения и атомарность с SQLite. Нужны миграция, ограничения размера, проверка режимов хранения Windows и доступности сервисов macOS/Linux. | **REQUIRES FURTHER TESTING** |
| `dotenv`, Electrobun, Vite, esbuild, PostCSS и инструменты | Desktop явно загружает dotenv/config. Смена загрузки env требует проверить cwd и жизненный цикл bundled main. Сборочные пакеты обслуживают Vite/Hutch/Electrobun и не имеют прямой замены прикладным API Bun. | **REQUIRED BY EXTERNAL TOOLING** |

Источники для сравнения — [Fetch](https://bun.com/docs/runtime/networking/fetch), [S3](https://bun.com/docs/runtime/s3), [Archive](https://bun.com/docs/runtime/archive), [SQLite](https://bun.com/docs/runtime/sqlite), [Secrets](https://bun.com/docs/runtime/secrets).

### Прямые npm и workspace-зависимости после изменений

| Манифест | Runtime | Dev |
| --- | --- | --- |
| `package.json` | `@fontsource/plus-jakarta-sans`, `@modelcontextprotocol/sdk`, `@types/prismjs`, `@xnlc/agent`, `@xnlc/core`, `@xnlc/mods`, `@xnlc/nbt`, `@xnlc/servers`, `@xnlc/share`, `@xnlc/skins`, `@xnlc/types`, `adm-zip`, `axios`, `discord-rpc`, `i18next`, `iconv-lite`, `pngjs`, `prismjs`, `react-simple-code-editor`, `remark-gfm`, `skinview3d`, `three`, `toml`, `webdav` | `@radix-ui/react-checkbox`, `@radix-ui/react-dialog`, `@radix-ui/react-select`, `@tabler/icons-react`, `@tailwindcss/postcss`, `@types/bun`, `@types/node`, `@types/pngjs`, `@types/react`, `@types/react-dom`, `@types/three`, `@vitejs/plugin-react`, `autoprefixer`, `better-sqlite3`, `clsx`, `concurrently`, `cross-env`, `dotenv`, `electrobun`, `esbuild`, `postcss`, `react`, `react-dom`, `react-i18next`, `react-markdown`, `rehype-raw`, `rehype-sanitize`, `tailwind-merge`, `tailwindcss`, `tw-animate-css`, `typescript`, `vite` |
| `packages/xnlc-agent/package.json` | `@xnlc/types` | — |
| `packages/xnlc-core/package.json` | `@xnlc/types`, `adm-zip`, `iconv-lite` | — |
| `packages/xnlc-mods/package.json` | — | — |
| `packages/xnlc-nbt/package.json` | — | `@types/node`, `typescript` |
| `packages/xnlc-servers/package.json` | `@xnlc/types`, `adm-zip`, `iconv-lite`, `toml` | — |
| `packages/xnlc-share/package.json` | — | — |
| `packages/xnlc-skins/package.json` | `@xnlc/core`, `@xnlc/types` | — |
| `packages/xnlc-types/package.json` | `@xnlc/share` | — |


## Проверка

| № | Команда | Код | Результат |
| --- | --- | --- | --- |
| 1 | `bun run build` | 0 | Stable собран |
| 2 | `bun run build:dev` | 0 | Dev собран |
| 3 | `bun run sync:xnlc` | 0 | Workspace-пакеты синхронизированы |
| 4 | `bun run typecheck` | 0 | Проверка типов прошла |
| 5 | `bun --version` | 0 | 1.4.4 |
| 6 | `bun install --frozen-lockfile` | 0 | Установка по новому lockfile |
| 7 | `bun run build:dev` | 0 | Dev повторно собран после установки |

Подготовительный `bun install --lockfile-only` и отдельная проверка API завершились с кодом 0. Отдельные наборы тестов не запускались. Stable bundle проверен чтением локального архива, без запуска установщика. Hutch использовал существующий локальный кэш и пропустил дельта-патч из-за `HttpConnectionClosing`. Журналы и свидетельства упаковки лежат в `.tmp/bun-native-audit`.

Снижение поверхности зависит от конкретного графа. Удалена неиспользуемая ветка tooling, а production HTTP-граф Axios и транзитивный form-data сохранены. Существующее исключение minimatch и проверки Windows VM остаются открытыми. Новый Bun Audit не запускался.
