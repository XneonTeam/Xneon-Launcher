# @xnlc/agent

Домен Xneon Agent без зависимости от Electron и React.

- `tools`: каталог инструментов, схемы, валидация и подключение групп.
- `runtime`: чат, контекст, вложения, интерактивные вопросы, подтверждения, отмена и прогресс.
- `launcher-tools`, `launcher-ipc-catalog`: доступ к публичному мосту лаунчера.
- `providers`, `protocol`, `model-config`: OpenAI, Anthropic, Gemini, Ollama, SSE и настройки моделей.
- `project-cards`, `project-details`: данные карточек и загрузка подробностей.
- `prompt`: системные инструкции агента.

Перед использованием инструментов и runtime приложение вызывает `configureAgentHost` из `@xnlc/agent/host`. Адаптер передаёт API, переводы, язык, события, настройки запуска и домен тем. Ключи и транспорт провайдеров обслуживает main-процесс; пакет не открывает файлы и соединения SQLite самостоятельно.

React-адаптер находится в `components/launcher/agent/store.ts`, настройка зависимостей — в `components/launcher/agent/host.ts`. Хранение и IPC-обработчики остаются в `electron/main/agent-workspace.ts`.

Сборка: `pnpm --filter @xnlc/agent run build`. Выпускаются ESM (`lib/`) и CommonJS (`lib-cjs/`) с общими TypeScript-декларациями. Лаунчер собирает пакет перед dev/build/package; `sync:xnlc` также его подключает и собирает.

Каталог IPC генерируется в `src/launcher-ipc-catalog.ts` скриптом лаунчера `scripts/gen-agent-ipc-catalog.mjs`. Готовый пакет использует сохранённый каталог и не требует исходников Electron.
