import fs from "node:fs/promises"
import path from "node:path"
import { remoteFilePath, ShareError, assertRemoteServerOperation, serverPermissions, MAX_FILE_BYTES } from "@xnlc/share"

/** Проверяем каждый сегмент: существующий локальный junction не должен открывать чужие каталоги. */
export async function assertRemoteServerPaths(root: string, channel: string, args: unknown[]): Promise<void> {
  const fixed: Record<string, string> = { "mc-server:read-properties": "server.properties", "mc-server:write-properties": "server.properties", "mc-server:update": "server.properties", "mc-server:check-eula": "eula.txt", "mc-server:accept-eula": "eula.txt", "mc-server:get-whitelist": "whitelist.json", "mc-server:add-whitelist": "whitelist.json", "mc-server:remove-whitelist": "whitelist.json", "mc-server:get-ops": "ops.json", "mc-server:add-op": "ops.json", "mc-server:remove-op": "ops.json", "mc-server:get-banned": "banned-players.json", "mc-server:ban-player": "banned-players.json", "mc-server:unban-player": "banned-players.json", "mc-server:get-banned-ips": "banned-ips.json", "mc-server:ban-ip": "banned-ips.json", "mc-server:unban-ip": "banned-ips.json" }
  if (!fixed[channel] && !channel.startsWith("mc-server:fs-") && channel !== "mc-server:resolve-installed") return
  const paths = [fixed[channel] ?? remoteFilePath(args[0], ["mc-server:fs-list", "mc-server:fs-download", "mc-server:resolve-installed"].includes(channel))]
  if (channel === "mc-server:fs-rename") paths.push(remoteFilePath(args[1]))
  if (channel === "mc-server:fs-download") paths.push([paths[0], remoteFilePath(args[2])].filter(Boolean).join("/"))
  await fs.mkdir(root, { recursive: true })
  const base = await fs.realpath(root)
  for (const relative of paths) {
    let target = base
    for (const part of relative.split("/").filter(Boolean)) {
      target = path.join(target, part)
      const stat = await fs.lstat(target).catch(error => { if (error.code === "ENOENT") return null; throw error })
      if (stat?.isSymbolicLink()) throw new ShareError("PATH", "Remote server symbolic links are forbidden")
    }
    // Удаление/переименование папки с junction внутри иначе затронуло бы чужую директорию.
    if (["mc-server:fs-delete", "mc-server:fs-rename"].includes(channel)) {
      const walk = async (entry: string) => {
        const stat = await fs.lstat(entry).catch(error => { if (error.code === "ENOENT") return null; throw error })
        if (stat?.isSymbolicLink()) throw new ShareError("PATH", "Remote server symbolic links are forbidden")
        if (stat?.isDirectory()) for (const item of await fs.readdir(entry)) await walk(path.join(entry, item))
      }
      await walk(target)
    }
  }
}

export async function downloadRemoteServerFile(root: string, args: unknown[]) {
  let url = String(args[1])
  const signal = AbortSignal.timeout(45000)
  for (let redirects = 0; redirects < 4; redirects++) {
    assertRemoteServerOperation(serverPermissions(true), "mc-server:fs-download", [args[0], url, args[2]])
    const response = await fetch(url, { redirect: "manual", signal })
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const next = response.headers.get("location")
      await response.body?.cancel()
      if (!next) throw new ShareError("URL", "Remote download redirect is invalid")
      url = new URL(next, url).href
      continue
    }
    if (!response.ok || !response.body) { await response.body?.cancel(); throw new ShareError("DOWNLOAD", "Remote download failed") }
    if (Number(response.headers.get("content-length")) > MAX_FILE_BYTES) { await response.body.cancel(); throw new ShareError("SIZE", "Remote download exceeds 32 MiB") }
    const chunks: Uint8Array[] = []; let size = 0
    for await (const chunk of response.body as any as AsyncIterable<Uint8Array>) {
      size += chunk.byteLength
      if (size > MAX_FILE_BYTES) throw new ShareError("SIZE", "Remote download exceeds 32 MiB")
      chunks.push(chunk)
    }
    await assertRemoteServerPaths(root, "mc-server:fs-download", args)
    const target = path.join(root, String(args[0]), String(args[2]))
    await fs.mkdir(path.dirname(target), { recursive: true })
    await fs.writeFile(target, Buffer.concat(chunks))
    return { success: true }
  }
  throw new ShareError("URL", "Remote download redirect limit exceeded")
}
