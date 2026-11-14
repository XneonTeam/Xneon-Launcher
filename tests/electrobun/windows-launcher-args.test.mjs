import test from "node:test"
import assert from "node:assert/strict"
import fs from "node:fs"
import { readWindowsProcessCommandLine } from "../../electrobun/platform/windows-command-line.ts"
import { readWindowsLauncherArgs } from "../../electrobun/platform/windows-native.ts"
import { fileURLToPath } from "node:url"

test("аргументы родителя не используют WMI/PowerShell", () => {
  const source = fs.readFileSync(new URL("../../electrobun/platform/windows-native.ts", import.meta.url), "utf8")
  const body = source.match(/export async function readWindowsLauncherArgs\([\s\S]*?\n\}/)[0]
  assert.doesNotMatch(body, /Get-CimInstance|exec\(|powershell/)
})
test("NT возвращает строку только для проверенного EXE", { skip: process.platform !== "win32" }, () => {
  const command = readWindowsProcessCommandLine(process.pid, process.execPath)
  assert.ok(command && command.includes("bun"))
  assert.equal(readWindowsProcessCommandLine(process.pid, "C:\\not-our-launcher.exe"), null)
  assert.equal(readWindowsProcessCommandLine(0xffffffff, process.execPath), null)
})
test("обычный запуск без --launch не требует внешнего процесса", { skip: process.platform !== "win32" }, async () => {
  assert.deepEqual(await readWindowsLauncherArgs(), [])
  const start = performance.now()
  for (let i = 0; i < 100; i++) await readWindowsLauncherArgs()
  console.log(`Аргументы без --launch, среднее: ${((performance.now() - start) / 100).toFixed(3)} ms`)
})
test("настоящий argv сохраняет Unicode, пробелы и флаг --launch", { skip: process.platform !== "win32" }, () => {
  const modulePath = fileURLToPath(new URL("../../electrobun/platform/windows-native.ts", import.meta.url))
  const code = `const {readWindowsLauncherArgs}=await import(${JSON.stringify(modulePath)}); console.log(JSON.stringify(await readWindowsLauncherArgs()));`
  const child = Bun.spawnSync([process.execPath, "--no-env-file", "-e", code, "--", "--launch", "Сборка с пробелами 尾"], { stdout: "pipe", stderr: "pipe" })
  assert.equal(child.exitCode, 0)
  const args = JSON.parse(child.stdout.toString())
  assert.deepEqual(args.slice(-2), ["--launch", "Сборка с пробелами 尾"])
})
