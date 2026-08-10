<p align="center">
  <a href="https://launcher.xneon.org" target="_blank">
    <img alt="Xneon Launcher" width="120" src="https://launcher.xneon.org/icon.png">
  </a>
</p>

<h1 align="center">Xneon Launcher</h1>

<p align="center">
  <a href="https://github.com/MAINER4IK/xnlauncher/releases/latest">
    <img src="https://img.shields.io/github/v/release/MAINER4IK/xnlauncher?style=flat-square&color=f97316" alt="Version">
  </a>
  <a href="https://github.com/MAINER4IK/xnlauncher/blob/main/LICENSE">
    <img src="https://img.shields.io/badge/license-GPL--3.0-blue?style=flat-square" alt="License">
  </a>
  <img src="https://img.shields.io/badge/Electron-35-47848F?style=flat-square&logo=electron" alt="Electron">
  <img src="https://img.shields.io/badge/React-19-61DAFB?style=flat-square&logo=react" alt="React">
  <br>
  <img src="https://img.shields.io/badge/Windows-0078D4?style=flat-square&logo=windows" alt="Windows">
  <img src="https://img.shields.io/badge/macOS-000000?style=flat-square&logo=apple" alt="macOS">
  <img src="https://img.shields.io/badge/Linux-FCC624?style=flat-square&logo=linux" alt="Linux">
</p>

<p align="center">
  <strong>Xneon Launcher</strong> — современный лаунчер для Minecraft с открытым исходным кодом. Быстрый, гибкий, с поддержкой импорта сборок из других лаунчеров и облачным хранением.
</p>

## Features

- 🚀 **Запуск Minecraft** — поддержка Vanilla, Fabric, Quilt, Forge, NeoForge с любыми версиями
- 📦 **Импорт из других лаунчеров** — Prism Launcher, MultiMC, PolyMC, GDLauncher, XMCL, Modrinth App, AstralRinth
- 🌐 **Облачное хранение** — синхронизация сборок, модов и настроек между устройствами
- 🎮 **Игра с друзьями** — P2P-lobby для совместной игры в Minecraft: создание комнат, чат, приглашение игроков
- 📥 **Modrinth & CurseForge** — встроенный поиск, установка и обновление модов и модпаков
- 🗂 **Управление сборками** — изолированные профили с собственными модами, ресурспаками и шейдерами
- 🔐 **Аккаунты** — поддержка Microsoft, Ely.by, XNSkins и оффлайн-режима
- 🧵 **RetroAuth / Authlib Injector** — встроенная поддержка альтернативной авторизации
- ⚙️ **Гибкие настройки** — управление Java, памятью, аргументами запуска
- 🌍 **Мультиязычность** — русский, английский, украинский, немецкий, испанский
- 🎨 **Кастомизация** — темная/светлая тема, настраиваемый интерфейс

## Скриншоты

![Главный экран](https://launcher.xneon.org/screenshots/home.png)
*Главный экран с библиотекой сборок*

## Быстрый старт

```bash
# Установка зависимостей
npm install

# Запуск в режиме разработки (Vite + Electron)
npm run dev

# Сборка production-версии
npm run build

# Упаковка в дистрибутив (electron-builder)
npm run package
```

## Импорт из других лаунчеров

XNeon автоматически обнаружит установленные сборки из:

| Лаунчер | Windows | macOS | Linux |
|---------|---------|-------|-------|
| Prism Launcher | `%APPDATA%\PrismLauncher\instances` | `~/Library/Application Support/PrismLauncher` | `~/.local/share/PrismLauncher` |
| MultiMC | `%APPDATA%\MultiMC\instances` | `~/Library/Application Support/multimc` | `~/.local/share/MultiMC` |
| PolyMC | `%APPDATA%\PolyMC\instances` | `~/Library/Application Support/PolyMC` | `~/.local/share/PolyMC` |
| GDLauncher Carbon | `%APPDATA%\gdlauncher_carbon\data\instances` | `~/Library/Application Support/gdlauncher_carbon/data/instances` | `~/.local/share/gdlauncher_carbon` |
| XMCL / X Launcher | `~\.minecraftx\instances` | `~/Library/Application Support/{xmcl,.minecraftx}/instances` | `~/.minecraftx/instances` |
| Modrinth App | `%APPDATA%\ModrinthApp\profiles` | `~/Library/Application Support/ModrinthApp` | `~/.local/share/ModrinthApp` |
| AstralRinth | `%APPDATA%\AstralRinthApp\profiles` | `~/Library/Application Support/AstralRinthApp` | `~/.local/share/AstralRinthApp` |

## Разработка

### Архитектура

Проект состоит из двух частей:

- **Renderer** (`src/`) — интерфейс на React 19 + Vite 6 + Tailwind 4 + shadcn/ui
- **Electron main** (`electron/`) — системные вызовы, запуск Minecraft через forked worker, IPC-обработчики

Локальные пакеты в `packages/`:
- `@xnlc/core` — запуск Minecraft
- `@xnlc/mods` — работа с Modrinth / CurseForge API
- `@xnlc/types` — общие TypeScript-типы

### Команды

```bash
npm run dev           # Vite + Electron с hot-reload
npm run build         # production-сборка
npm run package       # electron-builder → release/
npm run lint          # проверить код
```

### Структура

```
components/launcher/   # UI-компоненты (страницы, модалки, настройки)
electron/main/         # Электрон main process
electron/preload.ts    # Preload-скрипт (IPC-мост)
packages/              # Локальные npm-пакеты
src/                   # Точка входа renderer, i18n, контексты
public/                # Статические файлы, иконки лаунчеров
```

## Лицензия

[GPL-3.0](LICENSE)

## Благодарности

- [Prism Launcher](https://prismlauncher.org/) — за вдохновение в области управления инстансами
- [X Minecraft Launcher](https://xmcl.app) — за отличный пример Electron-лаунчера
- [Modrinth](https://modrinth.com) и [CurseForge](https://curseforge.com) — за API для модов
- [shadcn/ui](https://ui.shadcn.com) — за компоненты интерфейса
- [Tabler Icons](https://tabler-icons.io) — за иконки
