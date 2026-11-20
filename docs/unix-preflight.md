# Linux x64 и macOS ARM64: нативный preflight

Unix **ещё не включён в автоматическую публикацию релизов**. Stable и canary
по-прежнему публикуют проверенные Windows x64 NSIS/Portable и подписанный feed.
Новые проверки запускаются через `workflow_dispatch` в тех же `release.yml` и
`pre-release.yml`. Это кандидаты для проверки, а не готовые production-релизы.

## Что проверяется

- Linux: нативный `ubuntu-24.04` x64, существующая сборка Electrobun и упаковка
  AppImage/DEB/RPM/Pacman/TAR.XZ. SDK manifests и архив проверяет прежний validator.
- CEF: реальные параметры Electrobun 2.0.6 — `build.linux.bundleCEF: true` и
  `defaultRenderer: "cef"`. Главное окно также явно выбирает `cef`.
- Hutch закреплён на 0.30.0, Electrobun остаётся 2.0.6. Адаптер проверяет
  `checksum.json` по распакованному tar и добавляет совместимый `update-v2.json`;
  исходные archive/update/checksum bytes не меняются. Проверяется payload
  проверенного update archive, а не installer wrapper из build-каталога.
- `unix-native-preflight.ts` требует bundled `libcef.so` ELF64 x64, Chromium
  resources, snapshot, `bun Helper`, locales и безопасные symlink aliases по
  путям SDK, executable permissions и отсутствие unresolved зависимостей `ldd`.
  Все обычные ELF-файлы обнаруживаются по magic, проверяются ABI ceilings
  Ubuntu 24.04 (GLIBC 2.39, GLIBCXX 3.4.32, CXXABI 1.3.14).
  Наличие WebKitGTK среди связанных
  библиотек SDK не означает, что webview использует WebKit.
- Linux GUI smoke исключён из обоих CI workflows по решению владельца:
  launcher под Xvfb не запускается, Xvfb/xauth для него не устанавливаются.
  `smoke-linux-cef.ts` сохранён как необязательный ручной инструмент.
  Сборка, проверка артефактов/CEF/ABI и упаковка пяти форматов остаются;
  их успех не означает успешный GUI E2E.
- macOS: нативный `macos-26` arm64, Mach-O launcher/bun и CFBundleExecutable,
  `lipo`, структура `.app`, `otool -L`, `hdiutil verify`. Дополнительный ZIP
  создаётся `ditto --keepParent` из `.app` с сохранением прав и симлинков.
  Для direct-payload DMG и ZIP предусмотрены два запуска, настоящий React/IPC,
  программный клик по настройкам, screenshot и отдельный Gatekeeper assessment.
  Это не проверка мыши и не воспроизведение browser-download quarantine.
- Дополнительные файлы получают SHA256SUMS и отчёт с явными `e2e: not-run` и
  `updates: not-run`. Успешная упаковка не означает прохождение установки,
  GUI-проверок или обновлений.

## Почему публикация закрыта

1. Приложение и Ed25519 verifier принимают только `win-x64`. Нельзя включать
   Unix, обходя проверку подписи или переключаясь на неподписанный SDK feed.
2. Linux-пакеты устанавливаются в `/opt/xneon-launcher`; Electrobun 2.0.6
   `resolveInstalledChannelRootForPlatform` отвергает обновление вне управляемого
   каталога. Для read-only AppImage проблема также не решена. Нужен отдельный
   проверенный контракт обновления системных пакетов, а не запись поверх `/opt`.
3. Нужны реальные install/uninstall/upgrade и запуск установленных
   DEB/RPM/Pacman/AppImage/TAR.XZ, применение двух последовательных подписанных
   обновлений и смена каналов на Unix. Наличие smoke-скрипта не означает его PASS.
4. macOS намеренно распространяется без Developer ID и нотариализации; платная
   Apple Developer Program не требуется. Ограничения и безопасное разрешение
   первого запуска описаны в [macos-first-launch.md](macos-first-launch.md).
   CI не доказывает прохождение Gatekeeper для скачанного пользователем файла.

Локально на Windows Unix jobs не выполняются. Для результатов нужен настоящий
прогон GitHub Actions. Ручной dispatch не публикует релиз; публикация требует
отдельного разрешения. До завершения этих пунктов не переносить Unix в `targets` публикации
`scripts/ci-pipeline.ts` и не называть кандидаты production-ready.
