import test from "node:test"
import assert from "node:assert/strict"
import fs from "node:fs"
import path from "node:path"
import { spawnSync } from "node:child_process"
import { safeStorage } from "../../electrobun/platform/windows-native.ts"
import { dlopen, ptr, read, toArrayBuffer } from "bun:ffi"
import { transformSync } from "esbuild"
import vm from "node:vm"

test("DPAPI не запускает внешний процесс", () => {
  const source = fs.readFileSync(new URL("../../electrobun/platform/windows-native.ts", import.meta.url), "utf8")
  const body = source.match(/function protect\([\s\S]*?\n\}/)[0]
  assert.doesNotMatch(body, /spawnSync|powershell|ProtectedData/)
})

for (const value of ["", "секрет 🔐 — +/=\n\0尾", "plain ASCII"]) {
  test(`DPAPI: UTF-8 и совместимость .NET (${value.length} символов)`, { skip: process.platform !== "win32" }, async () => {
    const encrypted = safeStorage.encryptString(value)
    assert.equal(safeStorage.decryptString(encrypted), value)
    assert.equal((await safeStorage.decryptStringAsync(await safeStorage.encryptStringAsync(value))).result, value)
    const powershell = path.join(process.env.SystemRoot, "System32/WindowsPowerShell/v1.0/powershell.exe")
    const legacy = operation => {
      const input = operation === "Protect" ? Buffer.from(value) : encrypted
      const result = spawnSync(powershell, ["-NoProfile", "-NonInteractive", "-Command",
        "Add-Type -AssemblyName System.Security; $b=[Convert]::FromBase64String([Console]::ReadLine()); [Convert]::ToBase64String([Security.Cryptography.ProtectedData]::" + operation + "($b,$null,[Security.Cryptography.DataProtectionScope]::CurrentUser))"],
      { input: input.toString("base64") + "\n", encoding: "utf8", windowsHide: true, timeout: 15000 })
      assert.equal(result.status, 0)
      return Buffer.from(result.stdout.trim(), "base64")
    }
    assert.equal(safeStorage.decryptString(legacy("Protect")), value)
    assert.equal(legacy("Unprotect").toString("utf8"), value)
  })
}

test("повреждённый DPAPI-блоб отклоняется", { skip: process.platform !== "win32" }, () => {
  assert.throws(() => safeStorage.decryptString(Buffer.from("invalid")), /DPAPI/)
})
test("DPAPI освобождает выходной буфер даже при ошибке копирования", { skip: process.platform !== "win32" }, () => {
  let freed = 0
  const source = fs.readFileSync(new URL("../../electrobun/platform/windows-native.ts", import.meta.url), "utf8")
  const body = source.match(/function protect\([\s\S]*?\n\}/)[0]
  const code = transformSync(body + "\nmodule.exports = protect", { loader: "ts", format: "cjs" }).code
  const module = { exports: {} }
  vm.runInNewContext(code, { module, Buffer, process, ptr, read,
    toArrayBuffer: () => { throw new Error("copy failed") },
    dlopen: (file, symbols) => {
      const library = dlopen(file, symbols)
      if (file !== "kernel32.dll") return library
      return { close: () => library.close(), symbols: { ...library.symbols,
        LocalFree: data => { freed++; return library.symbols.LocalFree(data) },
      } }
    },
  })
  assert.throws(() => module.exports(Buffer.from("test"), "Protect"), /copy failed/)
  assert.equal(freed, 1)
})
