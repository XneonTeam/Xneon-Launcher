# @xnlc/mods

XNLC Mods — клиент API Modrinth и CurseForge для поиска и управления модами Minecraft.

## Установка

```bash
npm install @xnlc/mods
```

## Возможности

- 🔍 Поиск модов на Modrinth и CurseForge
- 📋 Получение версий модов для конкретной версии Minecraft
- ⭐ Получение популярных и избранных модов
- 🏷️ Фильтрация по категориям и загрузчикам

## Использование

```typescript
import { ModrinthClient, CurseForgeClient } from '@xnlc/mods';

const modrinth = new ModrinthClient();

// Поиск модов
const results = await modrinth.search({ query: 'sodium', gameVersion: '1.20.4' });

// Получить версии мода
const versions = await modrinth.getVersions('mod-id');
```

## Лицензия

MIT © MAINER4IK
