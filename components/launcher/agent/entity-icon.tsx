import { useState } from "react"
import { IconColorSwatch, IconPuzzle, IconPhoto, IconSparkles, IconArchive, IconFileText, IconLayoutGrid, IconServer } from "@tabler/icons-react"
import { EntityIcon } from "../instance/entity-icon"
import { LoaderIcon } from "../instance/loader-icon"

const icons = { build: IconColorSwatch, mod: IconPuzzle, resourcepack: IconPhoto, shader: IconSparkles, datapack: IconArchive, file: IconFileText, log: IconFileText, crash: IconFileText, project: IconLayoutGrid, server: IconServer }

export function AgentEntityIcon({ src, kind = "project", className = "", name, loader }: { src?: string | null; kind?: string; className?: string; name?: string; loader?: string }) {
  const [failed, setFailed] = useState<string | null>(null)
  const typeIcon = Object.hasOwn(icons, kind) ? icons[kind as keyof typeof icons] : undefined
  const Icon = typeIcon || IconLayoutGrid
  return <span className={`agent-entity-icon ${className}`}>
    {src && failed !== src ? <EntityIcon src={src} className="agent-entity-image p-[6%] text-primary" imgClassName="agent-entity-image object-cover" onImgError={() => setFailed(src)} /> : kind === "build" ? <LoaderIcon loaderId={loader || "vanilla"} className="h-full w-full p-[20%] text-primary/40" /> : !typeIcon && name ? <span className="text-sm font-semibold text-muted-foreground">{name[0]}</span> : <Icon size={20} strokeWidth={1.75} />}
  </span>
}
