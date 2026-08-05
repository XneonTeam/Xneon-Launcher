import { LOADER_SVG_ICONS } from "./loader-icons"

interface LoaderIconProps {
  loaderId: string
  className?: string
}

export function LoaderIcon({ loaderId, className = "w-4 h-4" }: LoaderIconProps) {
  const svg = LOADER_SVG_ICONS[loaderId]
  if (!svg) return null

  return (
    <span
      className={className}
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  )
}
