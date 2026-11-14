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
обновить бинарники и манифест, затем выполнить тесты `native-save-dialog.test.mjs`.
Не добавлять пакет в `trustedDependencies` и не запускать его `postinstall`.

Проверки из корня проекта:

```powershell
bun test tests/electrobun/native-save-dialog.test.mjs
powershell.exe -NoProfile -File tests/electrobun/native-save-dialog.smoke.ps1 -BunExecutable .hutch/toolchain-home/toolchains/bun/1.4.4/windows-x64/bun.exe
```

GUI-smoke использует настоящий адаптер и UI Automation, проверяет выбор пути и
отмену, не создаёт экспортируемый архив и не открывает пользовательскую БД.
Для проверки бандла передайте его `bin/bun.exe`: библиотека должна загружаться
из соседнего `Resources/app/native/nfd`, а не из репозитория.
Бэкенд Linux требует установленный GTK3; библиотек для Linux/Windows arm64
в этом релизе нет — неподдерживаемая архитектура завершается явной ошибкой.
