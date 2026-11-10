# Регрессионные проверки безопасности

## Новая проверка

`tests/security/agent-approval.test.mjs` — 1 passed. Синтетический провайдер формирует три запроса на запись без внешней сети. Тест проверяет, что решение по старому ID не применяется к следующему запросу, явное согласие применяет показанные аргументы, отказ и остановка блокируют запись. Действия выполняются через подменённый адаптер настройки.

## Проверки Bun 1.4.4

| Команда | Код | Результат |
| --- | --- | --- |
| `bun --version` | 0 | 1.4.4 |
| `bun install --frozen-lockfile` | 0 | До и после обновления зависимостей |
| `bun run sync:xnlc` | 0 | Замороженная установка и сборка восьми пакетов |
| `bun run typecheck` | 0 | Renderer и main |
| `bun run test:desktop` | 0 | 76 passed, 0 failed |
| `bun run share:test` | 0 | 28 package и 27 service, 0 failed |
| `bun test tests/agent` | 0 | 12 passed, 0 failed |
| `bun test tests/security` | 0 | 1 passed, 0 failed |
| `bun run build` | 1 → 0 | Stable, повтор с локальным кэшем Hutch |
| `bun run build:dev` | 1 → 0 | Dev, повтор с локальным кэшем Hutch |
| `bun scripts/test-channel-artifacts.mjs` | 1 → 0 | Манифесты, Windows x64, идентификатор пакета и взаимная изоляция Stable/Canary |
| `bun audit` | 1 → 1 | 46 → 35 уведомлений |
| `bun audit fix --dry-run` | 1 | Предложено четыре обновления, остались уведомления |
| `bun audit fix` | 1 | Четыре обновления применены, остались уведомления |
| `git diff --check -- packages/xnlc-agent/src/runtime.ts components/launcher/agent/agent-page.tsx` | 0 | Пробелы и окончания строк |

Тесты desktop включают чтение состава Modrinth-пака, проверку хеша, существующие проверки совместимости SQLite и ветви обновления до передачи управления. Полный набор новых сценариев из задания не покрыт.

Первый запуск сборки с глобальным Hutch завершился `HttpConnectionClosing` при загрузке toolchain. Для повтора использованы `.hutch/toolchain-home`, его Hutch 0.29.0 и `DASH_RELEASE_OFFLINE=1`. Проверка сетевых дельта-обновлений отсутствует. Логи находятся в `.tmp/security-validation`.


Нативные тесты использовали временные профили и локальный feed. Проверка закончилась на стадии подготовки. Установка GUI, замена файлов приложения, перезапуск и rollback требуют Windows VM.

## Раунд 2 — Bun 1.4.4

| Команда | Коды | Результат |
| --- | --- | --- |
| `bun --version` | 0 | 1.4.4 |
| `bun audit --json` | 1 → 1 | 35 → 1 |
| `bun install` | 0 | Целевые обновления и сохранение lockfile |
| `bun install --frozen-lockfile` | 0 | Новый lockfile |
| `bun run sync:xnlc` | 0 | Установка и восемь workspace-пакетов |
| `bun run typecheck` | 1 → 0 | На промежуточном шаге исправлен optional expires_at у Yandex. Финальная проверка прошла. |
| `bun run test:desktop` | 1 → 1 → 0 | 80/2, затем 79/3 и 82/0. Первые два запуска показали Windows EPERM при переименовании тестовых каталогов, последний последовательно после сборки прошёл. |
| `bun run share:test` | 0 | 28 + 27 passed |
| `bun test tests/agent` | 0 | 12 passed |
| `bun test tests/security` | 0 | 1 passed, прежнее подтверждение |
| `bun run build` | 0 | Stable с локальным Hutch |
| `bun run build:dev` | 0 | Dev с локальным Hutch |
| `bun scripts/test-channel-artifacts.mjs` | 0 | Изоляция, идентификатор, манифесты и размеры Windows x64 |
| `bun scripts/electrobun.mjs prepare` с пустым Hutch home | 1 | `Cottontail: ReleaseDownloadFailed` |

Шесть новых desktop-тестов в `tests/electrobun/credential-security.test.mjs`:

1. DPAPI и синтетическая SQLite — миграция, чтение, refresh, смена учётной записи, выход и отказ поздней записи.
2. Ошибка защиты при миграции сохраняет исходные данные для повтора.
3. RPC статуса возвращает наличие ключа, discovery отправляет его только сохранённому поставщику, переключение и очистка удаляют старый ключ.
4. Discovery и потоковый анализ скрывают синтетические заголовки из HTTP-ошибки перед возвратом в renderer и отправкой события.
5. Ошибки auth, модели, квоты, redirect, invalid request, rate limit, timeout и outage имеют фиксированные категории. Исключения malformed JSON и connection не содержат исходного сообщения.
6. WebDAV создаёт новый клиент при смене пароля.

Два отказа Windows EPERM остаются сигналом нестабильности файловых тестов. Причина на уровне ОС не установлена. В отчёте проверки `82 passed` относится к последнему успешному последовательному прогону. Логи и коды собраны в `.tmp/security-round2`.

### Воспроизведение сборки на чистой машине

В одноразовой Windows x64 VM разместить копию исходников с текущим `bun.lock`, без пользовательского профиля и секретов. Установить Bun 1.4.4 и Hutch 0.29.0 как в `.github/workflows/release.yml`. Создать пустой `HUTCH_HOME` внутри копии. Записать версии и выполнить `bun install --frozen-lockfile`, `bun scripts/electrobun.mjs prepare`, `bun run build`, `bun run build:dev`, затем `bun scripts/test-channel-artifacts.mjs`. При сетевом сбое сохранить URL назначения из безопасного журнала Hutch, стадию, код и состояние кэша. Для отдельного офлайн-повтора предоставить предварительно проверенный кэш в `.hutch/toolchain-home`, его Hutch engine и `DASH_RELEASE_OFFLINE=1`.

В первом раунде глобальный Hutch остановился при загрузке Bun 1.4.4 с `HttpConnectionClosing`. Во втором пустой кэш остановился раньше при загрузке Cottontail. Подготовленный кэш уже был в рабочем дереве и обеспечил успешные сборки. При недоступности метаданных предыдущей версии Hutch пропустил дельта-патч. Workflow закрепляет версии Bun и Hutch, использует frozen install и запускается по тегу. Доступность всех нативных загрузок и воспроизводимость чистого процесса в GitHub Actions не подтверждены. Workflow не запускался.

## Повторная проверка по заданному порядку

| № | Команда | Код выхода | Результат |
| --- | --- | --- | --- |
| 1 | `bun run build` | 0 | Stable собран |
| 2 | `bun run build:dev` | 0 | Dev собран |
| 3 | `bun run sync:xnlc` | 0 | Workspace-пакеты синхронизированы |
| 4 | `bun run typecheck` | 0 | Проверка типов прошла |
| 5 | `bun --version` | 0 | 1.4.4 |
| 6 | `bun install --frozen-lockfile` | 0 | Установка по lockfile прошла |
| 7 | `bun run build:dev` | 0 | Dev повторно собран после установки |

Использован подготовленный локальный кэш Hutch. Отдельные тесты и Bun Audit в этом прогоне не запускались. Результаты предыдущего аудита, исключение по minimatch и проверки Windows VM перечислены в `SECURITY_REMAINING_RISKS.md`. Журналы семи команд сохранены в `.tmp/required-validation`.
