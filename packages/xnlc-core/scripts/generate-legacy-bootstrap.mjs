import { spawnSync } from "node:child_process";
import { mkdtempSync, readdirSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Выполняется только при изменении Java-исходника. Обычная сборка и пользователь
// лаунчера используют встроенный байткод и не требуют установленного JDK.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const output = mkdtempSync(path.join(tmpdir(), "xnlc-legacy-build-"));
try {
  // ASM 4 внутри старого FML понимает байткод максимум Java 7.
  const result = spawnSync(process.env.JAVAC || "javac", ["--release", "7", "-Xlint:-options", "-encoding", "UTF-8", "-g:none", "-d", output,
    path.join(root, "resources", "legacy", "XnlcLegacyLauncher.java"),
    path.join(root, "resources", "legacy", "Launcher.java")], { stdio: "inherit" });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`javac exited with code ${result.status}`);
  const entries = ["org/xnlc/legacy", "net/minecraft"].flatMap(directory => {
    const classes = path.join(output, directory);
    return readdirSync(classes).sort().map(name => [`${directory}/${name}`, readFileSync(path.join(classes, name)).toString("base64")]);
  });
  writeFileSync(path.join(root, "src", "core", "legacy-bootstrap.generated.ts"),
    '// Создано scripts/generate-legacy-bootstrap.mjs из resources/legacy/XnlcLegacyLauncher.java.\n'
    + `export const LEGACY_CLASSES: Record<string, string> = ${JSON.stringify(Object.fromEntries(entries), null, 2)};\n`);
} finally {
  // output всегда является отдельной папкой mkdtemp внутри системной tmpdir.
  if (path.dirname(output) !== path.resolve(tmpdir())) throw new Error("Unexpected compiler output path");
  rmSync(output, { recursive: true, force: true });
}
