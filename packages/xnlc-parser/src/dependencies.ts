import type { ModDependency } from "./metadata.js"

export type DependencyStatus = "missing" | "unknown" | "satisfied"
export interface InstalledMod { id: string; version?: string }
export interface DependencyInventory { mods: readonly InstalledMod[]; complete: boolean }
export interface DependencyAssessment { status: DependencyStatus; reason: string }

/** Консервативная оценка одной обязательной зависимости без разрешения диапазонов и условий. */
export function assessDependency(dependency: ModDependency, inventory: DependencyInventory): DependencyAssessment {
  if (dependency.interpretation !== "declared" || !dependency.id || dependency.kind !== "depends" || dependency.optional !== false || dependency.side) return { status: "unknown", reason: "Dependency conditions are not resolved" }
  const matches = inventory.mods.filter(mod => mod.id === dependency.id)
  if (!matches.length) return inventory.complete ? { status: "missing", reason: "Required ID is absent from the complete inventory" } : { status: "unknown", reason: "Inventory is incomplete" }
  if (dependency.versions === undefined) return { status: "satisfied", reason: "Required ID is present without a version constraint" }
  // Для диапазонов, альтернатив и специфичных правил загрузчика нельзя предполагать совпадение.
  if ((dependency.loader === "fabric" || dependency.loader === "quilt") && typeof dependency.versions === "string" && /^\d+(?:\.\d+)*(?:[-+][0-9A-Za-z.-]+)?$/.test(dependency.versions) && matches.some(mod => mod.version === dependency.versions)) return { status: "satisfied", reason: "Required ID and exact version match" }
  return { status: "unknown", reason: "Version constraint is not resolved" }
}
