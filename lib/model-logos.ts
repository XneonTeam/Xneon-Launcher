type ModelLogoIndex = Record<string, string | null>
type CatalogModel = { id?: string; name?: string; canonical_model_id?: string; family?: string }
type CatalogProvider = { id?: string; models?: Record<string, CatalogModel> }
const CACHE_KEY = "models.dev:logo-index:v9"
const TTL = 24 * 60 * 60 * 1000
let loading: Promise<ModelLogoIndex> | undefined
const normalize = (value: string) => value.toLowerCase().replace(/[^a-z0-9/]/g, "")
const familyRoot = (value?: string) => value?.trim().toLowerCase().match(/^[a-z]{2,}/)?.[0]
const validProvider = (value?: string): value is string => !!value && /^[a-z0-9_-]+$/i.test(value)
type FamilyEvidence = Map<string, Map<string, Set<string>>>

export function createModelLogoIndex(catalog: Record<string, CatalogProvider>): ModelLogoIndex {
  const index: ModelLogoIndex = Object.create(null)
  const canonicalFamilies: FamilyEvidence = new Map()
  const nativeFamilies: FamilyEvidence = new Map()
  const add = (alias: string, provider: string) => {
    const key = normalize(alias)
    if (!key) return
    if (Object.hasOwn(index, key) && index[key] !== provider) index[key] = null
    else index[key] = provider
  }
  const addFamily = (evidence: FamilyEvidence, root: string | undefined, provider: string, identity: string) => {
    if (!root) return
    const owners = evidence.get(root) ?? new Map<string, Set<string>>()
    const identities = owners.get(provider) ?? new Set<string>()
    identities.add(normalize(identity))
    owners.set(provider, identities)
    evidence.set(root, owners)
  }

  for (const [providerId, entry] of Object.entries(catalog)) {
    const service = entry.id || providerId
    if (!validProvider(service)) continue
    add(`@provider/${providerId}`, service)
    for (const [modelId, model] of Object.entries(entry.models ?? {})) {
      const canonical = model.canonical_model_id
      const owner = canonical?.split("/")[0]
      // Имя сервиса достоверно только внутри его собственного пространства имён.
      add(`@qualified/${providerId}/${modelId}`, validProvider(owner) ? owner : service)
      if (canonical && validProvider(owner)) {
        for (const alias of [`${providerId}/${modelId}`, modelId, model.id, canonical]) {
          if (alias) add(`@canonical/${alias}`, owner)
        }
        const canonicalLeaf = canonical.split("/").at(-1)
        addFamily(canonicalFamilies, familyRoot(canonicalLeaf), owner, canonical)
        // Семейство должно соответствовать имени модели, а не категории маршрута.
        if (familyRoot(model.family) === familyRoot(canonicalLeaf)) {
          addFamily(canonicalFamilies, familyRoot(model.family), owner, canonical)
        }
        continue
      }

      // Без канонических данных допускаем только версионированное семейство,
      // подтверждённое полем family или собственным именем разработчика.
      const leaf = modelId.split("/").at(-1) ?? ""
      const root = familyRoot(leaf)
      const sourceMatches = !modelId.includes("/") || modelId.split("/")[0] === providerId
      const familyMatches = root && familyRoot(model.family) === root
      const ownerMatches = root && familyRoot(service) === root
      if (sourceMatches && /\d/.test(leaf) && (familyMatches || ownerMatches)) {
        addFamily(nativeFamilies, root, service, modelId)
      }
    }
  }

  for (const root of new Set([...canonicalFamilies.keys(), ...nativeFamilies.keys()])) {
    // Канонические записи имеют приоритет; каждый ID считается один раз,
    // сколько бы посредников ни предлагали эту модель.
    const owners = canonicalFamilies.get(root) ?? nativeFamilies.get(root)!
    const ranked = [...owners].map(([owner, ids]) => [owner, ids.size] as const).sort((a, b) => b[1] - a[1])
    const total = ranked.reduce((sum, [, count]) => sum + count, 0)
    index[normalize(`@family/${root}`)] = ranked[0] && ranked[0][1] > total / 2 ? ranked[0][0] : null
  }

  const registeredProviders = Object.keys(catalog)
  for (const owner of new Set(Object.values(index).filter((value): value is string => !!value))) {
    if (registeredProviders.includes(owner)) continue
    const variants = registeredProviders.filter(id => id.startsWith(owner + "-"))
      .sort((a, b) => a.length - b.length || a.localeCompare(b))
    index[normalize(`@logo/${owner}`)] = variants[0] ?? null
  }
  return index
}

export function findModelLogoProvider(index: ModelLogoIndex, model: string): string | undefined {
  const read = (key: string) => Object.hasOwn(index, normalize(key)) ? index[normalize(key)] : undefined
  const logoProvider = (owner: string) => read(`@logo/${owner}`) || owner
  const parts = model.split("/").map(part => part.trim())
  for (let offset = 0; offset < parts.length; offset++) {
    const suffix = parts.slice(offset).join("/")
    const canonical = read(`@canonical/${suffix}`)
    if (canonical) return logoProvider(canonical)
  }
  const root = familyRoot(parts.at(-1))
  const family = root ? read(`@family/${root}`) : undefined
  if (family) return logoProvider(family)
  for (let offset = 0; offset < parts.length; offset++) {
    const qualified = read(`@qualified/${parts.slice(offset).join("/")}`)
    if (qualified) return logoProvider(qualified)
  }
  for (const prefix of parts.slice(0, -1).reverse()) {
    const service = read(`@provider/${prefix}`)
    if (service) return logoProvider(service)
  }
  return undefined
}

export function loadModelLogoIndex(): Promise<ModelLogoIndex> {
  if (loading) return loading
  loading = (async () => {
    let cached: { time: number; index: ModelLogoIndex } | undefined
    try {
      cached = JSON.parse(localStorage.getItem(CACHE_KEY) || "null") ?? undefined
      if (cached?.index && Date.now() - cached.time < TTL) return cached.index
    } catch { /* Кэш необязателен. */ }
    try {
      const response = await fetch("https://models.dev/api.json", { signal: AbortSignal.timeout(10_000) })
      if (!response.ok) throw new Error(`models.dev: HTTP ${response.status}`)
      const index = createModelLogoIndex(await response.json())
      try { localStorage.setItem(CACHE_KEY, JSON.stringify({ time: Date.now(), index })) } catch { /* Квота кэша. */ }
      return index
    } catch {
      return cached?.index ?? {}
    }
  })()
  return loading
}
