import path from "node:path"
import { contentMetadataEvents } from "./content-metadata-events"
import { watch, realpathSync } from "node:fs"

/** Объединяем изменения файлов в один перескан после завершения копирования. */
export function watchBuildContent(directory: string, onChange: () => void, delay = 700): () => void {
  let timer: ReturnType<typeof setTimeout> | undefined
  const root = realpathSync.native(directory)
  const schedule = () => {
    clearTimeout(timer)
    timer = setTimeout(onChange, delay)
  }
  const metadataChanged = (files: string[]) => {
    if (files.some(file => {
      return [directory, root].some(base => {
        const relative = path.relative(base, file)
        return relative !== "" && !relative.startsWith("..") && !path.isAbsolute(relative)
      })
    })) schedule()
  }
  const watcher = watch(root, { recursive: true }, (_event, filename) => {
    const folder = filename?.toString().replace(/\\/g, "/").split("/")[0]?.toLowerCase()
    if (!folder || !["mods", "resourcepacks", "shaderpacks"].includes(folder)) return
    schedule()
  })
  contentMetadataEvents.on("updated", metadataChanged)
  const close = () => {
    clearTimeout(timer)
    contentMetadataEvents.off("updated", metadataChanged)
    watcher.close()
  }
  watcher.on("error", close)
  return close
}
