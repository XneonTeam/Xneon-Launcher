import path from "path"
import fs from "fs/promises"
import type { LauncherInstance } from "./helpers"
import { copyDirContents, fileExists, readVersionSelection } from "./helpers"

export async function importInstanceVersions(
  instance: LauncherInstance,
  sourceRoot: string,
  intentPath: string,
): Promise<{ versionId?: string; copiedFiles: number }> {
  // Профили Modrinth Forge/NeoForge содержат processors и ссылки на результаты
  // патчинга, которые нельзя запускать как готовый custom-профиль. Установку
  // загрузчика выполняет штатный обработчик XNLC по версии из базы Modrinth.
  if (instance.source === "modrinthapp"
    && (instance.modLoader === "forge" || instance.modLoader === "neoforge")
    && instance.loaderVersion) return { copiedFiles: 0 }
  if (!instance.gameDataRoot) return { copiedFiles: 0 }
  const sourceVersions = path.join(instance.gameDataRoot, "versions")
  const selection = instance.versionId
    ? { id: instance.versionId }
    : await readVersionSelection(sourceVersions, [instance.modLoader, instance.loaderVersion ?? ""])
  const sourceVersionDir = selection ? path.join(sourceVersions, selection.id) : ""
  if (!selection || path.normalize(sourceVersionDir) === path.normalize(sourceRoot)
    || !(await fileExists(path.join(sourceVersionDir, `${selection.id}.json`)))) {
    return { copiedFiles: 0 }
  }

  const copiedFiles = await copyDirContents([sourceVersionDir], path.join(intentPath, "versions", selection.id))
  return { versionId: copiedFiles > 0 ? selection.id : undefined, copiedFiles }
}
