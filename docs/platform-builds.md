# Native production builds

Проект использует Bun **1.4.4**, Hutch **0.29.0**, Electrobun **2.0.6**, React 19.
Сборка выполняется на целевой ОС/архитектуре: renderer/typecheck не заменяют native build.

| Цель | Предпосылки / статус конфигурации |
|---|---|
| Windows x64 | WebView2, PowerShell/.NET Framework, NSIS 3; штатный SDK Setup ZIP + дополнительный NSIS |
| macOS arm64 | native arm64 macOS runner, Xcode CLI tools; vendored NFD arm64, WKWebView, SDK DMG |
| macOS x64 | native Intel macOS runner; vendored NFD x64, WKWebView, SDK DMG |
| Linux x64 | glibc, GTK/WebKit/AppIndicator/libsecret, SDK CEF/native helpers; NFD x64, SDK Setup.tar.gz |
| Windows arm64 | **Не заявлена**: текущие Windows packaging/PE checks и набор NFD привязаны к x64 |
| Linux arm64 | **Не заявлена**: отсутствует NFD arm64; нельзя считать наличие Bun backend поддержкой приложения |

## Общие команды на native runner

```bash
bun install --frozen-lockfile
bun scripts/gen-agent-ipc-catalog.mjs --check
bun run build
bun scripts/build-electrobun-tests.mjs
bun run test:offline:prepared
```

`build` один раз выполняет prepare, workspace typechecks/builds, общий typecheck
(renderer/main/TypeScript scripts), renderer/workers и native упаковку. Повторять
эти этапы перед ним не нужно. В CI общие gates идут до дорогой native matrix.

Для проверочной сборки без локальных OAuth credentials установите
`BUN_OPTIONS=--no-env-file`, `XNLC_SKIP_LOCAL_DOTENV=1` и удалите соответствующие
credentials из окружения процесса сборки. Не переносите `.env`/БД/профили в artifacts.

Windows: `makensis` в PATH или `XNEON_MAKENSIS`. Linux Ubuntu 24.04 prerequisites:
`libgtk-3-dev libwebkit2gtk-4.1-dev libayatana-appindicator3-dev libsecret-1-0 binutils zstd`.
Не используйте Windows host для заявления о production-поддержке Linux/macOS.

## Проверка release files

```bash
# Windows x64
bun scripts/electrobun-artifacts.ts check release-electrobun/stable win x64 stable --nsis
# macOS Apple Silicon; для Intel arch=x64
bun scripts/electrobun-artifacts.ts check release-electrobun/stable macos arm64 stable
# Linux x64
bun scripts/electrobun-artifacts.ts check release-electrobun/stable linux x64 stable
```

`build-electrobun/` и `release-electrobun/` игнорируются Git. В релизе сохраняются
исходные SDK manifests/tar.zst/installer; Windows NSIS добавляется отдельно.
Portable — отдельный dev build с `XNEON_BUILD_PORTABLE=1` и `PortableProfile`.
Native binary headers/version/resources/integrity проверяет artifact validator;
реальная установка, GUI, keyring/WebView/CEF требуют OS/VM smoke.

Единый `.github/workflows/ci.yml` содержит три jobs: `tests → build → release`.
`tests` выполняет quality/offline gates один раз на Linux с timeout 15 минут.
Платформенные suites дополнительно исполняются на Windows и обеих macOS архитектурах;
это запускает native cases, которые Linux корректно пропускает.
На tags `v*` и ручном запуске `build` использует native matrix
Windows x64, Linux x64, macOS arm64/x64. Windows job собирает NSIS из того же stable
payload, Canary и отдельный Portable. На обычном push main/PR дорогих сборок нет.
Setup/install переиспользуется через composite action; кешируется только Bun download cache,
не готовые binaries. Все build targets работают с `fail-fast: false`, `max-parallel: 3`.
`release` запускается только на version tag после tests и всей matrix: проверяет скачанные
artifacts, сверяет allowlist/SHA256,
генерирует git-cliff changelog и публикует. `-preN` — prerelease без latest, иначе stable.
Ручной запуск на ветке выдаёт unsigned artifacts, без release; на tag повторяет release.
В branch protection достаточно обязательного check `tests`.
Promotion старых runs и сценарные inputs удалены; используются только artifacts текущего run.
Build artifacts хранятся 7 дней. Timeout 15 минут относится к тестам, не ко всей native сборке.
Уже существующий GitHub Release не перезаписывается: его посторонние assets не удаляются.
Фактическую проверку платформы подтверждают логи соответствующего CI run;
само наличие target в матрице не означает успешную сборку или GUI/VM smoke.
