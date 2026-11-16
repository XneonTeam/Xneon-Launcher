# infrastructure — самостоятельные серверные приложения

Здесь лежат приложения, которые обслуживают лаунчер по сети и не являются его
клиентскими библиотеками. Код клиента (React/renderer, main-процесс Electrobun,
пакеты `@xnlc/*`) остаётся в корне репозитория и в `packages/`; `infrastructure/`
не импортируется клиентом как серверный код: main использует только отдельный
LiveOps-клиент из `xnlc-liveops/client/`; тест Share импортирует сервер (см. ниже).

## Состав

| Каталог | Что это | Стек | npm-пакет |
| --- | --- | --- | --- |
| `xnlc-share/` | XNLC/Share — сервис общих сборок: авторизация устройства, публикации, коммиты/ветки/участники, приглашения, объекты по SHA-256 | Bun 1.4.4 + `bun:sqlite` локально; Cloudflare Worker, Durable Object (SQLite) и R2 в production | нет своего `package.json` (не Bun-workspace) |
| `xnlc-liveops/` | Ивентовые темы — HTTP-сервис расписания ивентов, JSON-каталог, admin CLI, плюс клиентский контроллер для main-процесса | Go 1.26+, только стандартная библиотека; клиент — чистый ESM без зависимостей | нет (Go-модуль `xneon/liveops-themes`) |

Оба каталога сохраняют внутреннюю структуру прежних `services/share` и
`services/liveops-themes`: относительные пути внутри приложений не менялись,
поэтому импорты, `go.mod`, `wrangler.jsonc` и конфиги работают как раньше.

Dockerfile/`docker-compose` в репозитории нет ни для одного сервиса: Share
разворачивается Wrangler'ом (Worker) или отдельным Bun-процессом, liveops —
статическим бинарником рядом с JSON-каталогом.

## Локальный запуск

Share (из корня репозитория):

```powershell
bun install --frozen-lockfile
Copy-Item infrastructure/xnlc-share/.env.example infrastructure/xnlc-share/.env
bun run share:server          # http://127.0.0.1:8787
```

Переменные: `SHARE_HOST`, `SHARE_PORT`, `SHARE_DATA_DIR` (по умолчанию
`.share-data`), `SHARE_BOOTSTRAP`. Подробности и пользовательский сценарий —
`xnlc-share/README.md`. Для одновременного запуска сервиса и dev-лаунчера —
`bun run dev:share` (лаунчер получает `XNLC_SHARE_URL=http://127.0.0.1:8787`).

Liveops (из каталога сервиса):

```powershell
cd infrastructure/xnlc-liveops
go run . serve --listen 127.0.0.1:8091 --public-url http://127.0.0.1:8091
```

Полный контракт сервиса, квоты диска и admin CLI — `xnlc-liveops/README.md`.

## Сборка

- Share: `bun run build:share` собирает клиентские workspace-пакеты, которые
  использует сервис (`@xnlc/archives`, `@xnlc/share`, `@xnlc/types`); сам сервер
  запускается как `.mjs` без бандла. Worker собирается Wrangler'ом при
  `share:worker:dev` / `share:worker:deploy`.
- Liveops: `cd infrastructure/xnlc-liveops && go build -trimpath -ldflags="-s -w"
  -o deploy/themesvc .` (Windows — `themesvc.exe`). `deploy/` создаётся при сборке
  и не версионируется.
- Корневая сборка лаунчера (`bun run build`) сервисы не собирает и не требует
  Go toolchain.

## Тесты

| Команда | Что проверяет |
| --- | --- |
| `bun run share:test` | доменные тесты `@xnlc/share` + HTTP/suite сервиса (`infrastructure/xnlc-share/tests/*.test.mjs`) |
| `bun run share:test:live` | живой Modrinth API (сеть, отдельный target) |
| `bun run share:worker:smoke -- <url>` | развёрнутый Worker: Ed25519-вход, права, R2, приглашения |
| `bun run liveops:test` | `go test ./...` в `infrastructure/xnlc-liveops` |
| `bun run test:offline` | включает Share, `liveops-client` и интеграционные тесты адаптера лаунчера |

Liveops дополнительно: `go vet ./...` и
`node --test client/model.test.mjs client/controller.test.mjs` из каталога
сервиса. Клиентские тесты входят в root offline-gate и запускаются под Bun;
серверные Go-тесты запускаются отдельно через `liveops:test`.

## LiveOps в лаунчере

- `electrobun/main/liveops.ts` запускает контроллер после открытия БД, до первого
  рендера восстанавливает проверенный диск-кэш без сетевого ожидания, затем
  проверяет `/v1/events/current` в фоне. Таймер контроллера учитывает `end_date`.
- Для подключения задайте `XNLC_LIVEOPS_URL` — origin сервиса (HTTPS; HTTP
  разрешён только для localhost). Например, для локального сервера выше:
  `$env:XNLC_LIVEOPS_URL='http://127.0.0.1:8091'` перед `bun run dev`.
  Без переменной сетевой клиент выключен, обычные темы работают как раньше.
- Кэш: `<userData>/event-theme-cache/`; настройка `eventTheme` содержит проверенную
  тему, `theme` — текущий id. Событийный id имеет вид `event:<event_id>`.
  Ивенты не записываются в `customThemes` и пользовательскую папку CSS-тем.
- Ручной выбор идёт через `liveops:select` (включая `settings:set("theme")`),
  чтобы отказ от авто-ивента переживал polling и перезапуск. При завершении
  восстанавливается предыдущая тема; удалённая своя тема заменяется на Core.
- Ожидающий ручной выбор откладывает первое автоназначение, а не отклоняет
  кампанию. Правило действует во время HTTP-запроса и записи state.json.
- В «Готовых темах» есть глобальный переключатель `autoApplyLiveOps` (обычная
  настройка, отсутствие значения = true). Выключение не снимает уже выбранную
  тему и не скрывает ивенты; ручная активация остаётся доступной. Уже рассмотренная
  кампания не назначается повторно после включения переключателя.
- Реестр renderer показывает ивент рядом с готовыми темами с бейджем «Событие».
  `liveops:status` возвращает состояние интеграции; cleanup использует общий
  `registerShutdownTask`, без собственного обработчика выхода.

## Деплой

- Share Worker: `bun run share:worker:deploy` (Wrangler 4.160.0, конфиг
  `infrastructure/xnlc-share/wrangler.jsonc`). Перенос локальной БД — по
  `xnlc-share/WORKERS.md` (`worker/export-local.mjs` → `initial-data.mjs`).
- Share как отдельный процесс: постоянный том `SHARE_DATA_DIR`, HTTPS reverse
  proxy перед Bun-сервером.
- Liveops: бинарник кладётся в собственный root (например `deploy/`), рядом
  создаются `admin.token` и `data/catalog.json`; бюджет каталога — строго
  100 000 000 байт.

## Клиентские пакеты и общие контракты

- `packages/xnlc-share` — клиентская библиотека Share для лаунчера (домен, HTTP
  клиент, remote-серверы). Остаётся в `packages/`, серверный код в неё не входит.
- `packages/xnlc-*` — остальные клиентские/доменные пакеты (`core`, `types`,
  `mods`, `nbt`, `parser`, `archives`, `servers`, `skins`, `agent`), Bun
  workspace `packages/*`.
- `infrastructure/xnlc-share/` содержит только сервер; клиентских файлов там нет.
- `infrastructure/xnlc-liveops/client/*.mjs` — клиентский контроллер, физически
  лежащий рядом с сервером (так было и до миграции). Подключён только из main,
  не является npm-пакетом; renderer не импортирует клиент или сервер.
- Общие типы и IPC-контракты остаются в `packages/xnlc-types`
  (`ipc-contracts.ts`, `laby.ts`, `launch-types.ts`); серверных дублей нет.
- Единственный импорт серверной реализации из кода лаунчера — тест
  `tests/electrobun/share-workflows.test.ts`, импортирующий
  `infrastructure/xnlc-share/server.mjs`.

Внутренние исторические документы в локальной `.local-research/` описывают раскладку до миграции
(`services/...`); они оставлены как есть и не являются актуальной картой путей.
