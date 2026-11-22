import { describe, expect, test } from "bun:test"
import { LaunchBuilder } from "../../packages/xnlc-core/src/core/launch-builder"
import { JavaManager } from "../../packages/xnlc-core/src/core/java-manager"
import { cleanEnvForGame } from "../../packages/xnlc-core/src/utils/primitives"
import { protectJavaOptionsEnvironment, writeJavaArgFileIfTooLong } from "../../packages/xnlc-core/src/core/java-runner"
import { chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"

const builder = new LaunchBuilder("/minecraft", { os: "linux", arch: "x64", version: "" } as any)
const version = { id: "test", mainClass: "net.minecraft.client.Main", type: "release", arguments: { jvm: ["-XX:+UseBASE64Intrinsics"] } } as any
const auth = { mode: "offline", username: "player", uuid: "123", accessToken: "" } as any

describe("Java4Shell mitigation", () => {
  test("places the mitigation after conflicting profile and user options for Java 17 and later", () => {
    for (const javaMajorVersion of [17, 21, 25, 27]) {
      const args = builder.build(version, [], auth, { javaPath: "java", javaMajorVersion, extraJvmArgs: ["-XX:+UseBASE64Intrinsics"] } as any)
      expect(args.indexOf("-XX:+UnlockDiagnosticVMOptions")).toBeGreaterThan(args.lastIndexOf("-XX:+UseBASE64Intrinsics"))
      expect(args.indexOf("-XX:-UseBASE64Intrinsics")).toBeGreaterThan(args.indexOf("-XX:+UnlockDiagnosticVMOptions"))
      expect(args.indexOf("-XX:-UseBASE64Intrinsics")).toBeLessThan(args.indexOf(version.mainClass))
    }
  })
  test("does not add unsupported HotSpot options to legacy Java", () => {
    const args = builder.build(version, [], auth, { javaPath: "java", javaMajorVersion: 8 } as any)
    expect(args).not.toContain("-XX:-UseBASE64Intrinsics")
  })
  test("also mitigates the exceptional Java 8 Performance Pack", () => {
    const args = builder.build(version, [], auth, { javaPath: "java", javaMajorVersion: 8, java8PerformancePack: true } as any)
    expect(args).toContain("-XX:-UseBASE64Intrinsics")
  })
  test("removes inherited JVM argument injection including JDK_JAVA_OPTIONS", () => {
    const env = cleanEnvForGame({ JDK_JAVA_OPTIONS: "-XX:+UseBASE64Intrinsics", JAVA_TOOL_OPTIONS: "-XX:+UseBASE64Intrinsics", _JAVA_OPTIONS: "-XX:+UseBASE64Intrinsics", PATH: "abc" })
    expect(env).toEqual({ PATH: "abc" })
  })
  test("keeps explicit environment options but overrides conflicting _JAVA_OPTIONS", () => {
    const env = { _java_options: "-XX:+UseBASE64Intrinsics", CUSTOM: "kept" }
    protectJavaOptionsEnvironment(env, 21, "win32")
    expect(env._java_options).toEndWith("-XX:+UnlockDiagnosticVMOptions -XX:-UseBASE64Intrinsics")
    expect(env.CUSTOM).toBe("kept")
  })
  test("preserves mitigation when arguments move to an argfile", async () => {
    const args = builder.build(version, [], auth, { javaPath: "java", javaMajorVersion: 21 } as any).slice(1)
    const file = await writeJavaArgFileIfTooLong(args, 10000, 100, 21)
    try {
      expect(file.cleanupPath).not.toBeNull()
      expect(await readFile(file.cleanupPath!, "utf8")).toContain("-XX:-UseBASE64Intrinsics")
    } finally { if (file.cleanupPath) await rm(file.cleanupPath, { force: true }) }
  })
  test("does not interrupt the launch when java -version cannot run", () => {
    const manager = new JavaManager({} as any, ".")
    const missing = path.join(tmpdir(), `xneon-missing-java-${process.pid}`, "java")
    let detected: boolean | undefined
    expect(() => { detected = manager.isJava8PerformancePack(missing) }).not.toThrow()
    expect(detected).toBe(false)
  })
  test("treats a non-zero java -version as no Performance Pack", async () => {
    // На Windows нет переносимого исполняемого файла, который гарантированно
    // завершается с ненулевым кодом на аргументе -version; ветка ошибки spawn
    // покрыта тестом выше.
    if (process.platform === "win32") return
    const dir = await mkdtemp(path.join(tmpdir(), "xneon-java-fail-"))
    try {
      const script = path.join(dir, "java")
      await writeFile(script, "#!/bin/sh\nexit 1\n")
      await chmod(script, 0o755)
      const manager = new JavaManager({} as any, ".")
      expect(manager.isJava8PerformancePack(script)).toBe(false)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})
