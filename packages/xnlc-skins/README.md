# @xnlc/skins

Домен скинов Minecraft: каталог [Laby](https://laby.net), «Избранное», локальные
скины, активный скин на аккаунте и кэш. **Без зависимости от Electron** — всё, что
выходит за пределы домена, описано портами.

```ts
import { createSkinSystem } from "@xnlc/skins"

const skins = createSkinSystem({
  library: myLibraryStore,   // SkinLibraryStore: база + файлы текстур
  accounts: myAccountPort,   // SkinAccountPort: аккаунт и токен Minecraft Services
  disk: myDiskCache,         // SkinDiskCache: офлайн-кэш (необязательно)
  locale: "ru",
})

const page = await skins.catalog.page({ page: 0, size: 25, order: "trending_24h" })
const tags = await skins.catalog.tags("ru")
const saved = await skins.library.importFromCatalog({ hash, accountId }, true)
```

## Что внутри

| Модуль | Ответственность |
| --- | --- |
| `LabyCatalog` | страницы каталога, теги, игроки, «похожие», текстуры Laby |
| `SkinLibrary` | «Избранное»: сохранённые и локальные скины, импорт из каталога |
| `MinecraftSkins` | активный скин на аккаунте: надевание, сброс, плащ, профиль |
| `SkinCache` | память (TTL, до 256 записей) + диск (последнее удачное значение) |
| `laby/urls` | адреса API и валидация идентификаторов |
| `laby/mapping` | ответы Laby → модели лаунчера |
| `laby/scoring` | локальные фильтры, «похожие», форматирование метрик |

## Порты

- **`SkinLibraryStore`** — «Избранное»: список, поиск по `sourceId`, создание
  (файл + строка), обновление, удаление вместе с файлом, чтение текстуры.
- **`SkinAccountPort`** — аккаунт с рабочим токеном и его обновление после `401`.
- **`SkinDiskCache`** — двоичные записи по имени: страницы каталога, теги, текстуры.

## Режимы каталога

У Laby нет серверной фильтрации, кроме тега, поэтому `page()` работает так:

1. **без фильтров** — лента, серверная пагинация (`offset = page * size`);
2. **ровно один тег без текста** — `/tag/{id}`: серверная пагинация по тегу;
3. **остальное** (несколько тегов и/или текст) — локальный фильтр по пулу до
   5 страниц × 100 скинов (пулы ограничены 16 по LRU).

`403` за концом выдачи — это конец списка (`endOfFeed`), а не ошибка доступа.
Если Laby недоступен, страница приходит из дискового кэша с `stale: true`.

## Сборка и тесты

```bash
pnpm --filter @xnlc/skins build   # tsc → lib/
pnpm run test:skins               # тесты домена из корня репозитория
```
