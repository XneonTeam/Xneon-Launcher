import * as fs from "node:fs"
import { NBTReader } from "./src/reader.js"
import { NBTWriter } from "./src/writer.js"

const serversDatPath = "C:\\Users\\MAINER4IK\\AppData\\Roaming\\xneonlauncher\\intents\\26_1_2\\servers.dat"

console.log("=== Текущие сервера ===")
const data = fs.readFileSync(serversDatPath)
const nbt = new NBTReader(data).read()

const servers = nbt.servers as any
servers.values.forEach((server: any, i: number) => {
  console.log(`${i + 1}. ${server.name} (${server.ip})`)
})

console.log("\n=== Добавление сервера ===")
servers.values.push({
  name: "Xneon Server",
  ip: "play.xneon.org",
  hidden: 0,
})

const newBuffer = new NBTWriter().write(nbt)
fs.writeFileSync(serversDatPath, newBuffer)

console.log("\n=== Сервера после добавления ===")
const data2 = fs.readFileSync(serversDatPath)
const nbt2 = new NBTReader(data2).read()
const servers2 = nbt2.servers as any
servers2.values.forEach((server: any, i: number) => {
  console.log(`${i + 1}. ${server.name} (${server.ip})`)
})
