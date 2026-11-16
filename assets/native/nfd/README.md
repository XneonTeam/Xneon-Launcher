# Нативные диалоги сохранения

Бинарники `nativefiledialog-extended` из релиза `nativefiledialog-for-bun@0.3.2`
хранятся в Git: установка зависимостей и сборка не скачивают их с GitHub.
`manifest.json` содержит исходные имена и SHA-256, сверенные с метаданными релиза.

Electrobun копирует этот каталог в `Resources/app/native/nfd` (на macOS —
`Contents/Resources/app/native/nfd`). При запуске исходников адаптер использует
этот каталог в репозитории, а при запуске бандла — только его упакованную копию.

Имена macOS/Linux намеренно изменены на `libnfd.dylib` и `libnfd.so`:
именно их ожидает FFI-загрузчик пакета 0.3.2. На Windows имя — `nfd.dll`.
При отсутствии файла или выборе скриптового бэкенда адаптер завершает запрос
ошибкой, не запуская PowerShell/osascript/zenity.

Обновление: скачать четыре артефакта нового закреплённого релиза, сверить SHA-256,
обновить бинарники и манифест, затем выполнить suite `platform-desktop.test.ts`.
Не добавлять пакет в `trustedDependencies` и не запускать его `postinstall`.

Проверки из корня проекта:

```bash
bun test tests/electrobun/platform-desktop.test.ts
bun tests/electrobun/native-save-dialog.smoke.mjs "./nfd-smoke.zip"
```

GUI-smoke использует настоящий адаптер: вручную подтвердите путь и проверьте
напечатанный результат, затем повторите команду с отменой (результат `null`).
Архив не создаётся, пользовательская БД не открывается. Автоматизация Windows
UI Automation удалена; headless Linux CI выполняет тесты адаптера без GUI.
Бэкенд Linux требует установленный GTK3; библиотек для Linux/Windows arm64
в этом релизе нет — неподдерживаемая архитектура завершается явной ошибкой.
