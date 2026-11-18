# Ивентовые темы Xneon — отдельный микросервис

Самостоятельный проект: **Go 1.26+, только стандартная библиотека**, один бинарник,
JSON-каталог, до 32 запланированных ивентов. На сервере не нужны Go, Node, Bun,
SQLite, npm/pip или контейнер. Go нужен только на машине сборки. Клиентский код
работает в основном процессе Bun/Node, использует встроенные API и не требует зависимостей.

Лаунчер подключён через `electrobun/main/liveops.ts`. Сервис принимает обычные
`.xntheme` с CSS и ресурсами Custom Themes; клиент применяет их тем же `applyTheme`.
Никаких скрытых записей в `customThemes` или пользовательские CSS-файлы нет.

## Cloudflare Workers (production)

Адрес: **https://liveops.xneon.org** (резервный: `https://xnlc-liveops.stepangavrilov736.workers.dev`).
Адаптер `worker/` сохраняет HTTP-контракт Go-сервиса. Один SQLite Durable Object
`LiveOpsSchedule` координирует одно расписание без пересечений; приватный R2 bucket
`xnlc-liveops-packages` хранит пакеты по SHA-256. Go-вариант остаётся для собственного сервера.

- До 32 событий, 4096 использованных ID, пакет/вход ≤4 000 000 байт,
  распакованные ZIP/ассеты ≤3 000 000 байт, R2-пакеты суммарно ≤60 000 000 байт.
- Отозванный/истёкший ID не переиспользуется. Тема доступна публично только
  внутри активного интервала; конец исключительный. Alarm удаляет истёкшие данные.
- SQL-учёт пакета пишется до R2 put, событие и tombstone — одной SQL-транзакцией
  после успешной записи пакета. Неудавшиеся/осиротевшие записи собираются повторно.
- `disk_bytes` в Worker означает учтённые байты пакетов R2, а не физический
  размер Cloudflare SQL/резервных копий. Ограничения диска Go ниже относятся только к Go.
- Административный секрет — **`LIVEOPS_ADMIN_TOKEN`**, устанавливается через
  `wrangler secret bulk/put`, никогда не в `wrangler.jsonc`. CLI Go `put/list/delete`
  совместим с Worker: используйте production URL и отдельный локальный token-file.

Из корня репозитория:

```powershell
bun test infrastructure/xnlc-liveops/worker/service.test.mjs infrastructure/xnlc-liveops/client
bun x wrangler@4.160.0 deploy --dry-run --config infrastructure/xnlc-liveops/wrangler.jsonc
bun x wrangler@4.160.0 deploy --keep-vars --config infrastructure/xnlc-liveops/wrangler.jsonc
```

`worker/deploy.mjs` выполняет deploy, загрузку секрета из приватно переданной
переменной окружения и smoke с будущим событием. Он требует `LIVEOPS_ADMIN_TOKEN`.
`worker/smoke.mjs <url>` проверяет существующий деплой; production smoke не
активирует тему пользователям, создаёт будущую кампанию и удаляет её в `finally`.
Использованный тестовый ID остаётся tombstone по штатной политике.
Флаг `--local-active` предназначен **только для изолированного локального runtime**.

Лаунчер использует production-домен по умолчанию. Для переопределения:

```powershell
$env:XNLC_LIVEOPS_URL='https://liveops.xneon.org'
```

Явно пустая `XNLC_LIVEOPS_URL` выключает сетевой LiveOps. Новый default применяется
после обновления лаунчера; развёртывание сервиса само по себе не меняет ранее
установленные версии, не публикует новогоднюю тему и не переносит локальный каталог.

## Структура

```text
xnlc-liveops/
  main.go                  # HTTP-сервер, таймер очистки и CLI администратора
  service.go               # расписание, API, атомарный JSON, квоты
  package.go               # безопасная проверка JSON/ZIP
  *_test.go
  client/
    model.mjs              # чистая машина состояний A/Б/В
    controller.mjs         # polling, загрузка, SHA-256, таймер истечения
    package.mjs            # клиентская проверка и преобразование в Theme
    file-storage.mjs       # отдельный кэш ивентов
    *.test.mjs
  examples/winter.json
  deploy/                  # создаётся при сборке, не хранится в Git
    themesvc               # исполняемый файл (Windows: themesvc.exe)
    admin.token            # генерируется при первом запуске, 0600
    data/catalog.json
    data/packages/<sha256>.json
```

## Дисковый бюджет: строго 100 000 000 байт, не 100 MiB

- Бинарник со встроенным Go runtime: резерв **16 MB**, старт отклоняется при превышении.
- Пакеты: максимум **60 MB**, один нормализованный пакет ≤ **4 MB**, ассеты ≤ **3 MB**.
- Каталог и компактные tombstone ID: ≤ **1 MB**, максимум 4096 использованных ID.
- Временная атомарная копия, исходники/инструкции при их наличии и запас: оставшаяся квота.
- Каждая запись измеряет **все обычные файлы внутри deployment root**, включая бинарник,
  JSON, секрет и временные файлы; проверяется пиковый размер до переименования.
  Рабочий потолок — 95 MB, ещё 5 MB оставлены под округление/служебные расходы.
  Загрузка сверх квоты получает **507**, существующие активные/будущие темы не вытесняются.
- ZIP читается в памяти, проверяется и нормализуется в один JSON с base64-ассетами.
  На диск не пишутся одновременно ZIP, распакованные файлы и JSON. ZIP bomb, symlink,
  абсолютные/вложенные пути, лишние записи и дубликаты отклоняются.
- Истёкшие темы удаляются каждую минуту, на старте и при запросах. Отзыв — через DELETE.
  После сбоя удаляются известные `.tmp` и неиспользуемые пакеты. ID не переиспользуются,
  чтобы сохранённый отказ пользователя нельзя было случайно сбросить.
- Логи направлены в stderr, **внутри root лог-файлы не создаются**. Ограничьте journald/
  reverse-proxy логи, иначе они расходуют место вне контролируемого каталога.

Гарантия приложения относится к его собственным записям при одном процессе-писателе.
Защитить от постороннего процесса, вручную записывающего файлы, или точно ограничить
физически выделенные блоки/метаданные ФС может только **quota/отдельный volume на 100 MB**.
Go toolchain, build/test cache, Git и рабочее `node_modules` лаунчера **не развёртываются**.
Сервис не следует запускать через `go run`: он проверяет расположение бинарника внутри root.

## Сборка и запуск

Из этой папки, на машине сборки:

```bash
go test -cover ./...
go vet ./...
go build -trimpath -ldflags="-s -w" -o deploy/themesvc .
```

Для Windows выходной файл назовите `deploy/themesvc.exe`.
Для Linux с другой машины: `CGO_ENABLED=0 GOOS=linux GOARCH=amd64 go build ...`.
Никаких внешних Go-модулей нет (`go.sum` не нужен).

```bash
./deploy/themesvc serve --listen 127.0.0.1:8091 --public-url https://themes.example.org
```

Root по умолчанию — каталог бинарника. Первый запуск создаёт `admin.token`; значение
не выводится в лог. Для публичного сервиса используйте HTTPS через существующий reverse proxy
или встроенные `--tls-cert` / `--tls-key`. Admin API не публикуйте без необходимости:
доступ через loopback/SSH tunnel предпочтителен. Не передавайте токен в URL/argv.
Не запускайте два процесса с одним root на разных портах. Права на root — только сервисному UID.

Загрузка JSON-пакета либо `.xntheme` (команда сама читает токен из файла):

```bash
./deploy/themesvc put --url http://127.0.0.1:8091 --token-file deploy/admin.token --id winter-2026 --start 2026-11-20T00:00:00Z --end 2027-01-15T00:00:00Z --file examples/winter.json
./deploy/themesvc list --token-file deploy/admin.token
./deploy/themesvc delete --token-file deploy/admin.token --id winter-2026
```

Дата окончания **исключительная**: чтобы включить весь день 14.01.2027, задайте
`2027-01-15T00:00:00Z`. Все даты — RFC3339 с часовым поясом; не неоднозначные `20.11.2026`.
Пересекающиеся интервалы запрещены (409), соприкасающиеся разрешены. Ивент неизменяемый:
для исправления отозвать старый и создать **новый event_id**. Нельзя загрузить уже завершившийся
ивент; максимальная длительность 366 дней.

## API

Публичные:
- `GET /healthz` — статус;
- `GET /v1/events/current` — текущий ивент или `active_event: null`;
- `GET /v1/packages/<sha256>.json` — пакет, доступен только в активном интервале.

С `Authorization: Bearer <admin.token>`:
- `PUT /v1/admin/events/<event_id>?start_date=<RFC3339>&end_date=<RFC3339>`;
  body: JSON (`application/json`) или ZIP (`application/zip`). Ответ 201 + Location.
- `GET /v1/admin/events` — расписание и фактические байты;
- `DELETE /v1/admin/events/<event_id>` — отзыв, очистка пакета, ответ 204.

Пример `/v1/events/current`:

```json
{
  "version": 1,
  "server_time": "2026-11-20T12:00:00Z",
  "next_check_at": "2026-11-20T12:05:00Z",
  "active_event": {
    "event_id": "winter-2026",
    "name": "Зимний ивент",
    "start_date": "2026-11-20T00:00:00Z",
    "end_date": "2027-01-15T00:00:00Z",
    "sha256": "64 lowercase hex characters",
    "size": 638,
    "package_url": "https://themes.example.org/v1/packages/<sha256>.json"
  }
}
```

Значения SHA/size выше иллюстративные; реальный сервис вычисляет их по точным JSON-байтам.
Ответ не кэшируется (`Cache-Control: no-store`), ошибки имеют форму
`{"error":{"code":"quota_exceeded","message":"Disk budget exceeded"}}`.
Максимум 16 одновременных обработчиков; пределы body и HTTP timeouts заданы.
Для защиты от массовых публичных запросов настройте rate limiting у reverse proxy.

## Формат темы и безопасность

`examples/winter.json` — прежний JSON-пакет. Обычный `.xntheme` — ZIP с `theme.json`
(`{ "format": "xneon-theme", "version": 1, "theme": { ... } }`) и `assets/`.
Прежний ZIP с самим объектом theme в `theme.json` также поддерживается.
Поддержаны ссылки `xnl-theme://asset/<имя>` из штатного экспорта и `assets/<имя>`.
Ассеты в JSON-пакете: `{name, media_type, data_base64}`; сервер и клиент проверяют лимиты.

Поддержаны палитра, glow, CSS/readerCss, appearance, шрифты и фон image/video/particles/halo.
Внешние HTTPS-фоны и шрифты разрешены; CSS поддерживает url()/@import, как Custom Themes.
Ресурсы архива преобразуются в data URL в отдельном event-cache, не в библиотеке пользователя.
Сервер нормализует архив в прежний транспортный `xneon-event-theme` v1, сохраняя CSS.
Клиент назначает `event:<event_id>` и `custom: false` независимо от исходного ID архива.

CSS — доверенный контент администратора сервиса: он не изолирован от интерфейса и может
обращаться к внешним хостам. Это не CSS-песочница. Используйте только доверенный LiveOps origin
и проверяйте публикуемые темы. JS-файлы и произвольные локальные пути не принимаются;
проверки ZIP traversal/дубликатов, SHA-256, размеры пакета/ассетов и дисковая квота сохранены.

TLS + заранее заданный origin — граница доверия; SHA-256 проверяет пакет, но сам по себе
не является цифровой подписью. Для недоверенного CDN потребуется подписанный конфиг и
закреплённый публичный ключ. Контроллер запрещает redirects и URL пакета другого origin.

## Состояние клиента

Хранение **отдельно**: `<launcherData>/event-theme-cache/state.json` + один пакет.
Кэш не записывается в `customThemes` и папку пользовательских CSS-тем.

```json
{
  "version": 1,
  "selected": { "kind": "event", "id": "winter-2026" },
  "previous": { "kind": "preset", "id": "orange" },
  "active_event": { "...": "полная копия проверенных метаданных" },
  "events": {
    "winter-2026": {
      "is_auto_apply_blocked": false,
      "auto_considered": true,
      "was_auto_applied": true,
      "end_date": "2027-01-15T00:00:00Z"
    }
  },
  "last_now": 1795176000000,
  "clock_offset_ms": 0
}
```

`kind` — явный дискриминатор **preset/custom/event**, не выводится только из имени ID.
После окончания восстанавливается `previous`; если её удалили — штатный пресет `orange`.
Временные идентификаторы ивентов в реестре имеют вид `event:<event_id>` и не пересекаются
с пресетами/кастомными темами.

Правила модели:
1. Ивент виден и применим только после проверенной загрузки в активном интервале `[start,end)`.
2. При первом появлении: preset → автоматический event с сохранением previous;
   custom → не менять, но пометить `auto_considered`, чтобы позднее не навязывать тему.
3. При ручном уходе с автоматически применённого ивента ставится постоянный блок для ID.
   Polling, restart и возврат часов назад не снимают блок. Ручной выбор ивента разрешён.
4. При выборе event вручную предыдущая custom/preset тоже сохраняется для возврата.
5. В конце интервала ивент убирается даже offline. Успешный `active_event:null` — отзыв;
   сетевой сбой — **не** отзыв. Смена ивентов восстанавливает исходную тему перед новой оценкой.
6. Блокировки хранятся до end + 30 дней; ID сервер не переиспользует. Серверное время
    корректирует локальные часы; `last_now` защищает от отката. Часы сервера должны быть точными.

Ручное намерение учитывается при поступлении, даже если tick ещё ждёт HTTP или
запись state.json. Если первая автоактивация ещё не опубликована, решение
откладывается до завершения ручного выбора без записи отказа и без `auto_considered`.
Переключение preset → preset до автоактивации не отклоняет кампанию; после
фактической автоактивации переход на другую тему блокирует только её `event_id`.
Обновление пакета, отзыв, expiry и стартовая нормализация ID — не ручной отказ.

Контроллер принимает необязательный порт `autoApply(): boolean | Promise<boolean>`
(по умолчанию true). Лаунчер читает настройку `autoApplyLiveOps` из своей БД перед
автоматическим решением, а при первом автоназначении — повторно после сохранения,
до публикации. Выключение автоматики не запрещает `select(event)`; уже рассмотренные
кампании не назначаются повторно при включении. Формат state.json остаётся v1.

## Подключение клиента к лаунчеру

Интеграция уже подключена в `electrobun/main/liveops.ts` и `liveops-runtime.ts`.
По умолчанию адрес — `https://liveops.xneon.org`; `XNLC_LIVEOPS_URL` переопределяет
его (HTTPS origin; для localhost допустим HTTP), пустая строка отключает сеть. Кэш восстанавливается до первого
рендера, запрос к серверу идёт в фоне; отключение контроллера зарегистрировано
через общий shutdown-барьер. `lib/liveops-theme-refs.ts` связывает id контроллера
и реестра; общие IPC-типы находятся в `@xnlc/types`.

Ниже — контракт портов клиента для других интеграций:

```javascript
import { createEventThemeController } from './client/controller.mjs'
import { createFileStorage } from './client/file-storage.mjs'

const controller = await createEventThemeController({
  baseURL: 'https://themes.example.org',
  storage: createFileStorage(eventCachePath),
  selected: { kind: 'preset', id: 'orange' }, // получить реальный выбор после гидратации БД
  exists: ref => registryContains(ref),
  apply: async (ref, eventTheme) => {
    // Собственный порт main → renderer: передать ref и проверенный eventTheme.
    // Renderer применяет applyTheme(eventTheme) либо найденную preset/custom тему.
    // Не вызывать saveLocalTheme/importLocalTheme для ивентов.
    await publishThemeSelection(ref, eventTheme)
  },
  onError: error => logLiveopsFailure(error)
})
await controller.tick() // также вызывать на resume/wake/network-online

// Все ручные клики, включая стандартные/кастомные, проходят через controller.select.
await controller.select({ kind: 'custom', id: 'custom-my-theme' })
const lists = controller.themes(presetThemes, customThemes)
// lists.standard = пресеты + ивент; lists.custom = только пользовательские темы.
// При выходе: controller.stop().
```

Функции `registryContains`, `publishThemeSelection`, `logLiveopsFailure` — порты интеграции,
не скрытые зависимости сервиса. Реестр `theme-store.ts` уже расширен отдельной
event-темой из настройки `eventTheme`, startup-fallback распознаёт `event:*`. Не копируйте
ивенты в customThemes ради обхода. Постоянный выбор и liveops-state должны согласовываться
через один владеющий контроллер; таймеры и ручной выбор сериализованы. Сначала сохраняется
состояние, потом вызывается apply, чтобы отказ не терялся при перезапуске.

Для всех условий без файлов/сети можно использовать напрямую `model.mjs`.
На клиенте сетевые обращения выполняются в main, CORS-настройка серверу не нужна.
На диске клиент хранит только текущий пакет (≤4 MB), state ≤128 KB и одну временную копию.

## Тесты

```bash
go test -cover ./...
go vet ./...
node --test client/model.test.mjs client/controller.test.mjs
```

Также работают под Bun 1.4.4. Тестируются A/Б/В, restart/offline, ручной выбор, отзыв,
границы start/end, квота, очистка, неизменяемость ID, SHA-256, ZIP traversal, запрет CSS/URL,
отсутствие перезаписи customThemes и сериализуемое состояние.
