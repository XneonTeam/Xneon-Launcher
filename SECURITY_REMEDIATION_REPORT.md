# Исправления безопасности

- `packages/xnlc-agent/src/runtime.ts` и `components/launcher/agent/agent-page.tsx` связывают решение с ID конкретного запроса. Обработчик очищается при решении, остановке и ошибке сохранения. Каждый запрос ожидает собственное подтверждение перед выполнением уже разобранных аргументов.
- `bun.lock` обновлён с Bun 1.4.4. Изменены `adm-zip` 0.6.0 → 0.6.1, прямой `axios` 1.19.0 → 1.20.0, `shell-quote` 1.10.0 → 1.11.0 и `toml` 5.0.0 → 5.0.1. Для `wait-on` остаётся отдельный `axios` 1.19.0. Манифест пакета сохранён. Замороженная установка и сборка восьми workspace-пакетов прошли.
- `tests/security/agent-approval.test.mjs` проверяет одобрение текущего действия, отказ, недействительность старого ID и остановку. Провайдер и запись настройки синтетические.

Функциональные проверки и их коды приведены в `SECURITY_REGRESSION_TESTS.md`. Обновления зависимостей проверены замороженной установкой, тестами приложения и повторным запросом к advisory-реестру. Остаточные проблемы описаны в `SECURITY_REMAINING_RISKS.md`.

## Раунд 2

- Облако. `electrobun/main/cloud/token-store.ts` и `electrobun/db/cloud.ts` внедряют DPAPI CurrentUser и compare-and-swap. Google Drive, Dropbox, OneDrive и Yandex Disk используют compare-and-swap при refresh. WebDAV и S3 хранят конфигурацию через то же хранилище. WebDAV обновляет кэш при смене пароля.
- AI. `electrobun/main/ai-agent.ts`, `ai-credentials.ts`, `electrobun/main/system.ts` и `electrobun/db/settings.ts` отделяют чтение статуса, запись и использование ключа. Изменения параметров и ключа сохраняются одной транзакцией. `@xnlc/types`, preload, каталог Agent и настройки renderer обновлены под новый контракт. Кнопка удаления ключа локализована на шести языках.
- Ошибки AI. `ai-errors.ts`, `ai-agent.ts` и `agent-workspace.ts` используют категории с фиксированными сообщениями. Автоматическое следование redirect отключено для авторизованных запросов AI. Endpoint с redirect требует указать конечный адрес.
- Зависимости. `package.json` и `bun.lock` обновляют wait-on до 9.5.1 и ограничивают overrides конкретными родителями. Целевые версии — fast-uri 3.1.9, follow-redirects 1.16.2, brace-expansion 2.1.7, source-map-js 1.2.2 и Joi 18.3.1. Сохранены версии исправлений первого раунда.
- Проверки. `tests/electrobun/credential-security.test.mjs` добавляет шесть тестов. `WINDOWS_VM_VALIDATION.md` и `scripts/snapshot-security-vm.ps1` описывают проверку и сбор состояния гостя. Скрипт прошёл синтаксический разбор, сценарии VM ожидают запуска.

### Жизненный цикл облачных записей

| Поставщик | Получение и использование | Обновление и смена |
| --- | --- | --- |
| Google Drive | OAuth → строка `google-drive` → bearer для Drive | Refresh access token сохраняется при совпадении снимка. Новый вход заменяет строку, logout удаляет её. |
| Dropbox | OAuth → `dropbox` → bearer Dropbox | При отсутствии или истечении access token выполняется refresh с условным сохранением. |
| OneDrive | OAuth, client ID и токены → `onedrive` → bearer Graph | Refresh по сроку и после 401, запись условная. |
| Yandex Disk | OAuth → `yandex` → bearer Disk API | Refresh при приближении срока, запись условная. |
| WebDAV | Пользовательский URL, логин и пароль → `webdav` → WebDAV клиент и заголовок Basic | Смена соединения записывает новый конфиг. Клиент обновляется и при смене только пароля. |
| S3 | URL, bucket, region и ключи → `s3` → подпись AWS SigV4 | Новый вход заменяет конфиг и кэш, logout удаляет запись и сбрасывает кэш. |

DPAPI работает от имени пользователя Windows. Ошибка миграции сохраняет исходную строку для последующей попытки. Проверки реальных OAuth-поставщиков, отзыв удалённых токенов и остатки прежних plaintext-записей в копиях профиля остаются отдельной областью.
