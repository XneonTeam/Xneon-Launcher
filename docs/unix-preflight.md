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
- `unix-native-preflight.ts` требует bundled `libcef.so` ELF64 x64, Chromium
  resources и locales по путям, используемым SDK, executable permissions и
  отсутствие unresolved зависимостей `ldd`. Наличие WebKitGTK среди связанных
  библиотек SDK не означает, что webview использует WebKit.
- `smoke-linux-cef.ts` запускает **собранный** launcher под Xvfb. Через поддержанный
  SDK параметр окружения `ELECTROBUN_CEF_REMOTE_DEBUGGING_PORT` проверяет Chromium
  CDP, packaged `views://launcher` страницу, React DOM и вызов renderer → main
  `getSettings`. Дополнительно требует загруженную bundled `libcef.so` в `/proc`.
  Сохраняет screenshot, JSON и лог; таймаут/ошибка не превращаются в успех.
- macOS: нативный `macos-26` arm64, Mach-O launcher/bun и CFBundleExecutable,
  `lipo`, структура `.app`, `otool -L`, `hdiutil verify`. Дополнительный ZIP
  создаётся `ditto --keepParent` из `.app` с сохранением прав и симлинков.
- Дополнительные файлы получают SHA256SUMS и отчёт с явными `e2e: not-run` и
  `updates: not-run`. Linux smoke имеет отдельный отчёт: прохождение smoke не
  означает прохождение установки или обновлений.

## Почему публикация закрыта

1. Приложение и Ed25519 verifier принимают только `win-x64`. Нельзя включать
   Unix, обходя проверку подписи или переключаясь на неподписанный SDK feed.
2. Linux-пакеты устанавливаются в `/opt/xneon-launcher`; Electrobun 2.0.6
   `resolveInstalledChannelRootForPlatform` отвергает обновление вне управляемого
   каталога. Для read-only AppImage проблема также не решена. Нужен отдельный
   проверенный контракт обновления системных пакетов, а не запись поверх `/opt`.
3. Не выполнены install/uninstall и запуск установленных DEB/RPM/Pacman, запуск
   AppImage и macOS UI/IPC из DMG/ZIP, применение двух последовательных подписанных
   обновлений и смена каналов на Unix.
4. macOS codesign/notarization и проверка Gatekeeper не настроены. Проверка DMG
   и Mach-O не является подтверждением успешного запуска на пользовательском Mac.

Локально на Windows Unix jobs не выполняются. Для результатов нужен настоящий
прогон GitHub Actions; запуск workflow и публикация требуют отдельного действия
владельца. До завершения этих пунктов не переносить Unix в `targets` публикации
`scripts/ci-pipeline.ts` и не называть кандидаты production-ready.
