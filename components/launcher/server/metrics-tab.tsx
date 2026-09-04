import { useTranslation } from "react-i18next"
import { cn } from "@/lib/utils"
import { useMcServerMetrics } from "@/src/hooks/use-mc-servers"
import { IconActivity, IconCpu, IconClock, IconDatabase } from "@tabler/icons-react"

interface MetricsTabProps {
  serverId: string
  isRunning: boolean
  xmx: number
}

function formatUptime(seconds: number): string {
  if (seconds < 60) return `${seconds}s`
  const m = Math.floor(seconds / 60)
  if (m < 60) return `${m}m ${seconds % 60}s`
  const h = Math.floor(m / 60)
  return `${h}h ${m % 60}m`
}

export function MetricsTab({ serverId, isRunning, xmx }: MetricsTabProps) {
  const { t } = useTranslation()
  const metrics = useMcServerMetrics(serverId, isRunning)

  const cpu = metrics.cpuPercent
  const mem = metrics.memoryMb
  const memPct = xmx > 0 ? Math.min((mem / xmx) * 100, 100) : 0

  if (!isRunning) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-4 text-center">
        <div className="w-16 h-16 rounded-2xl bg-muted/50 flex items-center justify-center">
          <IconActivity className="w-8 h-8 text-muted-foreground" strokeWidth={1.5} />
        </div>
        <div>
          <p className="font-medium text-foreground">{t("servers.metricsTitle")}</p>
          <p className="text-sm text-muted-foreground mt-1">{t("servers.startToSeeMetrics")}</p>
        </div>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-5 p-4 overflow-y-auto h-full">
      {/* CPU Card */}
      <div className="rounded-2xl border border-border bg-card p-4 space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-green-500/15 flex items-center justify-center">
              <IconCpu className="w-4 h-4 text-green-400" />
            </div>
            <span className="text-sm font-medium text-foreground">CPU</span>
          </div>
          <span className="text-sm font-mono font-bold text-foreground">{cpu.toFixed(1)}%</span>
        </div>
        <div className="h-2.5 rounded-full bg-muted overflow-hidden">
          <div
            className={cn(
              "h-full rounded-full transition-all duration-500",
              cpu > 80 ? "bg-red-500" : cpu > 50 ? "bg-yellow-500" : "bg-green-500"
            )}
            style={{ width: `${Math.min(cpu, 100)}%` }}
          />
        </div>
      </div>

      {/* Memory Card */}
      <div className="rounded-2xl border border-border bg-card p-4 space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-primary/15 flex items-center justify-center">
              <IconDatabase className="w-4 h-4 text-primary" />
            </div>
            <span className="text-sm font-medium text-foreground">{t("servers.memory")}</span>
          </div>
          <span className="text-sm font-mono font-bold text-foreground">{mem} MB / {xmx} MB</span>
        </div>
        <div className="h-2.5 rounded-full bg-muted overflow-hidden">
          <div
            className={cn(
              "h-full rounded-full transition-all duration-500",
              memPct > 90 ? "bg-red-500" : memPct > 70 ? "bg-yellow-500" : "bg-primary"
            )}
            style={{ width: `${memPct}%` }}
          />
        </div>
      </div>

      {/* Uptime Card */}
      <div className="rounded-2xl border border-border bg-card p-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-accent/15 flex items-center justify-center">
              <IconClock className="w-4 h-4 text-accent" />
            </div>
            <span className="text-sm font-medium text-foreground">{t("servers.uptime")}</span>
          </div>
          <span className="text-sm font-mono font-bold text-foreground">{formatUptime(metrics.uptimeSeconds)}</span>
        </div>
      </div>
    </div>
  )
}
