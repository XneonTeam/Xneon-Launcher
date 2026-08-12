import * as fs from "node:fs"
import { NBTReader } from "./src/reader.js"

const worldPath = "C:\\Users\\MAINER4IK\\AppData\\Roaming\\xneonlauncher\\intents\\26_1_2\\saves\\New World"

const levelDatPath = `${worldPath}\\level.dat`
const wgsPath = `${worldPath}\\data\\minecraft\\world_gen_settings.dat`

console.log("=== Данные мира ===")
const data = fs.readFileSync(levelDatPath)
const nbt = new NBTReader(data).read({ compressed: "gzip" })
const level = nbt.Data as any

console.log("Название:", level.LevelName)
console.log("Версия:", level.Version?.Name)
console.log("Режим:", level.GameType)

if (fs.existsSync(wgsPath)) {
  const wgsData = fs.readFileSync(wgsPath)
  const wgsNbt = new NBTReader(wgsData).read({ compressed: "gzip" })
  const wgs = (wgsNbt.data || wgsNbt.Data) as any
  console.log("\nSeed:", wgs?.seed?.toString())
} else {
  console.log("world_gen_settings.dat не найден")
}
