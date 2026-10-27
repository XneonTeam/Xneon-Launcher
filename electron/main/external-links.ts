import { shell } from "electron"

export async function openExternalLink(value: string): Promise<void> {
  let url: URL
  try { url = new URL(value) } catch { return }
  if (!["https:", "http:", "mailto:"].includes(url.protocol)) return
  await shell.openExternal(url.href)
}
