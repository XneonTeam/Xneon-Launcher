export function remoteServerError(error: unknown, t: (key: string) => string): string {
  const message = error instanceof Error ? error.message : String(error)
  if (/ACCOUNT_REQUIRED|non-offline/i.test(message)) return t("remoteServer.error.account")
  if (/OFFLINE|TIMEOUT|fetch failed|WebSocket|network/i.test(message)) return t("remoteServer.error.offline")
  if (/FORBIDDEN|permission|membership/i.test(message)) return t("remoteServer.error.permission")
  if (/INVITE|invitation|code/i.test(message)) return t("remoteServer.error.invite")
  return t("remoteServer.error.generic")
}
