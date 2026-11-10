# BUN_MIGRATION_REPORT

## Аудит до изменений

- Корень: package.json (команды установки проекта, сборки, dev, Share, тестов, порядок обхода воркспейсов), pnpm-lock.yaml (фиксированные версии), pnpm-workspace.yaml (packages/*, overrides, allowBuilds, strictDepBuilds и blockExoticSubdeps). .npmrc задаёт scoped registry, без настройки менеджера. Отдельный package-lock.json принадлежит @xnlc/nbt.
- Воркспейсы: команды публикации вызывают pnpm или npm, сборочные скрипты — Node.js, пакет Share использует node:test.
- Инструменты: scripts/sync-local-xnlc.mjs использует PNPM_SCRIPT и ручные ссылки. vite.config.mts и .gitignore упоминают локальный store.
- CI: release.yml — единственный workflow, использует pnpm/action-setup, setup-node, установку и сборку через pnpm.
- Актуальная документация: README.md, AGENTS.md, README пакетов agent и skins, services/share/README.md и WORKERS.md.
- Исторические упоминания: docs/xnlc-share-verification.md, отчёты Electrobun, identity, production readiness, remediation, security и Windows VM. Старые журналы, пакеты и кэши локальной разработки содержат ссылки на прежнюю среду.
- Нативные зависимости: desktop использует bun:sqlite, Share и отдельные тесты — better-sqlite3. Старый allowlist включает esbuild и register-scheme, включая tarball. Electrobun запускается через Hutch, рабочие процессы собираются Bun.

## 1. Итог миграции

Bun 1.4.4 управляет зависимостями, запускает локальные скрипты и тесты, собирает проект и используется в Windows release workflow. pnpm не требуется. Чистая установка и production-сборка Windows x64 прошли в копии исходников внутри проекта без Node.js и pnpm в PATH. Stable и Canary проверены локально, публикация не запускалась.

## 2. Конфигурация

- `package.json`: `packageManager: bun@1.4.4`, `workspaces: ["packages/*"]`, перенос двух overrides, закрепление архива опционального пакета Discord и разрешение lifecycle-скрипта esbuild.
- `bunfig.toml`: явно выбран изолированный linker.
- `.gitignore` и `vite.config.mts`: убраны правила для прежнего store. В `.gitignore` добавлено исключение для существующего теста артефактов каналов.
- `.npmrc` продолжает задавать scoped registry. Electrobun 2.0.6 и конфигурация упаковки сохранены, release workflow закрепляет Hutch 0.29.0.
- Команды и требования обновлены в README, AGENTS, README пакетов agent и skins и двух руководствах Share.

## 3. Воркспейсы

Все восемь пакетов (`types`, `core`, `mods`, `nbt`, `servers`, `skins`, `agent`, `share`) входят в Bun workspace. Сохранены имена, версии, `workspace:*`, exports и конфигурации TypeScript. Bun строит граф зависимостей по манифестам, а агент по-прежнему пересобирается после генерации IPC-каталога. Проверены все ссылки в `node_modules/@xnlc` и разрешение exports. Версии всех прямых внешних зависимостей совпали с исходным lockfile.

## 4. Lockfile

`bun pm migrate` импортировал исходный lockfile в нативный `bun.lock` версии формата 3. На первой установке Bun трактовал URL опционального `register-scheme` как GitHub shorthand, скачивал архив в другом формате и отклонял его по integrity. Вложенный override сохраняет URL исходного tarball, commit `e7cc9a63a1f512565da44cb57316d9fb10750e17` и SHA-512. Bun сам обновил lockfile через `bun install --lockfile-only`. Чистая frozen-установка на Windows x64 установила 429 пакетов. Проверены локальные связи, peer-разрешение через typecheck и production-сборку и используемые Windows x64 зависимости TypeScript, Vite и esbuild. Сохранены overrides для `shell-quote` и `@xnlc/core > adm-zip`.

## 5. Нативные зависимости

- Desktop использует прежний `bun:sqlite`, Share и соответствующие тесты — прежний `better-sqlite3@13.0.3`. Установленный N-API prebuild загрузился в Bun 1.4.4 Windows x64. В изолированном тесте встроенный Bun записал в SQLite WAL, а N-API драйвер прочитал эту запись. Desktop suite подтвердила миграцию существующего профиля 11 → 12, снимок с WAL, checkpoint и повторное открытие.
- Архив Stable содержит встроенный Bun 1.4.4, DLL Electrobun и WebView, renderer и три worker. Проверены запуск scan, упаковка файлов upload и ответ Minecraft worker по IPC из распакованного архива.
- `register-scheme` остался опциональной зависимостью с тем же исходным кодом. Bun 1.4.4 блокирует его транзитивный `node-gyp rebuild` для удалённого tarball. Лаунчер вызывает Discord RPC через IPC с `clientId`, без регистрации OAuth-схемы. Нативная регистрация схемы не проверялась.
- PE-заголовок и VersionInfo установщика подтвердили Windows x64, Xneon Launcher, версию продукта 1.0.8 и файловую версию 1.0.8.0.

## 6. Команды

| Раньше | Сейчас |
| --- | --- |
| `pnpm install --frozen-lockfile` | `bun install --frozen-lockfile` |
| `pnpm run <script>` / `npm run build` в prepublish | `bun run <script>` / `bun run build` |
| `pnpm --filter @xnlc/<package> run build` | `bun run --filter @xnlc/<package> build` |
| `pnpm -r --if-present run build` | `bun run --filter "@xnlc/*" build` |
| `node --test ...` | `bun test ...` |
| `node --env-file-if-exists=services/share/.env ...` | `bun --env-file=services/share/.env ...` |
| Ручные ссылки и `PNPM_SCRIPT` | `bun run sync:xnlc` выполняет frozen-установку и сборку воркспейсов |
| Глобальный Wrangler | `bun x wrangler@4.160.0`, с Node.js для CLI |

## 7. CI/CD

Изменён единственный workflow `.github/workflows/release.yml`. Он устанавливает Bun 1.4.4 и Hutch 0.29.0, использует frozen-установку и кэш Bun с ключом по ОС, архитектуре и `bun.lock`. Сохранены Windows runner, триггер релизных тегов, секреты сборки, имя и фильтр загружаемого Stable-артефакта, манифесты и шаг публикации. YAML и основные шаги проверены локально. Запуска на GitHub Actions не было.

## 8. Удалённые файлы

Из дерева исходников удалены `pnpm-lock.yaml`, `pnpm-workspace.yaml` и отдельный `packages/xnlc-nbt/package-lock.json`. Исходные копии находятся в игнорируемом `.tmp/bun-migration/original-locks`. Финальный поиск по рабочим конфигурациям, скриптам, CI и актуальной документации не нашёл ссылок на pnpm. Исторические записи и старые журналы сохранены.

## 9. Проверки

Основная среда — Windows x64, Bun 1.4.4 (38afee6c8), Electrobun 2.0.6, Hutch 0.29.0. Чистая копия в `.tmp/bun-migration/repro` создавалась без `node_modules`, build outputs и файлов окружения с секретами. Старые релизные артефакты в корне проекта сохранены.

| Команда | Код | Результат |
| --- | ---: | --- |
| `bun --version` | 0 | 1.4.4 |
| `bun pm migrate` | 0 | Создан нативный lockfile |
| `bun install --lockfile-only` | 0 | Обновлён lockfile, 528 записей пакетов |
| `where.exe node` и `where.exe pnpm` | 1 | В PATH проверки отсутствовали |
| `bun install --frozen-lockfile` | 0 | Чистая установка Windows x64 и повторная проверка финальной конфигурации |
| `bun run typecheck` | 0 | Обе конфигурации TypeScript |
| `bun run test:desktop` | 0 | 76/76, включая SQLite и проверку существующей схемы |
| `bun run share:test` | 0 | 28/28 в пакете, 27/27 в HTTP-сервисе |
| `bun test tests/agent` | 0 | 12/12 после сборки воркспейсов |
| `bun run build` | 0 | Renderer, workers, Stable и Windows x64 установщик |
| `bun run build:dev` | 0 | Electrobun dev bundle |
| `bun run sync:xnlc` | 0 | Установка и сборка восьми пакетов |
| `bun validate-config.mjs` | 0 | Ссылки, exports, прямые версии и YAML workflow |
| `bun scripts/test-channel-artifacts.mjs` | 0 | Stable → Canary → Stable, манифесты и контрольные суммы артефактов каждого канала |
| `powershell.exe -NoProfile -NonInteractive -File smoke-runtime.ps1` | 0 | Метаданные PE, содержимое архива, workers и SQLite на встроенном Bun |
| `bun run share:worker:deploy --dry-run --outdir ../wrangler-dry-run` | 0 | Локальная сборка Wrangler 4.160.0 с Node.js 24.16.0 |

Журналы и одноразовые скрипты проверок находятся в `.tmp/bun-migration`. Производственный build и тесты не использовали pnpm как запасной вариант.

## 10. Ограничения

- Установщик и GUI не запускались. Полный цикл установки, запуск GUI без отдельно установленного Node.js, ярлыки, реестр и удаление требуют гостевой Windows. Smoke-тест выполнил встроенный Bun и workers из архива и подтвердил наличие renderer и нативных библиотек.
- Hutch не получил метаданные предыдущего публичного релиза (`HttpConnectionClosing`) и выпустил полный архив. Проверка подготовки полного обновления прошла на обоих каналах. Создание и применение delta-патча не подтверждены.
- Живой release workflow и публикация Worker не запускались. Проверка нативных модулей ограничена Windows x64.

## 11. Вердикт

**BUN MIGRATION COMPLETE WITH WARNINGS**
