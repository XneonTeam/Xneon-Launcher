export const DEV_RENDERER_HOST = "127.0.0.1"
export const DEV_RENDERER_PORT = 5173
export const DEV_RENDERER_URL = `http://${DEV_RENDERER_HOST}:${DEV_RENDERER_PORT}/`

/** HMR разрешён только явной dev-сборке; адрес не берётся из runtime-окружения. */
export function launcherEntryUrl(channel: string, hmrEnabled: boolean): string {
  return channel === "dev" && hmrEnabled ? DEV_RENDERER_URL : "views://launcher/index.html"
}
