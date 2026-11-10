/** Модули Fabric API поставляются общим проектом, а не отдельными страницами. */
const FABRIC_API_MODULES = new Set([
  "fabric-api-base", "fabric-resource-loader-v0", "fabric-resource-loader-v1",
  "fabric-resource-conditions-api-v1",
])
export function dependencyProjectId(modId: string): string {
  const normalized = modId.toLowerCase()
  return FABRIC_API_MODULES.has(normalized) ? "fabric-api" : normalized
}
