import { expect, test } from "bun:test"
import { assessDependency, type ModDependency } from "../src"

const dependency: ModDependency = { id: "example", kind: "depends", optional: false, loader: "fabric", raw: "1.2", source: "fabric.mod.json", versions: "1.2", interpretation: "declared" }

test("состояние зависит от полноты инвентаря и точной версии", () => {
  expect(assessDependency(dependency, { mods: [], complete: false }).status).toBe("unknown")
  expect(assessDependency(dependency, { mods: [], complete: true }).status).toBe("missing")
  expect(assessDependency(dependency, { mods: [{ id: "example", version: "1.2" }], complete: true }).status).toBe("satisfied")
  expect(assessDependency(dependency, { mods: [{ id: "example", version: "2" }], complete: true }).status).toBe("unknown")
  expect(assessDependency({ ...dependency, versions: ">=1" }, { mods: [{ id: "example", version: "1.2" }], complete: true }).status).toBe("unknown")
})

test("не делает выводов для условий, конфликтов, стороны и необязательных зависимостей", () => {
  const inventory = { mods: [], complete: true }
  expect(assessDependency({ ...dependency, interpretation: "unknown" }, inventory).status).toBe("unknown")
  expect(assessDependency({ ...dependency, optional: true }, inventory).status).toBe("unknown")
  expect(assessDependency({ ...dependency, kind: "breaks" }, inventory).status).toBe("unknown")
  expect(assessDependency({ ...dependency, side: "CLIENT" }, inventory).status).toBe("unknown")
})
