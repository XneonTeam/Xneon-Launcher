# Проверки Xneon

Нужен проектный Bun **1.4.4**. При clean checkout сначала:

```bash
bun install --frozen-lockfile
bun run test:prepare
bun run typecheck
bun run test:offline:prepared
```

`test:prepare` готовит devkit, generated inputs, 10 workspace-пакетов и CJS
test-транспиляцию main. `test:offline:prepared` не собирает их повторно и запускает
группы в отдельных процессах, чтобы mocks/SQLite/FFI не загрязняли соседние suites.
Ошибка группы останавливает gate; tests не исключаются ради зелёного результата.
Workspace build уже выполняет `tsc -p tsconfig.json` для каждого пакета, поэтому
после prepare отдельный `typecheck:workspaces` не нужен. Команда сохранена для
самостоятельной диагностики без сборки; CI проверяет этот контракт всех workspace manifests.
`typecheck` проверяет renderer и main вместе со всеми TypeScript-скриптами `scripts/`.
В CI актуальность IPC-каталога проверяется **до** prepare, чтобы генерация не скрывала drift.

## Группы

| Группа | Назначение / путь |
|---|---|
| desktop | tests/electrobun: accounts/auth, SQLite, IPC, Java/launch, networking, platform, renderer и lifecycle |
| parser-unit | метаданные, архивы, image/classfile/datapack, dependency assertions |
| parser-integration | cache/worker/launcher scan contracts |
| archives | ZIP Core, path/CRC/limits/atomicity/cancellation |
| security-agent | permission/approval, MCP contracts, AI tools и redaction |
| share-domain | manifests/history/permissions/merge/transfers |
| share-service | localhost HTTP, DB/storage, incremental persistence, body queues |
| liveops-client | themes/package validation, state/manual-vs-auto races |
| tooling | test discovery, pipeline/artifact/config и repository hygiene |

Состав parser suites задаёт `scripts/test-parser.mjs`. Discovery проверяет, что
каждый JS/TS test/spec-файл относится ровно к одной группе либо явному live набору.
OS guards разрешены только для реально неподходящей платформы; Windows не доказывает
Unix FFI, а test mocks не заменяют runtime executable smoke.
На Windows/macOS build runners дополнительно запускаются платформенные suites;
Windows также выполняет проверку изменения ресурсов настоящего PE. Linux-native
сценарии выполняются в основном `tests` job; ELF/DMG/NSIS остаются в native build jobs.

## Дополнительные проверки

- `bun run liveops:test`: Go tests самостоятельного сервиса, нужен Go 1.26+.
- `bun run test:live`: opt-in реальные parser artifacts по зафиксированным hashes;
  `XNLC_PARSER_LIVE_TESTS=1`. Требует сеть, не является offline gate.
- Share Worker smoke/live Modrinth, native dialog/GUI/update/install VM checks
  требуют выделенной среды и запускаются отдельно. Не использовать рабочий профиль.
- [Production platform builds](platform-builds.md), [benchmarks](../benchmarks/README.md).

Падающий тест сначала классифицируется: runtime regression или устаревший test
harness/contract. В последнем случае сохраняются сценарии/assertions и обновляются
зависимости mock-портов/проверяемая политика; не отключается проверка.
