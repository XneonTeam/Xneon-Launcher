type ModelLogoAsset = { url: string; invert: boolean }
const avatars = new Map<string, Promise<ModelLogoAsset | undefined>>()

export function loadModelLogoAsset(index: Record<string, string | null>, provider: string): Promise<ModelLogoAsset | undefined> {
  const key = `logo/${provider}`.toLowerCase().replace(/[^a-z0-9/]/g, "")
  if (index[key] !== null) return Promise.resolve({ url: `https://models.dev/logos/${encodeURIComponent(provider)}.svg`, invert: true })
  // У разработчика нет файла в каталоге логотипов: запрашиваем публичный аватар.
  let pending = avatars.get(provider)
  if (!pending) {
    pending = (async () => {
      try {
        const response = await fetch(`https://huggingface.co/api/organizations/${encodeURIComponent(provider)}/avatar`, { signal: AbortSignal.timeout(5000) })
        if (!response.ok) return undefined
        const data = await response.json() as { avatarUrl?: unknown }
        if (typeof data.avatarUrl !== "string") return undefined
        const url = new URL(data.avatarUrl)
        if (url.protocol !== "https:" || !(url.hostname === "huggingface.co" || url.hostname.endsWith(".huggingface.co"))) return undefined
        return { url: url.href, invert: false }
      } catch { return undefined }
    })()
    avatars.set(provider, pending)
  }
  return pending
}
