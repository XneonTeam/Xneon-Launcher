import { cn } from "@/lib/utils"
import { IconServer } from "@tabler/icons-react"
import type { Build } from "./types"

interface InstanceBuildServerProps {
  build: Build
  updateBuild: (id: string, fields: Partial<Build>) => void
}

export function InstanceBuildServer({ build, updateBuild }: InstanceBuildServerProps) {
  const override = build.serverOverride === true
  const server = build.server ?? ""
  const port = build.serverPort ?? "25565"

  return (
    <div className="rounded-3xl border border-border bg-card/40 p-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 text-lg font-semibold text-foreground">
            <IconServer className="h-5 w-5 text-muted-foreground" strokeWidth={1.75} />
            Автоподключение к серверу
          </div>
          <p className="mt-1 text-sm text-muted-foreground">
            При запуске этой сборки Minecraft автоматически подключится к указанному серверу. Если выключено — используется сервер из общих настроек лаунчера.
          </p>
        </div>
        <button
          type="button"
          onClick={() => updateBuild(build.id, { serverOverride: !override })}
          className={cn(
            "flex items-center gap-2 rounded-full px-4 py-2 text-xs font-semibold transition-colors",
            override ? "bg-primary text-primary-foreground" : "bg-muted/60 text-muted-foreground hover:bg-muted"
          )}
        >
          <span className={cn("w-2 h-2 rounded-full", override ? "bg-primary-foreground" : "bg-muted-foreground/50")} />
          {override ? "Свой сервер включён" : "Использовать настройки лаунчера"}
        </button>
      </div>

      {override && (
        <div className="mt-6 grid gap-5">
          <div className="space-y-2">
            <label className="block text-xs font-medium text-muted-foreground">IP адрес</label>
            <input
              type="text"
              value={server}
              onChange={e => updateBuild(build.id, { server: e.target.value })}
              placeholder="play.example.com"
              className="h-11 w-full rounded-2xl border border-border bg-muted/40 px-4 text-sm text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:border-primary"
            />
          </div>
          <div className="space-y-2">
            <label className="block text-xs font-medium text-muted-foreground">Порт</label>
            <input
              type="text"
              value={port}
              onChange={e => updateBuild(build.id, { serverPort: e.target.value })}
              placeholder="25565"
              className="h-11 w-full rounded-2xl border border-border bg-muted/40 px-4 text-sm text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:border-primary"
            />
          </div>
        </div>
      )}
    </div>
  )
}