declare module "sql.js"
declare module "adm-zip"
declare module "discord-rpc" {
  export class Client {
    constructor(options: { transport: "ipc" | "websocket"; transportOptions?: Record<string, unknown> })
    login(options: { clientId: string }): Promise<void>
    setActivity(activity: Record<string, unknown>): Promise<void>
    clearActivity(): Promise<void>
    destroy(): Promise<void>
    on(event: "ready", listener: () => void): this
    on(event: "error", listener: (err: { code: number }) => void): this
    on(event: "disconnected", listener: () => void): this
  }
}
