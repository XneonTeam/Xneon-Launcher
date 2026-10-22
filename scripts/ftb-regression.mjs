import assert from "node:assert/strict"
import { getFTBPath } from "@xnlc/mods"

// Формат путей из манифеста MindCrack Pack 8.3.2 (74/193, Minecraft 1.4.7).
for (const [directory, name, expected] of [
  ["./mods", "railcraft.jar", "mods/railcraft.jar"],
  ["./mods", "redpowercore.zip", "mods/redpowercore.zip"],
  ["./coremods", "CodeChickenCore.jar", "coremods/CodeChickenCore.jar"],
  ["./config/railcraft", "railcraft.cfg", "config/railcraft/railcraft.cfg"],
  ["./mods/", "example.jar", "mods/example.jar"],
  ["./mods/", "/example.jar", "mods/example.jar"],
  [".\\mods", "example.jar", "mods/example.jar"],
  ["./", "options.txt", "options.txt"],
  [undefined, "options.txt", "options.txt"],
]) {
  assert.equal(getFTBPath({ path: directory, name }), expected)
}
for (const [directory, name] of [["../mods", "a.jar"], ["./mods", "../../a.jar"], ["C:/mods", "a.jar"]]) {
  assert.throws(() => getFTBPath({ path: directory, name }), /Invalid FTB file path/)
}
console.log("FTB: пути MindCrack Pack, ZIP-моды, coremods и конфиги — OK")
