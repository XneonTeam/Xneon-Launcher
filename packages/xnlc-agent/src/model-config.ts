import type { AiModelConfig } from "@xnlc/types"

export function validateModelConfigs(value: unknown): AiModelConfig[] {
  if (!Array.isArray(value) || !value.length || value.length > 200) throw new Error("Select between 1 and 200 models")
  const ids = new Set<string>()
  return value.map(item => {
    if (!item || typeof item.id !== "string" || !item.id.trim() || item.id.length > 200 || ids.has(item.id.trim()) || !Number.isInteger(item.contextWindow) || item.contextWindow < 8192 || item.contextWindow > 4_000_000 || typeof item.supportsImages !== "boolean") throw new Error("Invalid model configuration")
    ids.add(item.id.trim())
    return { id: item.id.trim(), contextWindow: item.contextWindow, supportsImages: item.supportsImages }
  })
}
export function readModelConfigs(value: string | undefined, current: string): AiModelConfig[] {
  if (value) { try { return validateModelConfigs(JSON.parse(value)) } catch { /* Старые настройки восстанавливаем без потери активной модели. */ } }
  return [{ id: current, contextWindow: 256_000, supportsImages: false }]
}
