# @xnlc/nbt

XNLC NBT — библиотека для чтения и записи NBT (Named Binary Tag) данных Minecraft.

## Установка

```bash
npm install @xnlc/nbt
```

## Возможности

- 📖 Чтение NBT данных из файлов Minecraft
- ✍️ Запись NBT данных в файлы
- 🗜️ Поддержка сжатия Gzip/Deflate
- 📋 Поддержка всех типов NBT тегов (Byte, Short, Int, Long, Float, Double, String, List, Compound, массивы)
- 🔧 Полная поддержка TypeScript

## Использование

### Чтение servers.dat

```ts
import * as fs from "node:fs"
import { NBTReader } from "@xnlc/nbt"

const data = fs.readFileSync("servers.dat")
const nbt = new NBTReader(data).read()

const servers = nbt.servers as any
console.log(servers.values[0].name) // "Мой сервер"
console.log(servers.values[0].ip)   // "mc.xneon.org"
```

### Запись servers.dat

```ts
import * as fs from "node:fs"
import { NBTReader, NBTWriter } from "@xnlc/nbt"

const data = fs.readFileSync("servers.dat")
const nbt = new NBTReader(data).read()

// Добавить новый сервер
const servers = nbt.servers as any
servers.values.push({
  name: "Новый сервер",
  ip: "new.server.com",
  hidden: 0,
})

const newBuffer = new NBTWriter().write(nbt)
fs.writeFileSync("servers.dat", newBuffer)
```

### Изменение данных servers.dat

```ts
import * as fs from "node:fs"
import { NBTReader, NBTWriter } from "@xnlc/nbt"

const data = fs.readFileSync("servers.dat")
const nbt = new NBTReader(data).read()

const servers = nbt.servers as any

// Изменить имя первого сервера
servers.values[0].name = "Новое имя"

// Изменить IP сервера
servers.values[0].ip = "new.ip.com"

// Скрыть сервер
servers.values[0].hidden = 1

const newBuffer = new NBTWriter().write(nbt)
fs.writeFileSync("servers.dat", newBuffer)
```

### Чтение level.dat

```ts
import * as fs from "node:fs"
import { NBTReader } from "@xnlc/nbt"

const data = fs.readFileSync("level.dat")
const nbt = new NBTReader(data).read({ compressed: "gzip" })

const level = nbt.Data as any
console.log(level.LevelName)        // "My World"
console.log(level.GameType)         // 0 = Survival, 1 = Creative
console.log(level.Version?.Name)    // "26.2"
```

### Запись level.dat

```ts
import * as fs from "node:fs"
import { NBTReader, NBTWriter } from "@xnlc/nbt"

const data = fs.readFileSync("level.dat")
const nbt = new NBTReader(data).read({ compressed: "gzip" })

const level = nbt.Data as any
level.LevelName = "Новый мир"
level.GameType = 1 // Creative

const newBuffer = new NBTWriter().write(nbt, { compressed: "gzip" })
fs.writeFileSync("level.dat", newBuffer)
```

### Изменение данных level.dat

```ts
import * as fs from "node:fs"
import { NBTReader, NBTWriter } from "@xnlc/nbt"

const data = fs.readFileSync("level.dat")
const nbt = new NBTReader(data).read({ compressed: "gzip" })

const level = nbt.Data as any

// Изменить название мира
level.LevelName = "Мой мир"

// Сменить режим игры (0=Survival, 1=Creative, 2=Adventure, 3=Spectator)
level.GameType = 0

// Включить/выключить читы
level.allowCommands = 1

// Изменить сложность
level.difficulty_settings.difficulty = "hard"

// Изменить позицию спауна
level.spawn.pos = [100, 70, 200]

const newBuffer = new NBTWriter().write(nbt, { compressed: "gzip" })
fs.writeFileSync("level.dat", newBuffer)
```

## Лицензия

MIT