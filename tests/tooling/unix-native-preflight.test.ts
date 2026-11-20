import { describe, expect, test } from "bun:test"
import { validateCefPayload } from "../../scripts/unix-native-preflight"
import { mkdtemp, mkdir, writeFile, rm, readFile, symlink } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"

describe("Linux CEF payload gate", () => {
  test("Unix native jobs remain explicit preflight and cannot publish candidates", async () => {
    for (const workflow of ["release", "pre-release"]) {
      const yaml = Bun.YAML.parse(await readFile(`.github/workflows/${workflow}.yml`, "utf8")) as any
      const linux = yaml.jobs["linux-preflight"]
      const macos = yaml.jobs["macos-preflight"]
      expect(linux?.["runs-on"]).toBe("ubuntu-24.04")
      expect(macos?.["runs-on"]).toBe("macos-26")
      for (const job of [linux, macos]) {
        expect(job.if).toBe("github.event_name == 'workflow_dispatch'")
        expect(job.needs).toBe("tests")
        expect(job.steps.find((step: any) => step.uses === "actions/upload-artifact@v7").with.name).toStartWith("preflight-")
      }
      expect(linux.steps.some((step: any) => step.run?.includes("smoke-linux-cef.ts"))).toBe(false)
      expect(linux.steps.some((step: any) => step.run?.includes("package-linux.ts"))).toBe(true)
      expect(macos.steps.some((step: any) => step.run?.includes("smoke-macos.ts"))).toBe(true)
      expect(JSON.stringify(linux.steps)).not.toMatch(/macOS|macos|hdiutil|ditto|Portable|NSIS/)
      expect(JSON.stringify(macos.steps)).not.toMatch(/Linux|linux|package-linux|Portable|NSIS/)
      expect(JSON.stringify(yaml.jobs.build.steps)).not.toMatch(/macOS|macos|package-linux|native Linux|runner\.os/)
      expect(yaml.jobs.release.needs).toEqual(["tests", "build"])
      expect(yaml.jobs.release.steps.find((step: any) => step.uses === "actions/download-artifact@v8").with.pattern).toBe("native-*")
    }
  })
  test("accepts an ELF64 x64 CEF with SDK resources and locales", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "xneon-cef-test-"))
    try {
      await mkdir(path.join(root, "bin/locales"), { recursive: true })
      const elf = Buffer.alloc(64)
      elf.write("\x7fELF"); elf[4] = 2; elf[5] = 1; elf.writeUInt16LE(62, 18)
      await writeFile(path.join(root, "bin/libcef.so"), elf)
      await writeFile(path.join(root, "bin/bun Helper"), elf, { mode: 0o755 })
      for (const name of ["icudtl.dat", "resources.pak", "chrome_100_percent.pak", "chrome_200_percent.pak", "v8_context_snapshot.bin", "locales/en-US.pak"]) await writeFile(path.join(root, "bin", name), "fixture")
      expect((await validateCefPayload(root)).libcef).toBe("bin/libcef.so")
      await mkdir(path.join(root, "bin/cef"))
      await symlink("../libcef.so", path.join(root, "bin/cef/libcef.so"))
      expect((await validateCefPayload(root)).libcef).toBe("bin/libcef.so")
      await rm(path.join(root, "bin/bun Helper"))
      await expect(validateCefPayload(root)).rejects.toThrow()
      await writeFile(path.join(root, "bin/bun Helper"), elf, { mode: 0o755 })
      await rm(path.join(root, "bin/resources.pak"))
      await expect(validateCefPayload(root)).rejects.toThrow()
      await writeFile(path.join(root, "bin/resources.pak"), "fixture")
      elf.writeUInt16LE(183, 18)
      await writeFile(path.join(root, "bin/libcef.so"), elf)
      await expect(validateCefPayload(root)).rejects.toThrow("Invalid Linux ELF architecture")
    } finally { await rm(root, { recursive: true, force: true }) }
  })
  test("does not accept a native-only or incomplete Chromium bundle", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "xneon-cef-test-"))
    try {
      await mkdir(path.join(root, "bin"))
      await expect(validateCefPayload(root)).rejects.toThrow()
      await writeFile(path.join(root, "bin/libcef.so"), "not an ELF")
      await expect(validateCefPayload(root)).rejects.toThrow()
    } finally { await rm(root, { recursive: true, force: true }) }
  })
})
