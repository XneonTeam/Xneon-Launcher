import type { CloudProvider, CloudProviderId } from "./provider"
import { GoogleDriveProvider } from "./providers/google-drive"
import { DropboxProvider } from "./providers/dropbox"
import { YandexDiskProvider } from "./providers/yandex-disk"
import { WebDavProvider } from "./providers/webdav"
import { OneDriveProvider } from "./providers/onedrive"

const providers: Record<CloudProviderId, CloudProvider> = {
  "google-drive": new GoogleDriveProvider(),
  "dropbox": new DropboxProvider(),
  "yandex-disk": new YandexDiskProvider(),
  "webdav": new WebDavProvider(),
  "onedrive": new OneDriveProvider(),
}

export function getProvider(id: CloudProviderId): CloudProvider {
  const p = providers[id]
  if (!p) throw new Error(`Unknown provider: ${id}`)
  return p
}

export function listProviders(): { id: CloudProviderId; name: string }[] {
  return Object.values(providers).map(p => ({ id: p.id, name: p.name }))
}

export type { CloudProvider, CloudProviderId }
