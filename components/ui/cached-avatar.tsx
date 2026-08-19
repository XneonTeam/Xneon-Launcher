import { useEffect, useState } from "react"

const FALLBACK_URL = "https://mcskinapi-three.vercel.app/avatar/Steve?skin_type=microsoft"

const imageCache = new Map<string, string>()
const inflightCache = new Map<string, Promise<string>>()

const STORE_KEY = "xnlc:avatar-cache:v1"
const AVATAR_TTL = 24 * 60 * 60 * 1000
const MAX_ENTRIES = 120
const MAX_TOTAL_BYTES = 4 * 1024 * 1024

type AvatarCacheEntry = { d: string; t: number }

let persistedCache: Record<string, AvatarCacheEntry> | null = null

function readPersisted(): Record<string, AvatarCacheEntry> {
  if (persistedCache) return persistedCache
  try {
    const raw = localStorage.getItem(STORE_KEY)
    persistedCache = raw ? (JSON.parse(raw) as Record<string, AvatarCacheEntry>) : {}
  } catch {
    persistedCache = {}
  }
  return persistedCache
}

function writePersisted() {
  if (!persistedCache) return
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(persistedCache))
  } catch {
    // storage full — drop cache silently
  }
}

function isStale(entry: AvatarCacheEntry) {
  return Date.now() - entry.t > AVATAR_TTL
}

function pruneAndStore(url: string, dataUrl: string) {
  const cache = readPersisted()
  cache[url] = { d: dataUrl, t: Date.now() }
  let totalBytes = 0
  let overflow = 0
  for (const key of Object.keys(cache)) {
    if (isStale(cache[key])) {
      delete cache[key]
      continue
    }
    totalBytes += cache[key].d.length
  }
  overflow = Math.max(0, Object.keys(cache).length - MAX_ENTRIES)
  const sorted = Object.keys(cache).sort((a, b) => cache[a].t - cache[b].t)
  for (const key of sorted.slice(0, overflow)) delete cache[key]
  for (const key of Object.keys(cache)) {
    if (totalBytes > MAX_TOTAL_BYTES) {
      const removed = cache[key].d.length
      delete cache[key]
      totalBytes -= removed
    }
  }
  writePersisted()
}

async function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result as string)
    reader.onerror = () => reject(reader.error)
    reader.readAsDataURL(blob)
  })
}

async function loadImage(url: string): Promise<string> {
  const cached = imageCache.get(url)
  if (cached !== undefined) return cached
  const persisted = readPersisted()[url]
  if (persisted && !isStale(persisted)) {
    imageCache.set(url, persisted.d)
    return persisted.d
  }
  const existing = inflightCache.get(url)
  if (existing) return existing

  const promise = (async () => {
    try {
      const res = await fetch(url)
      if (!res.ok) throw new Error(String(res.status))
      const blob = await res.blob()
      const objectUrl = URL.createObjectURL(blob)
      imageCache.set(url, objectUrl)
      void blobToDataUrl(blob).then((dataUrl) => pruneAndStore(url, dataUrl)).catch(() => {})
      return objectUrl
    } catch {
      imageCache.set(url, "")
      return ""
    } finally {
      inflightCache.delete(url)
    }
  })()

  inflightCache.set(url, promise)
  return promise
}

/**
 * Returns the avatar URL, replaced with a cached object URL once fetched.
 * Subsequent renders reuse the module-level cache and never hit the network.
 */
function useCachedImageUrl(url: string): string {
  const [src, setSrc] = useState<string>(() => {
    const persisted = readPersisted()[url]
    if (persisted && !isStale(persisted)) return persisted.d
    return imageCache.get(url) ?? url
  })

  useEffect(() => {
    const cached = imageCache.get(url)
    if (cached !== undefined) {
      setSrc(cached || url)
      return
    }
    const persisted = readPersisted()[url]
    if (persisted && !isStale(persisted)) {
      imageCache.set(url, persisted.d)
      setSrc(persisted.d)
      return
    }
    let cancelled = false
    void loadImage(url).then((result) => {
      if (!cancelled) setSrc(result || url)
    })
    return () => {
      cancelled = true
    }
  }, [url])

  return src
}

interface CachedAvatarProps {
  src: string
  fallbackSrc?: string
  alt?: string
  className?: string
  style?: React.CSSProperties
}

/**
 * <img> wrapper that caches fetched avatars to localStorage and as object URLs,
 * so re-opening a tab or restarting the app never re-downloads the same avatar.
 * Falls back to a placeholder head and hides the image if both requests fail.
 */
export function CachedAvatar({ src, fallbackSrc = FALLBACK_URL, alt = "", className, style }: CachedAvatarProps) {
  const resolved = useCachedImageUrl(src)
  const [failed, setFailed] = useState(false)
  const [failedFallback, setFailedFallback] = useState(false)

  useEffect(() => {
    setFailed(false)
    setFailedFallback(false)
  }, [src])

  if (failedFallback) return null

  const current = failed ? fallbackSrc : resolved
  return (
    <img
      src={current}
      alt={alt}
      className={className}
      style={style}
      onError={() => {
        if (failed) {
          setFailedFallback(true)
        } else {
          setFailed(true)
        }
      }}
    />
  )
}