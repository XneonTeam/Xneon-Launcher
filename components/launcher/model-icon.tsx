import { useEffect, useState } from "react"
import { IconSparkles } from "@tabler/icons-react"
import { loadModelLogoIndex, findModelLogoProvider } from "@/lib/model-logos"
import { loadModelLogoAsset } from "@/lib/model-logo-assets"

export function ModelIcon({ model, className = "size-4" }: { model: string; className?: string }) {
  const [asset, setAsset] = useState<{ url: string; invert: boolean }>()
  const [failed, setFailed] = useState<string>()
  useEffect(() => {
    let active = true
    setAsset(undefined)
    void loadModelLogoIndex().then(async index => {
      const provider = findModelLogoProvider(index, model)
      const next = provider ? await loadModelLogoAsset(index, provider) : undefined
      if (active) setAsset(next)
    })
    return () => { active = false }
  }, [model])
  const url = asset?.url
  return url && failed !== url
    ? <img src={url} alt="" aria-hidden="true" loading="lazy" className={"shrink-0 object-contain " + (asset?.invert ? "dark:invert " : "rounded-sm ") + className} onError={() => setFailed(url)} />
    : <IconSparkles aria-hidden="true" className={"shrink-0 " + className} strokeWidth={1.75} />
}
