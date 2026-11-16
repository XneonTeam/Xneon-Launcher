import { spawnSync } from "node:child_process"
import { mkdtempSync, readFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"

// Только запуск после test:prepare. Отдельные процессы сохраняют изоляцию mocks.
const root = fileURLToPath(new URL("../", import.meta.url))
export const OFFLINE_SUITES = [
  { name: "desktop", args: ["test", "tests/electrobun"] },
  { name: "parser-unit", args: ["scripts/test-parser.mjs", "offline"] },
  { name: "parser-integration", args: ["scripts/test-parser.mjs", "integration"] },
  { name: "archives", args: ["test", "packages/xnlc-archives/tests"] },
  { name: "security-agent", args: ["test", "tests/security", "tests/agent"] },
  { name: "share-domain", args: ["test", "packages/xnlc-share/tests"] },
  { name: "share-service", args: ["test", "infrastructure/xnlc-share/tests"] },
  { name: "liveops-client", args: ["test", "infrastructure/xnlc-liveops/client"] },
  { name: "tooling", args: ["test", "tests/tooling"] },
]

// JUnit нужен только для сводки: он не заменяет вывод группы и удаляется после прогона.
function readJunit(file) {
  let xml
  try { xml = readFileSync(file, "utf8") } catch { return null }
  const head = /<testsuites\b([^>]*)>/.exec(xml)
  if (!head) return null
  const attr = Object.fromEntries([...head[1].matchAll(/([\w-]+)="([^"]*)"/g)].map(match => [match[1], match[2]]))
  const tests = Number(attr.tests ?? 0)
  const skipped = Number(attr.skipped ?? 0)
  const failures = Number(attr.failures ?? 0)
  return {
    // describe создаёт дополнительные testsuite с тем же file; это не новые файлы.
    files: new Set([...xml.matchAll(/<(?:testsuite|testcase)\b[^>]*\bfile="([^"]+)"/g)]
      .map(match => match[1].replaceAll("\\", "/"))).size,
    tests,
    skipped,
    failures,
    passed: Math.max(0, tests - skipped - failures),
    seconds: Number(attr.time ?? 0),
  }
}

function printSummary(rows) {
  const present = rows.filter(row => row.result)
  if (!present.length) return
  const total = present.reduce((acc, row) => ({
    files: acc.files + row.result.files,
    tests: acc.tests + row.result.tests,
    passed: acc.passed + row.result.passed,
    skipped: acc.skipped + row.result.skipped,
    failures: acc.failures + row.result.failures,
    seconds: acc.seconds + row.result.seconds,
  }), { files: 0, tests: 0, passed: 0, skipped: 0, failures: 0, seconds: 0 })
  const line = (name, r) => `${name.padEnd(18)}${String(r.files).padStart(7)}${String(r.tests).padStart(9)}${String(r.passed).padStart(7)}${String(r.skipped).padStart(7)}${String(r.failures).padStart(6)}  ${r.seconds.toFixed(1).replace(".", ",")} с`
  console.log("")
  console.log("Итог offline-gate (все группы, все файлы):")
  console.log(`${"группа".padEnd(18)}${"файлов".padStart(7)}${"случаев".padStart(9)}${"pass".padStart(7)}${"skip".padStart(7)}${"fail".padStart(6)}  время`)
  for (const row of rows) {
    if (!row.result) { console.log(`${row.name.padEnd(18)}      —  нет JUnit-файла`); continue }
    console.log(line(row.name, row.result))
  }
  console.log(line("итого", total))
}

export function runOfflineTests(spawn = spawnSync) {
  const junitDirectory = mkdtempSync(path.join(tmpdir(), "xnlc-offline-junit-"))
  const rows = []
  try {
    for (const suite of OFFLINE_SUITES) {
      const junit = path.join(junitDirectory, suite.name + ".xml")
      const args = [...suite.args]
      const env = { ...process.env, XNLC_PARSER_LIVE_TESTS: "0" }
      if (args[0] === "test") args.splice(1, 0, "--reporter=junit", "--reporter-outfile=" + junit)
      else env.XNLC_PARSER_JUNIT = junit
      const result = spawn(process.execPath, args, { cwd: root, stdio: "inherit", env })
      if (result.error) throw result.error
      if (result.status !== 0) {
        console.error(result.status == null
          ? `Группа "${suite.name}" завершилась без кода выхода; следующие не запускались.`
          : `Группа "${suite.name}" завершилась с кодом ${result.status}; следующие не запускались.`)
        return result.status ?? 1
      }
      rows.push({ name: suite.name, result: readJunit(junit) })
    }
  } finally {
    rmSync(junitDirectory, { recursive: true, force: true })
  }
  printSummary(rows)
  return 0
}

if (import.meta.main) {
  if (process.argv[2] === "--list") console.log(JSON.stringify(OFFLINE_SUITES, null, 2))
  else if (process.argv.length > 2) throw new Error("Unknown offline runner argument: " + process.argv[2])
  else process.exitCode = runOfflineTests()
}
