// Явно запускаемый GUI-smoke: импортирует настоящий адаптер, но не открывает профиль лаунчера.
import * as nfd from "nativefiledialog-for-bun"
import { saveFile } from "../../electrobun/platform/windows-native.ts"
import { nativeFileDialogLibraryPath } from "../../electrobun/platform/resources.ts"

const [destination] = process.argv.slice(2)
if (!destination) throw new Error("Expected destination")
const result = await saveFile(destination, [{ name: "ZIP", extensions: ["zip"] }])
console.log(JSON.stringify({ result, backend: nfd.getBackendName(), library: nativeFileDialogLibraryPath() }))
