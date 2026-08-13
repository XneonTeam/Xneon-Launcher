import { cn } from "@/lib/utils"
import { IconTerminal2, IconWorldDownload, IconCode } from "@tabler/icons-react"
import type { Build } from "./types"

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
  const customEnv = build.customEnv ?? ""

  return (
    <div className="space-y-6">
      <div className="rounded-3xl border border-border bg-card/40 p-6">
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-2 text-lg font-semibold text-foreground">
              <IconTerminal2 className="h-5 w-5 text-muted-foreground" strokeWidth={1.75} />
              Команды запуска
            </div>
            <p className="mt-1 text-sm text-muted-foreground">
              Pre-launch и post-launch команды, выполняемые до и после игры. Поддерживаются переменные{" "}
              <code className="text-foreground">$INST_NAME</code>, <code className="text-foreground">$INST_MC_DIR</code>,{" "}
              <code className="text-foreground">$INST_JAVA</code>, <code className="text-foreground">$AUTH_PLAYER_NAME</code> и другие.
            </p>
          </div>
        </div>

        <div className="mt-6 grid gap-5">
          <div className="space-y-2">
            <label className="block text-xs font-medium text-muted-foreground">Pre-launch команда</label>
            <textarea
              value={build.preLaunchCommand ?? ""}
              onChange={e => updateBuild(build.id, { preLaunchCommand: e.target.value })}
              placeholder={"echo \"Запуск $INST_NAME\"\n./scripts/setup.sh"}
              rows={3}
              className="w-full resize-y rounded-2xl border border-border bg-muted/40 px-4 py-3 text-sm text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:border-primary font-mono"
            />
          </div>

          <div className="space-y-2">
            <label className="block text-xs font-medium text-muted-foreground">Post-launch команда</label>
            <textarea
              value={build.postLaunchCommand ?? ""}
              onChange={e => updateBuild(build.id, { postLaunchCommand: e.target.value })}
              placeholder={"echo \"Игра $INST_NAME завершена\""}
              rows={3}
              className="w-full resize-y rounded-2xl border border-border bg-muted/40 px-4 py-3 text-sm text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:border-primary font-mono"
            />
          </div>
        </div>
      </div>

      <div className="rounded-3xl border border-border bg-card/40 p-6">
        <div className="flex items-center gap-2 text-lg font-semibold text-foreground">
          <IconCode className="h-5 w-5 text-muted-foreground" strokeWidth={1.75} />
          Wrapper-команда
        </div>
        <p className="mt-1 text-sm text-muted-foreground">
          Программа, через которую запускается Java (например <code className="text-foreground">optirun</code> или{" "}
          <code className="text-foreground">primusrun</code> для NVIDIA Optimus). Пусто — запуск напрямую.
        </p>
        <div className="mt-4 space-y-2">
          <input
            type="text"
            value={build.wrapperCommand ?? ""}
            onChange={e => updateBuild(build.id, { wrapperCommand: e.target.value })}
            placeholder="optirun"
            className="h-11 w-full rounded-2xl border border-border bg-muted/40 px-4 text-sm text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:border-primary font-mono"
          />
        </div>
      </div>

      <div className="rounded-3xl border border-border bg-card/40 p-6">
        <div className="flex items-center gap-2 text-lg font-semibold text-foreground">
          <IconWorldDownload className="h-5 w-5 text-muted-foreground" strokeWidth={1.75} />
          Переменные окружения
        </div>
        <p className="mt-1 text-sm text-muted-foreground">
          Дополнительные переменные окружения для процесса игры. По одной <code className="text-foreground">KEY=VALUE</code> на строку.
        </p>
        <div className="mt-4 space-y-2">
          <textarea
            value={customEnv}
            onChange={e => updateBuild(build.id, { customEnv: e.target.value })}
            placeholder={"MAX_PLAYERS=10\nSERVER_PORT=25565"}
            rows={4}
            className="w-full resize-y rounded-2xl border border-border bg-muted/40 px-4 py-3 text-sm text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:border-primary font-mono"
          />
          <p className="text-xs text-muted-foreground">
            Распознано переменных: {Object.keys(parseEnvText(customEnv)).length}
          </p>
        </div>
      </div>

    </div>
  )
}
