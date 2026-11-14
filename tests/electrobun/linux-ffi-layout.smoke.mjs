// Явный smoke для Bun из staging/bin/bun: GUI и пользовательский профиль не открываются.
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import path from "node:path"
import { createHash } from "node:crypto"
import { dlopen } from "bun:ffi"
import { nativeFileDialogLibraryPath } from "../../electrobun/platform/resources.ts"

assert.equal(process.platform, "linux")
const libraryPath = nativeFileDialogLibraryPath()
const expected = path.resolve(path.dirname(process.execPath), "../Resources/app/native/nfd/linux-x64/libnfd.so")
assert.equal(libraryPath, expected)
const manifest = JSON.parse(readFileSync(path.join(path.dirname(libraryPath), "../manifest.json"), "utf8"))
const entry = manifest.files.find(entry => entry.path === "linux-x64/libnfd.so")
assert.ok(entry)
assert.equal(createHash("sha256").update(readFileSync(libraryPath)).digest("hex"), entry.sha256)
// Проверяем линковку зависимостей GTK без NFD_Init, показа диалогов и доступа к DISPLAY.
const library = dlopen(libraryPath, { NFD_GetError: { args: [], returns: "ptr" } })
library.close()
console.log(JSON.stringify({ libraryPath, checksum: "verified", dlopen: "ok" }))
