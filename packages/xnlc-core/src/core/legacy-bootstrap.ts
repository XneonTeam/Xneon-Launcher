import * as fs from "node:fs";
import * as path from "node:path";
import { LEGACY_CLASSES } from "./legacy-bootstrap.generated.js";

export const LEGACY_MAIN_CLASS = "org.xnlc.legacy.XnlcLegacyLauncher";

export function ensureLegacyBootstrap(gameDir: string): string {
  const root = path.join(gameDir, ".xnlc", "legacy-bootstrap");
  for (const [name, encoded] of Object.entries(LEGACY_CLASSES)) {
    const file = path.join(root, name);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const data = Buffer.from(encoded, "base64");
    if (!fs.existsSync(file) || !fs.readFileSync(file).equals(data)) fs.writeFileSync(file, data);
  }
  return root;
}
