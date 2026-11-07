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
    <div data-ui="instance-instance-build-server-div-1" data-component="instance-build-server" className="launcher-settings-panel">
      <div data-ui="instance-instance-build-server-div-2" className="flex items-start justify-between gap-4">
        <div data-ui="instance-instance-build-server-div-3">
          <div data-ui="instance-instance-build-server-div-4" className="launcher-settings-heading flex items-center gap-2 font-semibold text-foreground">
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
          role="switch"
          aria-checked={override}
          aria-label={t("build.server.overrideOn")}
          title={override ? t("build.server.overrideOn") : t("build.java.useLauncher")}
          className="settings-switch"
        >
          <span className="settings-switch-thumb" />
        </button>
      </div>

      {override && (
        <div data-ui="instance-instance-build-server-div-5" className="mt-4 grid gap-4">
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