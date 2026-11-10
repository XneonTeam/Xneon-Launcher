import { createHash, randomUUID } from "node:crypto"
import { mkdir, readFile, writeFile } from "node:fs/promises"
import { createConnection, createServer, type Socket } from "node:net"
import path from "node:path"
import { launcherOperations } from "../platform/operation-gate"

const maxFrame = 4096
const responseTimeout = 15 * 60 * 1000
const validName = (name: unknown): name is string =>
  typeof name === "string" && Boolean(name.trim()) && name.length <= 150 && !/[\u0000-\u001f]/.test(name)

export function parseCliLaunch(args: string[]): string | null {
  const index = args.indexOf("--launch")
  if (index < 0) return null
  const name = args[index + 1]
  if (!validName(name) || name.startsWith("--")) throw new Error("Usage: --launch <buildName>")
  return name
}

type Completion = (error?: string) => void
type Command = { id: string; build: string | null; done: Completion; owner?: number }
export class CliQueue {
  private readonly commands: Command[] = []
  private focus?: () => void
  private changed?: () => void
  private closed = false

  enqueue(build: string | null, done: Completion): () => void {
    if (this.closed || this.commands.length >= 32) {
      done("Launcher is closing or its command queue is full.")
      return () => {}
    }
    const command = { id: randomUUID(), build, done }
    this.commands.push(command)
    this.notify()
    return () => {
      const index = this.commands.indexOf(command)
      if (index >= 0 && this.commands[index].owner === undefined) {
        this.commands.splice(index, 1)
        this.notify()
      }
    }
  }

  attach(focus: () => void, changed: () => void) {
    this.focus = focus
    this.changed = changed
    this.notify()
  }

  detach(owner: number) {
    this.focus = undefined
    this.changed = undefined
    const active = this.commands[0]
    if (active?.owner === owner) this.finish(active.id, owner, "The launcher window closed during command execution.")
  }

  private notify() {
    if (!this.focus) return
    // Запрос фокуса не ждёт завершения запуска игры.
    for (const command of [...this.commands]) {
      if (command.build !== null) continue
      this.commands.splice(this.commands.indexOf(command), 1)
      this.focus()
      command.done()
    }
    if (this.peek()) {
      this.focus()
      this.changed?.()
    }
  }

  peek() {
    const command = this.commands[0]
    return command && command.build !== null && command.owner === undefined
      ? { id: command.id, build: command.build }
      : null
  }

  claim(id: string, owner: number) {
    const command = this.peek()
    if (command?.id !== id) return null
    this.commands[0].owner = owner
    return command
  }

  finish(id: string, owner: number, error?: string) {
    const command = this.commands[0]
    if (!command || command.id !== id || command.owner !== owner) return
    this.commands.shift()
    command.done(error)
    this.notify()
  }

  close(error: string) {
    this.closed = true
    for (const command of this.commands.splice(0)) command.done(error)
  }
}

export const cli = new CliQueue()

function endpoint(profile: string) {
  const hash = createHash("sha256").update(profile.toLowerCase()).digest("hex").slice(0, 32)
  return { pipe: "\\\\.\\pipe\\XneonLauncher-" + hash, tokenPath: profile + ".cli" }
}

function readFrame(socket: Socket, onFrame: (data: unknown) => void) {
  let frame = ""
  socket.setEncoding("utf8")
  const receive = (chunk: string) => {
    frame += chunk
    if (Buffer.byteLength(frame) > maxFrame) return socket.destroy(new Error("CLI frame too large"))
    const end = frame.indexOf("\n")
    if (end < 0) return
    socket.off("data", receive)
    let message
    try { message = JSON.parse(frame.slice(0, end)) }
    catch { return socket.destroy(new Error("Invalid CLI response")) }
    onFrame(message)
  }
  socket.on("data", receive)
}

export async function startCliListener(profile: string) {
  const { pipe, tokenPath } = endpoint(profile)
  const token = randomUUID()
  await mkdir(path.dirname(tokenPath), { recursive: true })
  await writeFile(tokenPath, token, { mode: 0o600 })
  const server = createServer(socket => {
    socket.on("error", () => socket.destroy())
    socket.setTimeout(5000, () => socket.destroy())
    readFrame(socket, data => {
      const request = data as { token?: string; build?: string | null } | null
      if (request?.token !== token || (request.build !== null && !validName(request.build)) || launcherOperations.blocked) {
        socket.end(JSON.stringify({ error: launcherOperations.blocked ? "Launcher is preparing to restart." : "Invalid launcher command" }) + "\n")
        return
      }
      socket.setTimeout(responseTimeout)
      const cancel = cli.enqueue(request.build, error => {
        if (!socket.destroyed) socket.end(JSON.stringify({ error: error?.slice(0, 500) ?? null }) + "\n")
      })
      socket.once("close", cancel)
    })
  })
  server.maxConnections = 64
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject)
    server.listen(pipe, () => {
      server.off("error", reject)
      server.on("error", error => cli.close(error.message))
      resolve()
    })
  })
  server.unref()
}

export async function forwardCli(profile: string, build: string | null) {
  const { pipe, tokenPath } = endpoint(profile)
  const deadline = Date.now() + 5000
  let delivered = false
  do {
    try {
      const token = await readFile(tokenPath, "utf8")
      await new Promise<void>((resolve, reject) => {
        const socket = createConnection(pipe)
        socket.setTimeout(5000, () => socket.destroy(new Error("Launcher did not acknowledge the command.")))
        socket.once("error", reject)
        socket.once("close", () => reject(new Error("Primary launcher closed before acknowledging the command.")))
        socket.once("connect", () => {
          delivered = true
          socket.setTimeout(responseTimeout)
          socket.write(JSON.stringify({ token, build }) + "\n")
        })
        readFrame(socket, data => {
          const result = data as { error?: string | null } | null
          socket.destroy()
          if (result?.error === null) resolve()
          else reject(new Error(result?.error || "Invalid launcher acknowledgement."))
        })
      })
      return
    } catch (error) {
      if (delivered || Date.now() >= deadline) throw error
      await new Promise(resolve => setTimeout(resolve, 100))
    }
  } while (true)
}
