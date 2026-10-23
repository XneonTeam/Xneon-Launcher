import { cn } from "@/lib/utils"
import { IconServer } from "@tabler/icons-react"
import type { Build } from "./types"
import { useTranslation } from "react-i18next"

interface InstanceBuildServerProps {
  build: Build
  updateBuild: (id: string, fields: Partial<Build>) => void
}

export function InstanceBuildServer({ build, updateBuild }: InstanceBuildServerProps) {
  const { t } = useTranslation()
  const override = build.serverOverride === true
  const server = build.server ?? ""
  const port = build.serverPort ?? "25565"

  return (
    <div data-ui="instance-instance-build-server-div-1" data-component="instance-build-server" className="rounded-3xl border border-border bg-card/40 p-6">
      <div data-ui="instance-instance-build-server-div-2" className="flex items-start justify-between gap-4">
        <div data-ui="instance-instance-build-server-div-3">
          <div data-ui="instance-instance-build-server-div-4" className="flex items-center gap-2 text-lg font-semibold text-foreground">
            <IconServer className="h-5 w-5 text-primary" strokeWidth={1.75} />
            {t("build.server.title")}
          </div>
          <p data-ui="instance-instance-build-server-p-1" className="mt-1 text-sm text-muted-foreground">
            {t("build.server.desc")}
          </p>
        </div>
        <button data-ui="instance-instance-build-server-button-1"
          type="button"
          onClick={() => updateBuild(build.id, { serverOverride: !override })}
          className={cn(
            "flex items-center gap-2 rounded-full px-4 py-2 text-xs font-semibold transition-colors",
            override ? "bg-primary text-primary-foreground" : "bg-muted/60 text-muted-foreground hover:bg-muted"
          )}
        >
          <span data-ui="instance-instance-build-server-span-1" className={cn("w-2 h-2 rounded-full", override ? "bg-primary-foreground" : "bg-muted-foreground/50")} />
          {override ? t("build.server.overrideOn") : t("build.java.useLauncher")}
        </button>
      </div>

      {override && (
        <div data-ui="instance-instance-build-server-div-5" className="mt-6 grid gap-5">
          <div data-ui="instance-instance-build-server-div-6" className="space-y-2">
            <label data-ui="instance-instance-build-server-label-1" className="block text-xs font-medium text-muted-foreground">{t("build.server.ip")}</label>
            <input data-ui="instance-instance-build-server-input-1"
              type="text"
              value={server}
              onChange={e => updateBuild(build.id, { server: e.target.value })}
              placeholder="play.example.com"
              className="h-11 w-full rounded-2xl border border-border bg-muted/40 px-4 text-sm text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:border-primary"
            />
          </div>
          <div data-ui="instance-instance-build-server-div-7" className="space-y-2">
            <label data-ui="instance-instance-build-server-label-2" className="block text-xs font-medium text-muted-foreground">{t("build.server.port")}</label>
            <input data-ui="instance-instance-build-server-input-2"
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