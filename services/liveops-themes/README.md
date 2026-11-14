# Ивентовые темы Xneon — отдельный микросервис

Самостоятельный проект: **Go 1.26+, только стандартная библиотека**, один бинарник,
JSON-каталог, до 32 запланированных ивентов. На сервере не нужны Go, Node, Bun,
SQLite, npm/pip или контейнер. Go нужен только на машине сборки. Клиентский код
работает в основном процессе Bun/Node, использует встроенные API и не требует зависимостей.

**Существующий лаунчер не изменён:** здесь готовый HTTP-сервис, клиентский контроллер,
порты хранения/применения и тесты. Подключение к React-реестру тем выполняется отдельно;
никаких скрытых записей в `customThemes` или пользовательские CSS-файлы нет.

## Структура

```text
liveops-themes/
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

Загрузка JSON-пакета (команда сама читает токен из файла):

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

`examples/winter.json` — готовый пакет. ZIP содержит `theme.json` **с самим объектом theme**
(не envelope) и `assets/<имя>.png|jpg|jpeg|gif|webp`; фон ссылается на `assets/<имя>`.
Ассеты в JSON-пакете: `{name, media_type, data_base64}`; сервер и клиент проверяют лимиты.

Поддержаны 20 цветов палитры лаунчера, primary/accent, glow, background image/particles/halo.
Не принимаются произвольный CSS/readerCss/JS, SVG, HTML, внешние URL, локальные пути,
произвольные шрифты/видео. Это **отдельный минимальный live-ops формат**, не автоматический
импорт старого `.xntheme`: существующий импорт делает `custom: true`, что здесь неверно.
Растровые изображения всё равно считаются недоверенными данными для декодера браузера.

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

## Подключение клиента к лаунчеру

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
не скрытые зависимости сервиса. Реестр `theme-store.ts` потребуется расширить отдельной
event-коллекцией, иначе существующий startup-fallback не узнает `event:*`. Не копируйте
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
