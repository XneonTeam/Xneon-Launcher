import { DEV_RENDERER_URL } from "./dev-renderer-address.mjs"
export { DEV_RENDERER_HOST, DEV_RENDERER_PORT, DEV_RENDERER_URL } from "./dev-renderer-address.mjs"

/** HMR разрешён только явной dev-сборке; адрес не берётся из runtime-окружения. */
export function launcherEntryUrl(channel: string, hmrEnabled: boolean): string {
  return channel === "dev" && hmrEnabled ? DEV_RENDERER_URL : "views://launcher/index.html"
}
