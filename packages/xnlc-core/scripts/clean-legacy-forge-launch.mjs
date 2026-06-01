import { rmSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const packageDir = path.resolve(scriptDir, "..");

rmSync(path.join(packageDir, "lib", "resources", "xnlc-legacy-launcher"), { recursive: true, force: true });
rmSync(path.join(packageDir, "lib", "loaders", "forge-legacy"), { recursive: true, force: true });
rmSync(path.join(packageDir, "lib", "loaders", "forge-legacy-fml.js"), { force: true });
rmSync(path.join(packageDir, "lib", "loaders", "forge-legacy-fml.js.map"), { force: true });
rmSync(path.join(packageDir, "lib", "loaders", "forge-legacy-fml.d.ts"), { force: true });
rmSync(path.join(packageDir, "lib", "loaders", "forge-legacy-fml.d.ts.map"), { force: true });
rmSync(path.join(packageDir, "lib", "loaders", "forge-legacy-handler.js"), { force: true });
rmSync(path.join(packageDir, "lib", "loaders", "forge-legacy-handler.js.map"), { force: true });
rmSync(path.join(packageDir, "lib", "loaders", "forge-legacy-handler.d.ts"), { force: true });
rmSync(path.join(packageDir, "lib", "loaders", "forge-legacy-handler.d.ts.map"), { force: true });

// NOTE: We intentionally keep the current forge-handler.js here because it is the active implementation.
