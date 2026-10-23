import { cn } from "@/lib/utils"
import { IconTerminal2, IconWorldDownload, IconCode } from "@tabler/icons-react"
import type { Build } from "./types"
import { useTranslation } from "react-i18next"

interface InstanceBuildLaunchProps {
  build: Build
  updateBuild: (id: string, fields: Partial<Build>) => void
}

function parseEnvText(raw: string): Record<string, string> {
  const result: Record<string, string> = {}
  for (const line of (raw ?? "").split(/\r?\n/)) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith("#")) continue
    const eq = trimmed.indexOf("=")
    if (eq <= 0) continue
    result[trimmed.slice(0, eq).trim()] = trimmed.slice(eq + 1).trim()
  }
  return result
}

export function InstanceBuildLaunch({ build, updateBuild }: InstanceBuildLaunchProps) {
  const { t } = useTranslation()
  const customEnv = build.customEnv ?? ""

  return (
    <div data-ui="instance-instance-build-launch-div-1" data-component="instance-build-launch" className="space-y-6">
      <div data-ui="instance-instance-build-launch-div-2" className="rounded-3xl border border-border bg-card/40 p-6">
        <div data-ui="instance-instance-build-launch-div-3" className="flex items-start justify-between gap-4">
          <div data-ui="instance-instance-build-launch-div-4">
            <div data-ui="instance-instance-build-launch-div-5" className="flex items-center gap-2 text-lg font-semibold text-foreground">
              <IconTerminal2 className="h-5 w-5 text-primary" strokeWidth={1.75} />
              {t("build.launch.title")}
            </div>
            <p data-ui="instance-instance-build-launch-p-1" className="mt-1 text-sm text-muted-foreground">
              {t("build.launch.descBefore")}{" "}
              <code data-ui="instance-instance-build-launch-code-1" className="text-foreground">$INST_NAME</code>, <code data-ui="instance-instance-build-launch-code-2" className="text-foreground">$INST_MC_DIR</code>,{" "}
              <code data-ui="instance-instance-build-launch-code-3" className="text-foreground">$INST_JAVA</code>, <code data-ui="instance-instance-build-launch-code-4" className="text-foreground">$AUTH_PLAYER_NAME</code> {t("build.launch.descAfter")}
            </p>
          </div>
        </div>

        <div data-ui="instance-instance-build-launch-div-6" className="mt-6 grid gap-5">
          <div data-ui="instance-instance-build-launch-div-7" className="space-y-2">
            <label data-ui="instance-instance-build-launch-label-1" className="block text-xs font-medium text-muted-foreground">{t("build.launch.preLaunch")}</label>
            <textarea data-ui="instance-instance-build-launch-textarea-1"
              value={build.preLaunchCommand ?? ""}
              onChange={e => updateBuild(build.id, { preLaunchCommand: e.target.value })}
              placeholder={t("build.launch.preLaunchPlaceholder")}
              rows={3}
              className="w-full resize-y rounded-2xl border border-border bg-muted/40 px-4 py-3 text-sm text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:border-primary font-mono"
            />
          </div>

          <div data-ui="instance-instance-build-launch-div-8" className="space-y-2">
            <label data-ui="instance-instance-build-launch-label-2" className="block text-xs font-medium text-muted-foreground">{t("build.launch.postLaunch")}</label>
            <textarea data-ui="instance-instance-build-launch-textarea-2"
              value={build.postLaunchCommand ?? ""}
              onChange={e => updateBuild(build.id, { postLaunchCommand: e.target.value })}
              placeholder={t("build.launch.postLaunchPlaceholder")}
              rows={3}
              className="w-full resize-y rounded-2xl border border-border bg-muted/40 px-4 py-3 text-sm text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:border-primary font-mono"
            />
          </div>
        </div>
      </div>

      <div data-ui="instance-instance-build-launch-div-9" className="rounded-3xl border border-border bg-card/40 p-6">
        <div data-ui="instance-instance-build-launch-div-10" className="flex items-center gap-2 text-lg font-semibold text-foreground">
          <IconCode className="h-5 w-5 text-primary" strokeWidth={1.75} />
          {t("build.launch.wrapper")}
        </div>
        <p data-ui="instance-instance-build-launch-p-2" className="mt-1 text-sm text-muted-foreground">
          {t("build.launch.wrapperDescBefore")} <code data-ui="instance-instance-build-launch-code-5" className="text-foreground">optirun</code> {t("build.launch.wrapperDescOr")}{" "}
          <code data-ui="instance-instance-build-launch-code-6" className="text-foreground">primusrun</code> {t("build.launch.wrapperDescAfter")}
        </p>
        <div data-ui="instance-instance-build-launch-div-11" className="mt-4 space-y-2">
          <input data-ui="instance-instance-build-launch-input-1"
            type="text"
            value={build.wrapperCommand ?? ""}
            onChange={e => updateBuild(build.id, { wrapperCommand: e.target.value })}
            placeholder="optirun"
            className="h-11 w-full rounded-2xl border border-border bg-muted/40 px-4 text-sm text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:border-primary font-mono"
          />
        </div>
      </div>

      <div data-ui="instance-instance-build-launch-div-12" className="rounded-3xl border border-border bg-card/40 p-6">
        <div data-ui="instance-instance-build-launch-div-13" className="flex items-center gap-2 text-lg font-semibold text-foreground">
          <IconWorldDownload className="h-5 w-5 text-primary" strokeWidth={1.75} />
          {t("build.launch.env")}
        </div>
        <p data-ui="instance-instance-build-launch-p-3" className="mt-1 text-sm text-muted-foreground">
          {t("build.launch.envDescBefore")} <code data-ui="instance-instance-build-launch-code-7" className="text-foreground">KEY=VALUE</code> {t("build.launch.envDescAfter")}
        </p>
        <div data-ui="instance-instance-build-launch-div-14" className="mt-4 space-y-2">
          <textarea data-ui="instance-instance-build-launch-textarea-3"
            value={customEnv}
            onChange={e => updateBuild(build.id, { customEnv: e.target.value })}
            placeholder={"MAX_PLAYERS=10\nSERVER_PORT=25565"}
            rows={4}
            className="w-full resize-y rounded-2xl border border-border bg-muted/40 px-4 py-3 text-sm text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:border-primary font-mono"
          />
          <p data-ui="instance-instance-build-launch-p-4" className="text-xs text-muted-foreground">
            {t("build.launch.envCount", { count: Object.keys(parseEnvText(customEnv)).length })}
          </p>
        </div>
      </div>

    </div>
  )
}
