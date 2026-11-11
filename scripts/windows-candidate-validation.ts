import assert from "node:assert/strict"

function peHeader(bytes: Buffer): number {
  assert.ok(bytes.length > 64 && bytes.toString("ascii", 0, 2) === "MZ", "Invalid PE file")
  const offset = bytes.readUInt32LE(60)
  assert.ok(offset < bytes.length - 6 && bytes.readUInt32LE(offset) === 0x4550, "Invalid PE header")
  return offset
}

export function windowsX64(bytes: Buffer): void {
  const offset = peHeader(bytes)
  assert.equal(bytes.readUInt16LE(offset + 4), 0x8664, "PE must be x64")
}

/**
 * Установщик NSIS: NSIS 3.x собирает x86-stub, поэтому требовать машину 0x8664
 * от самого установщика нельзя. Проверяем корректный PE и сигнатуру NSIS
 * ("NullsoftInst" в заголовке). Полезная нагрузка внутри (launcher.exe, bun.exe)
 * по-прежнему обязана быть x64 — это проверяет windowsX64.
 */
export function windowsInstaller(bytes: Buffer): void {
  peHeader(bytes)
  assert.ok(bytes.includes("NullsoftInst"), "Installer is not an NSIS package")
}

export function validateBundleCredentials(bundle: string): void {
  const credentials = bundle.match(/cloudCredentials\s*=\s*\{([\s\S]*?)\n\s*\};/)
  assert.ok(credentials, "Cannot inspect bundled OAuth configuration")
  const values = [...credentials[1].matchAll(/\b(?:clientId|clientSecret|deviceClientId):\s*("(?:[^"\\]|\\.)*")/g)]
  assert.ok(values.length === 12 && values.every(match => JSON.parse(match[1]) === ""), "Bundled OAuth configuration must be empty")
  assert.ok(!/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----|(?:github_pat_|ghp_|sk-proj-)[a-zA-Z0-9_-]{24,}/.test(bundle), "Possible private credential in packaged app")
}
