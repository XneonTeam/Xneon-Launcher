import type { ModCategory } from "@xnlc/types"

export type { ModalTab } from "@/components/launcher/instance/types"

export interface SelectedAddonCategory {
  name: string
  source?: "modrinth" | "curseforge"
}

export type ContentCategory = ModCategory & { source?: "modrinth" | "curseforge" }
