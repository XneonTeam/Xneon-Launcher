import path from "node:path"

/** GNU tar из Git трактует Windows drive-letter как удалённый host; нужен штатный bsdtar. */
export function nativeTarExecutable(platform = process.platform, env: Record<string, string | undefined> = process.env): string {
  return platform === "win32"
    ? path.win32.join(env.SystemRoot || env.WINDIR || "C:\\Windows", "System32", "tar.exe")
    : "tar"
}
