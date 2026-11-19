# Native production builds

Проект использует Bun **1.4.4**, Hutch **0.30.0**, Electrobun **2.0.7**, React 19.
Сборка выполняется на целевой ОС/архитектуре: renderer/typecheck не заменяют native build.

| Цель | Предпосылки / статус конфигурации |
|---|---|
| Windows x64 | WebView2, PowerShell/.NET Framework, NSIS 3; штатный SDK Setup ZIP + дополнительный NSIS |
| macOS arm64 | `macos-26` (arm64), Xcode CLI tools; vendored NFD arm64, WKWebView, SDK DMG |
| macOS x64 | `macos-15-intel`, native Intel runner; vendored NFD x64, WKWebView, SDK DMG |
| Linux x64 | glibc, GTK/WebKit/AppIndicator/libsecret, SDK CEF/native helpers; NFD x64, SDK Setup.tar.gz + deb/rpm/pacman/AppImage/tar.xz |
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

Релизные `release.yml`/`pre-release.yml` передают OAuth credentials из GitHub Secrets
в шаг `bun run build`/`build:canary`: `GOOGLE_DRIVE_CLIENT_ID/SECRET`,
`DROPBOX_CLIENT_ID`, `YANDEX_CLIENT_ID`, `ONEDRIVE_CLIENT_ID`,
`ELY_CLIENT_ID/SECRET/DEVICE_CLIENT_ID`, `XN_CLIENT_ID/SECRET`,
`MICROSOFT_CLIENT_ID`, `MICROSOFT_DEVICE_CLIENT_ID`. С
`XNLC_REQUIRE_CLOUD_CREDENTIALS=1` `gen-credentials.mjs` останавливает сборку, если
обязательное значение пустое, и печатает только имена переменных. XN Skins берёт
client_id из `electrobun/main/auth.ts`, поэтому пустые `XN_*` дают предупреждение,
а не ошибку.

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
исходные SDK manifests/tar.zst/installer; Windows NSIS добавляется отдельно в
обоих каналах и входит в подписанный манифест (`installer`), поэтому смена канала
в приложении проверяема.
Portable — отдельный dev build с `XNEON_BUILD_PORTABLE=1` и `PortableProfile`.
Native binary headers/version/resources/integrity проверяет artifact validator;
реальная установка, GUI, keyring/WebView/CEF и update lifecycle требуют OS/VM smoke.

`.github/workflows/ci.yml` выполняет только проверки; релизные пайплайны
`release.yml` (stable) и `pre-release.yml` (canary) содержат jobs
`tests → build / build-linux / build-macos → release`.
`tests` выполняет quality/offline gates один раз на Linux с timeout 15 минут.
Платформенные suites дополнительно исполняются на Windows и macOS arm64;
это запускает native cases, которые Linux корректно пропускает.
На tags и ручном запуске `build` собирает Windows x64 с NSIS из того же payload
и отдельный Portable, `build-linux` — Linux x64 (Setup.tar.gz + deb/rpm/pacman/AppImage/tar.xz),
`build-macos` — macOS arm64 DMG. Оба канала публикуют все три платформы; каждая
подписывает свой Manifest v1, `release` сливает подписанные каталоги в `update-verified`.
На обычном push main/PR дорогих сборок нет.
Setup/install переиспользуется через composite action; кешируется только Bun download cache,
не готовые binaries. Все build jobs работают с `fail-fast: false`.
macOS arm64 собирается на `macos-26`; нативные сборки идут только
на теге и ручном запуске, поэтому PR остаётся дешёвым.
`release` запускается только на version tag после tests и всей matrix: проверяет скачанные
artifacts, подписывает Windows feeds, сверяет trusted signatures/allowlist/SHA256,
генерирует описание через `scripts/release-notes.ts` (Features, Bug Fixes и значки загрузок
из allowlist текущего канала) и публикует. `-preN` — prerelease без latest, иначе stable.
Ручной запуск на ветке выдаёт unsigned artifacts, без release; на tag повторяет release.
Signing/publish не запускается при PR, обычном push или локальной сборке.
Environment `release-signing` должен разрешать защищённые version tags с approval;
сохраните в нём secret `XNLC_UPDATE_PRIVATE_KEY` и variable `XNLC_UPDATE_KEY_ID`.

**Идентичность репозитория сборки.** `owner/repo` берётся из `GITHUB_REPOSITORY`
(Actions), `XNLC_REPOSITORY` (явная локальная сборка) или git remote `origin`/`upstream`;
генератор `scripts/gen-repository-identity.ts` встраивает её в бандл, и из неё строятся
Stable/Canary URL, allowlist редиректов и ссылки в About. Поэтому форк собирает и
подписывает собственный фид без правок исходников, а runtime не зависит от Git.

**Ротация ключа подписи.** Доверие пинится в `electrobun/main/update-public-keys.ts`
и попадает в собранный бандл вместе с приложением: подпись проверяет *установленная*
сборка, а не CI. Поэтому новый ключ можно добавлять в реестр заранее, но переключать
`XNLC_UPDATE_KEY_ID` на него в CI — только после того, как на машинах пользователей
стоит сборка, которая этот ключ уже знает. Иначе клиенты, доверяющие лишь прежнему
ключу, отвергнут следующий релиз с `Unknown update signing key` и потеряют
автообновление. Прежние ключи остаются в реестре: они нужны для проверки уже
опубликованных манифестов.
В branch protection достаточно обязательного check `tests`.
Promotion старых runs и сценарные inputs удалены; используются только artifacts текущего run.
Build artifacts хранятся 7 дней. Timeout 15 минут относится к тестам, не ко всей native сборке.
Уже существующий GitHub Release не перезаписывается: его посторонние assets не удаляются.
Фактическую проверку платформы подтверждают логи соответствующего CI run;
само наличие target в матрице не означает успешную сборку или GUI/VM smoke.
