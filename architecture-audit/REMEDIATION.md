# Контролируемая ремедиация — результат блока A01

Дата: 15 ноября 2026. Ветка: `codex/bun-electrobun-launcher-fixes`. Технологии и публичные IPC-имена не менялись. Это результат **одного логического блока**, а не заявление об устранении всех 24 проблем.

## Область ответственности и параллельные изменения

В этой сессии реализован и проверен файловый блок A01. Во время работы в том же checkout появились сторонние изменения A02/A03/CI/создания серверов и коммиты shutdown `65c24eb`, `b4ae40a`. Они не создавались и не откатывались этой сессией. Неизвестные изменения не включаются в её fix-коммит.

`NOT STARTED` в таблице означает отсутствие самостоятельной реализации/полной приёмки **в этой сессии**, а не отсутствие изменений в общем рабочем дереве. Частично появившийся код не принимается как исправление только по имени файла или commit message.

## Единый реестр A01–A24

| ID | Проблема | Статус | Изменённые файлы этой сессии | Проверки | Остаточные риски |
|---|---|---|---|---|---|
| A01 | Безопасное обновление модпаков | PARTIALLY FIXED | `builds/modpack-install.ts`, `builds/index.ts`, `builds/helpers.ts`, watcher/copy/launch, cloud archive/import, CF client, Share exclusions; два тестовых набора, две инструкции | 10 RED → 47 GREEN; desktop 386 pass/5 skip; Share 28+27 pass; archives/parser/agent/security 103 pass/20 skip; первый Windows build успешен | Нет достоверного ownership manifest старых профилей; разные имена отключённых версий не сопоставляются эвристикой; последняя общая проверка типов блокируется параллельным A03; большие паки/другие ОС не приняты |
| A02 | Batch scan-worker | NOT STARTED | Нет | В общем desktop-прогоне есть внешние новые worker tests | Параллельно изменены entry/build/runtime и тесты; отдельная performance/runtime приёмка здесь не выполнена |
| A03 | Владение аккаунтными секретами | NOT STARTED | Нет | Последний typecheck показывает незавершённое согласование внешних PublicAccount/AuthPayload/UI | Нельзя объявить общий typecheck/build пройденным; миграция/все способы входа не проверены здесь |
| A04 | CI gate | NOT STARTED | Нет | Обнаружен внешний `.github/workflows/ci.yml` | Удалённый CI/вся platform matrix не запускались; общий A03 пока не компилируется |
| A05 | Builds snapshot/patch queue | NOT STARTED | Нет отдельного refactor | Существующие guards проходят desktop-suite; watcher не публикует частичное A01-применение | Файловая транзакция и последующая SQLite запись metadata не одна транзакция |
| A06 | Перегруженные IPC-модули | NOT STARTED | Только необходимая A01-граница файловой транзакции | Импортеры проверяются через настоящую регистрацию handlers с mock ports | Provider orchestration/server lifecycle/Java discovery отдельно не перерабатывались |
| A07 | IPC args/return/catalog | NOT STARTED | Публичные имена не менялись | Первоначальная catalog check/build прошла на прежнем контрактном срезе | Параллельный A03 меняет контракты; новый каталог требует согласованной приёмки |
| A08 | Shutdown barrier | NOT STARTED | Нет | Внешние коммиты с заявленной регрессией включены в общий desktop-прогон | Самостоятельная приёмка новой реализации/нативного выхода здесь не выполнена |
| A09 | Масштабирование Share | NOT STARTED | Нет | Существующие Share-regressions проходят | Новый нагрузочный baseline сервиса не снимался |
| A10 | Копирование серверов | NOT STARTED | Нет | Появившиеся внешние server-creation tests входят в общий checkout | Внешнюю реализацию не включал в свой commit и отдельно не принимал |
| A11 | Runtime cycles | NOT STARTED | Нет целевой переделки | Новая A01-граница не импортирует desktop/DB | Прежние SCC отдельно не устранялись |
| A12 | Test entrypoints | NOT STARTED | Новые A01 tests используют изолированный subprocess/реальные файлы | Общий desktop запущен уже по внешнему `test:prepare` | Изменения root scripts не являются работой этой сессии; все entrypoints не приняты |
| A13 | Декларации зависимостей | NOT STARTED | Нет | Ничего не удалено/не обновлено | Пять кандидатов остаются рекомендацией, не выполненной очисткой |
| A14 | Актуальность документации | NOT STARTED | Добавлены только фактические A01 instructions/measurements | Документы связаны с реализованными сценариями | Исторические противоречия всего репозитория не переписывались |
| A15 | Cleanup | NOT STARTED | Нет удалений | Пользовательские исходники/старые тесты/ресурсы сохранены | Кандидаты требуют отдельной проверки/решения |
| A16 | Metadata duplication server/parser | NOT STARTED | Нет | Существующие parser tests проходят | Общая граница не менялась |
| A17 | Два enrichment владельца | NOT STARTED | Нет | Существующий content-refresh loop проходит | Общий enrichment не перерабатывался |
| A18 | Кэши/бюджеты | NOT STARTED | Только bounded I/O нового A01 helper | Синтетические A01 measurements | Старые тяжёлые кэши/agent snapshots не ограничивались |
| A19 | Sync filesystem main | NOT STARTED | Новая A01 реализация асинхронна | Целевые A01 tests | Старое copy custom JAR не изменялось этой сессией |
| A20 | Legacy fallback DB | NOT STARTED | Нет | Профильные регрессии входят в desktop | Политика fallback отдельно не определена |
| A21 | Двойной agent build | NOT STARTED | Нет | В общем package.json появился внешний новый порядок prepare | Отдельная приёмка порядка/clean checkout здесь не выполнена |
| A22 | User-Agent/version | NOT STARTED | Нет | Старые literal tests сохранены | Identity не централизована этой сессией |
| A23 | i18n progress | NOT STARTED | Нет нового пользовательского hardcoded UI | Прежние IPC-имена/формы прогресса сохранены | Старые main progress messages не локализованы этим блоком |
| A24 | Config несоответствия | NOT STARTED | Нет | Видны внешние изменения workflows/NSIS/tsconfig | Их самостоятельная приёмка здесь не выполнена |

## 1. Что реально устранено в A01

- Modrinth, CurseForge, FTB и локальные MRPACK/CF не очищают установленный контент перед загрузкой.
- Ошибка сети, опубликованного checksum, scan или отмена не заменяет прежнюю версию частичным содержимым.
- Применение использует write-ahead journal и same-volume backups; восстановление проверено в том числе после фактического `process.exit(23)` дочернего процесса.
- Не затираются неизвестные legacy/user files, изменённые overrides и существующие миры. Старые известные управляемые файлы удаляются только при совпадении хеша.
- Обновление того же пути сохраняет `.disabled`; существующие внешние `intentPath` поддержаны.
- `runConcurrent` дожидается завершения уже начатых задач при ошибке, прежде чем staging удаляется.
- Скан/обычные content mutations через соответствующие границы не принимают промежуточную A01-запись; watcher откладывает уведомление до выхода из фазы применения.
- Журнал не экспортируется в ZIP/облако/Share и не принимается из внешнего архива как доверенное состояние.
- CF batch-клиент дополнен необязательным `sha1`, без удаления старых полей/методов.

## 2. Изменение архитектуры

Добавлена одна локальная прикладная граница `builds/modpack-install.ts` для общей файловой транзакции пяти существующих import routes. Не добавлены DI, state manager, новая БД или общий framework. Provider-клиенты не переписаны. Общий snapshot/patch queue builds и domain/server boundaries не переделывались.

Внутренний `.xnlc-modpack/managed.json` — versioned ownership map, а не новый публичный формат паков. Неизвестные файлы не считаются управляемыми по одному расположению.

## 3. Выполненные проверки

Все прогоны под Bun 1.4.4, без чтения local dotenv. Live parser fixtures выключены. Тесты используют отдельные временные профили, loopback или mocks; внешние live/deploy-сценарии не запускались.

| Проверка | Фактический результат |
|---|---|
| Новый `modpack-update.test.ts`, до production fix | **0 pass, 10 fail**: отсутствие old/user-disabled файлов и принятие неверного checksum. Исправленная fixture сначала проверена отдельно |
| Два финальных A01-набора | **47 pass, 0 fail**, 81 assertions |
| `bun run test:desktop` | **386 pass, 5 skip, 0 fail**, 71 файл. Общий checkout уже содержал внешние изменения |
| `bun run share:test` | **28 package + 27 service pass**, 0 fail |
| `bun test packages/xnlc-archives/tests packages/xnlc-parser/tests tests/security tests/agent` | **103 pass, 20 skip, 0 fail**, 20 файлов. 20 skips — явные live fixtures, не скрытые failures |
| Оба tsc до появления параллельного A03 | Прошли без ошибок |
| Первый `bun run build` | Прошёл: workspace builds, typecheck, Vite, workers, Electrobun stable, NSIS exe/zip/blockmaps/latest.yml. Не является проверкой последующих изменений общего checkout |
| Последний root typecheck | **Не прошёл**: после внешнего A03 PublicAccount/AuthPayload больше не содержат tokens, часть UI ещё обращается к ним |
| Повтор node tsc | **Не прошёл**: внешние `auth.ts:225,267,284`, несовместимость optional uuid PublicAccount с AuthPayload |
| `git diff --check` по файлам A01 | Прошёл; только предупреждения normal LF/CRLF при checkout |

Не суммировать эти pass counts как число уникальных тестов: наборы пересекаются. Успешная ранняя сборка не отменяет позднюю ошибку типов.

Build сообщил optional `could not fetch previous update metadata (ConnectionRefused); skipping delta patch`. Полная сборка завершилась успешно, но delta update path этим прогоном не проверен. Также были предупреждения Vite о Node externals в архивных пакетах и esbuild о import.meta при CJS test transpilation; их нельзя скрывать за словом «build прошёл».

## 4. Производительность

Пять повторов одинакового небольшого локального Modrinth fixture, baseline до production fix и финальный вариант:

- Wall time: медиана **43,486 → 177,217 мс**, диапазоны **42,695–44,544 → 163,574–182,651 мс**.
- CPU: медиана **63 → 281 мс**.
- RSS после операции, не peak: **74,004 → 76,973 МиБ**.
- Максимальная задержка 2-мс probe, медиана по повторам: **2,305 → 5,742 мс**.

Это **дополнительная стоимость сохранности**, не ускорение: старый путь не делал новые integrity/path checks, journal и backup renames. Неудачный вариант с параллельными rename был отброшен; ограниченный параллелизм чтения сохранён. Данные/методика/разброс и ограничения: [modpack-installation-remediation.md](../docs/benchmarks/modpack-installation-remediation.md).

Performance gate больших реальных паков, peak RSS и других платформ не закрыт. Отсутствие необоснованной регрессии всех сценариев не заявляется.

## 5. Непроверенное и остаточные риски

1. Первое обновление legacy-профиля без прежнего ownership manifest: неизвестные старые JAR сохраняются и могут дублировать новые. Удалять их автоматически без доказательств нельзя.
2. Разные имена отключённого/нового файла не сопоставляются по похожему имени; нужна достоверная project identity, а не эвристическое удаление.
3. CF fallback без metadata сохраняет совместимость, но не даёт опубликованного checksum/size для криптографической проверки.
4. Файловый commit и последующая metadata запись SQLite из renderer не являются одной транзакцией; A05 остаётся.
5. Гарантия восстановления относится к отказу операции/процесса, не к power-loss/fs corruption; fsync всех данных/каталогов не заявляется.
6. При внешней правке после аварии rollback отказывает с сохранением backup/journal; нужно осознанное восстановление, а не автоматическое затирание.
7. macOS/Linux, реальные CDN/пакеты, полный Minecraft launch и native upgrade lifecycle не проверялись.
8. Общее дерево меняется параллельно: последний typecheck красный вне A01. Нельзя публиковать текущий build как полностью готовый.

## 6. Что не удалено

Все существующие тесты сохранены. Не удалялись зависимости, lockfile entries, LICENSE/notices, старые audits, benchmark evidence, release artifacts и пользовательские материалы.

Предложения из CLEANUP остаются только предложениями: `electrobun/main/utils/version.ts`, `packages/xnlc-parser/xnlc-parser.rar`, четыре Minecraft-шрифта и пять cosmetic/literal test suites. Этот блок не выполняет их очистку.

## 7. Коммиты и приёмка

RED checkpoint этой сессии: `cbfbd09` — десять воспроизводимых регрессий до изменения production-кода. GREEN checkpoint фиксирует только перечисленные A01-файлы и 47 целевых проходящих проверок, не принятие параллельных A02–A24.

Следующий обязательный gate — после завершения внешнего A03 пересобрать workspace types/agent catalog и повторить root typecheck + production build текущего стабильного среза. Пока этот gate и legacy/performance ограничения не закрыты, A01 помечен **PARTIALLY FIXED**, а весь проект не объявляется готовым.
