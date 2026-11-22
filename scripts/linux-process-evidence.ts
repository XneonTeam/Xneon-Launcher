import { readdir, readFile, readlink } from "node:fs/promises"

export async function processTree(rootPid: number) {
  const rows = await Promise.all((await readdir("/proc")).filter(value => /^\d+$/.test(value)).map(async value => {
    const pid = Number(value)
    const status = await readFile(`/proc/${pid}/status`, "utf8").catch(() => "")
    const ppid = Number(status.match(/^PPid:\s*(\d+)/m)?.[1])
    const args = await readFile(`/proc/${pid}/cmdline`, "utf8").catch(() => "")
    return { pid, ppid, args: args.replaceAll("\0", " "), executable: await readlink(`/proc/${pid}/exe`).catch(() => "") }
  }))
  const selected = new Set([rootPid])
  let changed = true
  while (changed) { changed = false; for (const row of rows) if (selected.has(row.ppid) && !selected.has(row.pid)) { selected.add(row.pid); changed = true } }
  return rows.filter(row => selected.has(row.pid))
}

export async function assertOwnedEndpoint(port: number, pids: number[], nonce: string) {
  const sockets = new Set<string>()
  for (const table of ["tcp", "tcp6"]) {
    const text = await readFile(`/proc/net/${table}`, "utf8")
    for (const line of text.trim().split("\n").slice(1)) {
      const fields = line.trim().split(/\s+/)
      if (parseInt(fields[1].split(":")[1], 16) === port && fields[3] === "0A") sockets.add(fields[9])
    }
  }
  for (const pid of pids) {
    const environment = await readFile(`/proc/${pid}/environ`, "utf8").catch(() => "")
    if (!environment.split("\0").includes(`XNLC_E2E_NONCE=${nonce}`)) continue
    for (const fd of await readdir(`/proc/${pid}/fd`).catch(() => [])) {
      const link = await readlink(`/proc/${pid}/fd/${fd}`).catch(() => "")
      const inode = link.match(/^socket:\[(\d+)\]$/)?.[1]
      if (inode && sockets.has(inode)) return pid
    }
  }
  throw new Error("CDP endpoint is not owned by this launch and nonce")
}
