import * as fs from "node:fs"
import { NBTWriter } from "./src/writer.js"

const serversDatPath = "C:\\Users\\MAINER4IK\\AppData\\Roaming\\xneonlauncher\\intents\\26_1_2\\servers.dat"

const nbt = {
  servers: {
    type: 10,
    values: [
      {
        name: "Xneon Server",
        ip: "mc.xneon.org",
        hidden: 0,
      },
    ],
  },
}

const buffer = new NBTWriter().write(nbt, { compressed: "gzip" })
fs.writeFileSync(serversDatPath, buffer)

console.log("servers.dat создан с сервером mc.xneon.org")
