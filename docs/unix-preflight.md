# Linux x64 и macOS ARM64: нативная сборка и публикация

Unix включён в автоматическую публикацию обоих каналов: stable и canary публикуют
проверенный Windows x64 NSIS/Portable, Linux x64 и macOS arm64 с подписанным feed.
`build`, `build-linux` и `build-macos` — отдельные задания; они запускаются на теге
и на `workflow_dispatch`, а публикует только job `release` и только по тегу.
Кандидаты с ручного запуска остаются артефактами CI и не создают релиз.

Списки шагов разделены по ОС: `Windows build (win-x64)`, `Linux build (x64)`
и `macOS build (ARM64)` — отдельные задания. Шаги чужих платформ в них
не отображаются даже как пропущенные. Общий `tests` остаётся отдельным заданием.

## Что проверяется

- Linux: нативный `ubuntu-24.04` x64, существующая сборка Electrobun и упаковка
  AppImage/DEB/RPM/Pacman/TAR.XZ. SDK manifests и архив проверяет прежний validator.
  Подписанный feed собирается тем же единым Manifest v1 и signer, что у Windows.
- CEF: реальные параметры Electrobun 2.0.7 — `build.linux.bundleCEF: true` и
  `defaultRenderer: "cef"`. Главное окно также явно выбирает `cef`.
- Hutch закреплён на 0.30.0, Electrobun — на 2.0.7. Адаптер проверяет
  `checksum.json` по распакованному tar и добавляет совместимый `update-v2.json`;
  исходные archive/update/checksum bytes не меняются. Оба native-манифеста уже
  schemaVersion 1; публикуемый подписанный документ — тот же v1 под каноническим
  именем `<channel>-<platform>-<arch>-update.json` и байт-идентичным v2-алиасом.
  Проверяется payload проверенного update archive, а не installer wrapper из build-каталога.
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

## Что остаётся ручной проверкой

CI доказывает сборку, целостность архива, формат Manifest v1, Ed25519-подпись и
точные байты публикации. Он **не** доказывает установку и применение обновлений.

1. Платформенные updater-ы разные: Windows ставит подписанный NSIS через SDK,
   Unix — transactional helper. Общая у них только схема Manifest v1 и Ed25519,
   поэтому E2E нужен отдельно для каждой ОС.
2. Linux-пакеты устанавливаются в `/opt/xneon-launcher`; Electrobun 2.0.7
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
прогон GitHub Actions. Публикация по-прежнему требует тега и защищённого
`environment: release-signing`; успешный `workflow_dispatch` ничего не публикует.
Зелёный CI не заменяет перечисленные выше E2E-проверки и не делает Unix-кандидаты
production-ready сам по себе.
