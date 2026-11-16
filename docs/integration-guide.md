# Интеграция Xneon Launcher

Актуальные точки входа и контракты. Исторические отчёты не являются результатами
проверки текущего рабочего дерева. Для текущего прогона смотрите журнал проверки,
а не старые числа pass/fail в аудитах.

## Подготовка и проверка

Нужны Bun **1.4.4**, Hutch **0.29.0** / Electrobun **2.0.6**. Используйте
`bun install --frozen-lockfile`. В монорепозитории пакеты связываются workspace,
их `exports` указывают в `lib`, поэтому перед тестами нужна сборка зависимостей.

- `bun run prepare:desktop`: SDK prepare → credentials/catalog → одна сборка
  workspace-пакетов. Без `.env` credentials генерируются пустыми.
- `bun run typecheck`: renderer и main tsconfig; `typecheck:workspaces` — каждый пакет.
- `bun run test:offline`: desktop, parser unit/integration, archives, agent/security,
  Share domain и локальный HTTP, JS-клиент LiveOps. Нативные проверки используют platform guards.
- `test:live`, `share:test:live`, Worker smoke и GUI smoke запускаются отдельно,
  только с выделенными fixtures/профилем. Они не являются обычным CI gate.
- `bun run build`: prepare → types → renderer → workers → Electrobun; Windows
  stable сохраняет штатные артефакты Electrobun и добавляет Windows NSIS.
  `dev` тоже build-first, не обещает Vite HMR. Штатные Setup ZIP/DMG/Setup.tar.gz,
  tar.zst и update manifests не преобразуются в Electron-подобный набор;
  [сборки и проверки NSIS](platform-builds.md).

Единственный CI `.github/workflows/ci.yml`: `tests → build (matrix) → release`.
На PR и push main запускается один Linux job с quality/offline gates, бюджет — 15 минут.
Tags `v<package version>` дополнительно собирают все native платформы и публикуют release;
Ручной запуск на ветке собирает unsigned artifacts без публикации; на tag повторяет release.
Локальный Windows-прогон не доказывает запуск native Linux/macOS или удалённого Worker.

## IPC и владение данными

Событийными темами владеет main (`liveops.ts`, `liveops-runtime.ts`). Подключение —
через `XNLC_LIVEOPS_URL`; при отсутствии адреса сеть выключена. Проверенный
пакет хранится в `<userData>/event-theme-cache/`, настройка `eventTheme` отделена
от `customThemes`. `theme-store.ts` добавляет ивент к готовым темам, ручной выбор
передаёт через `liveops:select`; `settings:set("theme")` использует тот же
контроллер. IPC-типы — `LiveopsThemeRef`/`LiveopsStatus` из `@xnlc/types`.
Глобальный переключатель в «Готовых темах» хранится обычной настройкой
`autoApplyLiveOps` (`"true"`/`"false"`, по умолчанию true), не отдельным состоянием
кампании. Ручной выбор, ожидающий завершения polling/сохранения, откладывает
первое автоназначение; нормализация старого preset ID при старте не вызывает
ручной IPC. Регрессии — `tests/electrobun/themes-liveops.test.ts` и
`infrastructure/xnlc-liveops/client/auto-apply.test.mjs`.

1. Добавьте канал в `packages/xnlc-types/src/ipc-contracts.ts` (`IpcInvokeMap`),
   публичный метод API и DTO в том же пакете.
2. Зарегистрируйте handler в соответствующем `electrobun/main/` модуле через
   типизированный `rpcRegistry.handle`: проверяются аргументы **и return**.
   Runtime-вход недоверенный: проверяйте идентификаторы, типы, границы и пути.
3. Добавьте bridge в `electrobun/preload.ts`; `src/electrobun.d.ts` наследует
   общий API, а не содержит вторую копию интерфейса.
4. Для событий используйте `IpcEventMap`, не invoke map. Генератор
   `scripts/gen-agent-ipc-catalog.mjs` разделяет события/запросы и сверяет
   объявленные registrations. `--check` обнаруживает устаревший каталог.
   Эта статическая проверка не заменяет runtime-тест регистрации/политики доступа.
5. Выполните `bun run build` и регрессионные тесты затронутой подсистемы.

Main владеет SQLite и сессиями аккаунтов. Renderer получает `PublicAccount` и
результаты auth без access/refresh/client token. Выбор активного аккаунта —
`setActiveAccount`, порядок — `reorderAccounts`, отображение/новый offline —
совместимый `saveAccount`, который не принимает сессионные поля.
Обновление установленного модпака согласует файловый journal с
`builds/modpack-persistence.ts`: main записывает SQLite metadata/content до
commit-marker. Recovery выполняется до переноса каталогов и `startup:ready`;
схема14 сохраняет SQL backup только pack-owned полей. Renderer принимает
`launcher:modpack-updated`, инвалидирует устаревшие metadata-патчи и перечитывает
main, а не записывает прежний snapshot обратно. См. `docs/modpack-installation.md`.

Legacy localStorage переносится одноразовой атомарной миграцией, добавляющей
только отсутствующие ID: существующие сессии и active account не перезаписываются.
Неизвестные и не принятые записи не удаляются из исходного хранилища молча.
safeStorage защищает токены при доступном OS keyring; plaintext старого профиля
не теряется при отказе миграции. Это не защита от компрометации процесса/ОС.

`build:set-intent-path` — **legacy ensure-directory**, не запись произвольного пути:
он проверяет ожидаемый каталог. Путь сохраняется через `insertBuild`/
`updateBuildFields`. `BuildWriteQueue` — владелец renderer-очереди патчей;
старое подтверждение не очищает новые значения, failed patches остаются для retry.

## Импорт, файлы и пакеты

- Установка модпаков использует `builds/modpack-install.ts`: staging, managed
  manifest, write-ahead journal, rollback/recovery. См. [детали](modpack-installation.md).
  Не удаляйте прежнюю версию перед скачиванием; миры, overrides и disabled layouts сохраняются.
- `mc-server-creation.ts` готовит файлы до записи БД, компенсирует ошибки,
  возвращает сохранённый порт. Крупный custom JAR копируется асинхронно.
- `mc-server-start.ts` владеет подготовкой Java/JAR и проверяет stop-token
  после каждого await. Тесты импортируют сценарий, не вырезают функцию из IPC.
- `builds/modpack-service.ts` отделяет чтение индексов, проверки активности и
  подготовку файловой транзакции/дозагрузки от регистрации build handlers.
- Java discovery живёт в `main/java-discovery.ts`, независимо от регистрации system IPC.
- `@xnlc/archives` — единый ZIP слой. Reader поддерживает single-disk ZIP64,
  числа только в safe integer; encryption/multi-disk/неподдерживаемые методы запрещены.
  Writer также формирует ZIP64 при больших размерах/числе записей; настроенные
  бюджеты и ограничения safe integer продолжают действовать.
- Server JAR analyzer и content parser имеют разные задачи. Общие Fabric/Forge/
  NeoForge metadata защищены parity fixtures, server heuristics не заменены parser.

## Workers и завершение

`scripts/build-bun-workers.mjs` собирает Minecraft process entry, archive Worker
и batch scan-worker. `electrobun.config.ts` копирует `dist-workers` в
`Resources/app/bun/workers`; имена централизованы в `platform/resources.ts`.
По умолчанию main использует **inline**: benchmark worker показал рост CPU/RSS.
`XNLC_SCAN_WORKER=1` явно включает `setScanWorkerEntry` при наличии файла.
Без entry parser использует inline, а не неявный worker из package lib. Worker-тест обязан
подтвердить настоящий выбранный путь, отмену и передачу результатов.

ArchiveService ограничивает тяжёлые операции двумя одновременно, ожидающие
задачи отменяются до создания Worker; кооперативная отмена ограничена 5 с,
вся операция — 30 минутами. Кэши metadata
имеют TTL/LRU, build content — лимит количества и оценочного веса; рабочие
UI-снимки и pending writes являются отдельными владельцами памяти.

Cleanup регистрируется через `platform/shutdown.ts`. Не создавайте новый цикл
`preventDefault → cleanup → app.quit`: общий барьер ждёт задачи, затем закрывает
SQLite и выходит. SDK update использует prepare без преждевременного выхода и
строгий checkpoint/reopen. Политика игровых/серверных JVM не изменяется молча.

## Identity, локализация и Share

`lib/app-meta.ts` получает версию из root package.json. Встроенные клиенты
получают `XNLC_APPLICATION_USER_AGENT` через build define; standalone пакеты
имеют собственный default, Share source также принимает override.
Progress переносит `messageKey`/параметры и переводится в renderer через i18next.

Share: `infrastructure/xnlc-share/service.mjs` — общий сервисный слой, local server — Bun/
SQLite, production adapter — Durable Object/R2. Это не Electron preload API.
Сохранение инкрементальное; immutable commits не копируются со всеми манифестами
при каждой смене роли. Сетевое тело не держит metadata queue, но ACL, квоты и GC
остаются в её критической секции. Полный GET сохраняет прежний контракт полной истории.
Контракт сервиса и deployment описаны в `infrastructure/xnlc-share/WORKERS.md`.
Актуальные воспроизводимые сценарии измерений — [benchmarks](../benchmarks/README.md).
