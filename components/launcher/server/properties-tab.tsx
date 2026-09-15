import { useState, useEffect, useCallback, useMemo, useRef } from "react"
import { useTranslation } from "react-i18next"
import { IconCheck, IconLoader2, IconSearch, IconChevronDown, IconChevronRight, IconRefresh, IconWorld, IconDeviceGamepad, IconBolt, IconPackage, IconRadio, IconTool, IconAdjustments } from "@tabler/icons-react"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import type { McServerInfo } from "@xnlc/types"
import { cn } from "@/lib/utils"

type PropType = "boolean" | "string" | "integer" | "enum"

interface PropDef {
  key: string
  type: PropType
  default: string
  description: string
  group: string
  options?: string[]
  min?: number
  max?: number
}

const PROP_DEFS: PropDef[] = [
  // Network
  { key: "server-ip", type: "string", default: "", description: "props.server-ip", group: "network" },
  { key: "server-port", type: "integer", default: "25565", description: "props.server-port", group: "network", min: 1, max: 65534 },
  { key: "enable-query", type: "boolean", default: "false", description: "props.enable-query", group: "network" },
  { key: "query.port", type: "integer", default: "25565", description: "props.query.port", group: "network", min: 1, max: 65534 },
  { key: "enable-rcon", type: "boolean", default: "false", description: "props.enable-rcon", group: "network" },
  { key: "rcon.port", type: "integer", default: "25575", description: "props.rcon.port", group: "network", min: 1, max: 65534 },
  { key: "rcon.password", type: "string", default: "", description: "props.rcon.password", group: "network" },
  { key: "network-compression-threshold", type: "integer", default: "256", description: "props.network-compression-threshold", group: "network", min: -1, max: 65535 },
  { key: "rate-limit", type: "integer", default: "0", description: "props.rate-limit", group: "network", min: 0 },
  { key: "prevent-proxy-connections", type: "boolean", default: "false", description: "props.prevent-proxy-connections", group: "network" },
  { key: "use-native-transport", type: "boolean", default: "true", description: "props.use-native-transport", group: "network" },
  { key: "enable-status", type: "boolean", default: "true", description: "props.enable-status", group: "network" },
  { key: "hide-online-players", type: "boolean", default: "false", description: "props.hide-online-players", group: "network" },
  { key: "log-ips", type: "boolean", default: "true", description: "props.log-ips", group: "network" },
  { key: "accepts-transfers", type: "boolean", default: "false", description: "props.accepts-transfers", group: "network" },

  // Game
  { key: "gamemode", type: "enum", default: "survival", description: "props.gamemode", group: "game", options: ["survival", "creative", "adventure", "spectator"] },
  { key: "difficulty", type: "enum", default: "easy", description: "props.difficulty", group: "game", options: ["peaceful", "easy", "normal", "hard"] },
  { key: "hardcore", type: "boolean", default: "false", description: "props.hardcore", group: "game" },
  { key: "force-gamemode", type: "boolean", default: "false", description: "props.force-gamemode", group: "game" },
  { key: "pvp", type: "boolean", default: "true", description: "props.pvp", group: "game" },
  { key: "max-players", type: "integer", default: "20", description: "props.max-players", group: "game", min: 0 },
  { key: "player-idle-timeout", type: "integer", default: "0", description: "props.player-idle-timeout", group: "game", min: 0 },
  { key: "spawn-protection", type: "integer", default: "16", description: "props.spawn-protection", group: "game", min: 0 },
  { key: "allow-flight", type: "boolean", default: "false", description: "props.allow-flight", group: "game" },
  { key: "enforce-whitelist", type: "boolean", default: "false", description: "props.enforce-whitelist", group: "game" },
  { key: "white-list", type: "boolean", default: "false", description: "props.white-list", group: "game" },
  { key: "enforce-secure-profile", type: "boolean", default: "true", description: "props.enforce-secure-profile", group: "game" },
  { key: "online-mode", type: "boolean", default: "true", description: "props.online-mode", group: "game" },
  { key: "max-tick-time", type: "integer", default: "60000", description: "props.max-tick-time", group: "game", min: -1 },
  { key: "pause-when-empty-seconds", type: "integer", default: "60", description: "props.pause-when-empty-seconds", group: "game", min: 0 },
  { key: "op-permission-level", type: "integer", default: "4", description: "props.op-permission-level", group: "game", min: 1, max: 4 },
  { key: "function-permission-level", type: "integer", default: "2", description: "props.function-permission-level", group: "game", min: 1, max: 4 },

  // World
  { key: "level-name", type: "string", default: "world", description: "props.level-name", group: "world" },
  { key: "level-seed", type: "string", default: "", description: "props.level-seed", group: "world" },
  { key: "level-type", type: "enum", default: "minecraft\\:normal", description: "props.level-type", group: "world", options: ["minecraft\\:normal", "minecraft\\:flat", "minecraft\\:large_biomes", "minecraft\\:amplified", "minecraft\\:single_biome_surface"] },
  { key: "generator-settings", type: "string", default: "{}", description: "props.generator-settings", group: "world" },
  { key: "max-world-size", type: "integer", default: "29999984", description: "props.max-world-size", group: "world", min: 1, max: 29999984 },
  { key: "generate-structures", type: "boolean", default: "true", description: "props.generate-structures", group: "world" },
  { key: "allow-nether", type: "boolean", default: "true", description: "props.allow-nether", group: "world" },
  { key: "spawn-monsters", type: "boolean", default: "true", description: "props.spawn-monsters", group: "world" },
  { key: "spawn-animals", type: "boolean", default: "true", description: "props.spawn-animals", group: "world" },
  { key: "spawn-npcs", type: "boolean", default: "true", description: "props.spawn-npcs", group: "world" },

  // Performance
  { key: "view-distance", type: "integer", default: "10", description: "props.view-distance", group: "performance", min: 3, max: 32 },
  { key: "simulation-distance", type: "integer", default: "10", description: "props.simulation-distance", group: "performance", min: 3, max: 32 },
  { key: "sync-chunk-writes", type: "boolean", default: "true", description: "props.sync-chunk-writes", group: "performance" },
  { key: "max-chained-neighbor-updates", type: "integer", default: "1000000", description: "props.max-chained-neighbor-updates", group: "performance", min: -1 },
  { key: "region-file-compression", type: "enum", default: "deflate", description: "props.region-file-compression", group: "performance", options: ["deflate", "lz4", "none"] },
  { key: "entity-broadcast-range-percentage", type: "integer", default: "100", description: "props.entity-broadcast-range-percentage", group: "performance", min: 10, max: 1000 },

  // Resource Pack
  { key: "resource-pack", type: "string", default: "", description: "props.resource-pack", group: "resourcepack" },
  { key: "resource-pack-id", type: "string", default: "", description: "props.resource-pack-id", group: "resourcepack" },
  { key: "resource-pack-sha1", type: "string", default: "", description: "props.resource-pack-sha1", group: "resourcepack" },
  { key: "resource-pack-prompt", type: "string", default: "", description: "props.resource-pack-prompt", group: "resourcepack" },
  { key: "require-resource-pack", type: "boolean", default: "false", description: "props.require-resource-pack", group: "resourcepack" },

  // Misc
  { key: "motd", type: "string", default: "A Minecraft Server", description: "props.motd", group: "misc" },
  { key: "enable-command-block", type: "boolean", default: "false", description: "props.enable-command-block", group: "misc" },
  { key: "enable-code-of-conduct", type: "boolean", default: "false", description: "props.enable-code-of-conduct", group: "misc" },
  { key: "debug", type: "boolean", default: "false", description: "props.debug", group: "misc" },
  { key: "enable-jmx-monitoring", type: "boolean", default: "false", description: "props.enable-jmx-monitoring", group: "misc" },
  { key: "bug-report-link", type: "string", default: "", description: "props.bug-report-link", group: "misc" },
  { key: "text-filtering-config", type: "string", default: "", description: "props.text-filtering-config", group: "misc" },
  { key: "text-filtering-version", type: "integer", default: "0", description: "props.text-filtering-version", group: "misc", min: 0 },
  { key: "status-heartbeat-interval", type: "integer", default: "0", description: "props.status-heartbeat-interval", group: "misc", min: 0 },
  { key: "initial-enabled-packs", type: "string", default: "vanilla", description: "props.initial-enabled-packs", group: "misc" },
  { key: "initial-disabled-packs", type: "string", default: "", description: "props.initial-disabled-packs", group: "misc" },

  // Broadcast
  { key: "broadcast-console-to-ops", type: "boolean", default: "true", description: "props.broadcast-console-to-ops", group: "broadcast" },
  { key: "broadcast-rcon-to-ops", type: "boolean", default: "true", description: "props.broadcast-rcon-to-ops", group: "broadcast" },

  // Management Server (newer versions)
  { key: "management-server-enabled", type: "boolean", default: "false", description: "props.management-server-enabled", group: "management" },
  { key: "management-server-host", type: "string", default: "localhost", description: "props.management-server-host", group: "management" },
  { key: "management-server-port", type: "integer", default: "0", description: "props.management-server-port", group: "management", min: 0, max: 65535 },
  { key: "management-server-secret", type: "string", default: "", description: "props.management-server-secret", group: "management" },
  { key: "management-server-allowed-origins", type: "string", default: "", description: "props.management-server-allowed-origins", group: "management" },
  { key: "management-server-tls-enabled", type: "boolean", default: "true", description: "props.management-server-tls-enabled", group: "management" },
  { key: "management-server-tls-keystore", type: "string", default: "", description: "props.management-server-tls-keystore", group: "management" },
  { key: "management-server-tls-keystore-password", type: "string", default: "", description: "props.management-server-tls-keystore-password", group: "management" },

  // Chat Spam
  { key: "chat-spam-threshold-seconds", type: "integer", default: "10", description: "props.chat-spam-threshold-seconds", group: "misc", min: 0 },
  { key: "command-spam-threshold-seconds", type: "integer", default: "10", description: "props.command-spam-threshold-seconds", group: "misc", min: 0 },
]

const GROUPS: Record<string, { labelKey: string; icon: React.ElementType }> = {
  network: { labelKey: "properties.group.network", icon: IconWorld },
  game: { labelKey: "properties.group.game", icon: IconDeviceGamepad },
  world: { labelKey: "properties.group.world", icon: IconAdjustments },
  performance: { labelKey: "properties.group.performance", icon: IconBolt },
  resourcepack: { labelKey: "properties.group.resourcepack", icon: IconPackage },
  broadcast: { labelKey: "properties.group.broadcast", icon: IconRadio },
  management: { labelKey: "properties.group.management", icon: IconTool },
  misc: { labelKey: "properties.group.misc", icon: IconAdjustments },
}

interface PropertiesTabProps {
  server: McServerInfo
  /** Даёт родителю возможность дописать несохранённые правки перед стартом сервера. */
  flushRef?: React.MutableRefObject<(() => Promise<void>) | null>
  /** Свежие данные сервера после записи server.properties (порт/online-mode/слоты). */
  onServerUpdated?: (server: McServerInfo) => void
}

export function PropertiesTab({ server, flushRef, onServerUpdated }: PropertiesTabProps) {
  const { t } = useTranslation()
  const [properties, setProperties] = useState<Record<string, string> | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [search, setSearch] = useState("")
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(() => new Set(Object.keys(GROUPS)))
  const [hasChanges, setHasChanges] = useState(false)
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  // Снимок ещё не записанных значений: без него закрытие вкладки теряло правки,
  // а запуск сервера успевал прочитать старый файл.
  const pendingRef = useRef<Record<string, string> | null>(null)
  const flushImplRef = useRef<() => Promise<void>>(async () => {})

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    window.electronAPI?.mcServerReadProperties(server.id).then(props => {
      if (cancelled) return
      if (props) {
        setProperties(props)
      } else {
        const defaults: Record<string, string> = {}
        for (const def of PROP_DEFS) defaults[def.key] = def.default
        setProperties(defaults)
      }
      setLoading(false)
    })
    return () => { cancelled = true }
  }, [server.id])

  const save = useCallback(async (props: Record<string, string>) => {
    setSaving(true)
    try {
      await window.electronAPI?.mcServerWriteProperties(server.id, props)
      // Запись возвращает актуальные данные сервера: порт/online-mode/слоты
      // синхронизируются с файлом, поэтому список в лаунчере тоже обновляем.
      const fresh = await window.electronAPI?.mcServerGet(server.id)
      if (fresh) onServerUpdated?.(fresh)
      setSaved(true)
      setHasChanges(false)
      setTimeout(() => setSaved(false), 2000)
    } finally {
      setSaving(false)
    }
  }, [server.id, onServerUpdated])

  /** Немедленно записывает отложенные правки (если есть). */
  const flushPending = useCallback(async () => {
    if (saveTimerRef.current) {
      clearTimeout(saveTimerRef.current)
      saveTimerRef.current = null
    }
    const pending = pendingRef.current
    pendingRef.current = null
    if (!pending) return
    await save(pending)
  }, [save])

  useEffect(() => {
    flushImplRef.current = flushPending
  }, [flushPending])

  useEffect(() => {
    if (!flushRef) return
    flushRef.current = () => flushImplRef.current()
    return () => { flushRef.current = null }
  }, [flushRef])

  // Уход с вкладки не должен терять правки.
  useEffect(() => () => { void flushImplRef.current() }, [])

  const scheduleSave = useCallback((next: Record<string, string>) => {
    pendingRef.current = next
    setHasChanges(true)
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current)
    saveTimerRef.current = setTimeout(() => { void flushPending() }, 500)
  }, [flushPending])

  const handleChange = useCallback((key: string, value: string) => {
    setProperties(prev => {
      if (!prev) return prev
      const next = { ...prev, [key]: value }
      scheduleSave(next)
      return next
    })
  }, [scheduleSave])

  const handleReset = useCallback(() => {
    if (!properties) return
    const defaults: Record<string, string> = {}
    for (const def of PROP_DEFS) defaults[def.key] = def.default
    setProperties(defaults)
    scheduleSave(defaults)
  }, [properties, scheduleSave])

  const toggleGroup = useCallback((group: string) => {
    setExpandedGroups(prev => {
      const next = new Set(prev)
      if (next.has(group)) next.delete(group)
      else next.add(group)
      return next
    })
  }, [])

  const filteredDefs = useMemo(() => {
    if (!search.trim()) return PROP_DEFS
    const q = search.toLowerCase()
    return PROP_DEFS.filter(def =>
      def.key.toLowerCase().includes(q) ||
      def.description.toLowerCase().includes(q)
    )
  }, [search])

  const groupedDefs = useMemo(() => {
    const groups: Record<string, PropDef[]> = {}
    for (const def of filteredDefs) {
      if (!groups[def.group]) groups[def.group] = []
      groups[def.group].push(def)
    }
    return groups
  }, [filteredDefs])

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <IconLoader2 className="w-6 h-6 text-primary animate-spin" />
      </div>
    )
  }

  return (
    <div className="flex flex-col h-full">
      {/* Toolbar */}
      <div className="flex items-center gap-2 px-4 py-2 border-b border-border">
        <div className="relative flex-1">
          <IconSearch className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder={t("properties.search")}
            className="w-full pl-9 pr-3 py-2 rounded-lg bg-muted/50 border border-border text-foreground text-sm placeholder:text-muted-foreground focus:outline-none focus:border-primary transition-colors"
          />
        </div>

        {/* Status */}
        <div className="flex items-center gap-2 text-xs text-muted-foreground h-6 min-w-[80px]">
          {saving ? (
            <span className="flex items-center gap-1.5">
              <IconLoader2 className="w-3 h-3 animate-spin text-primary" />
            </span>
          ) : saved ? (
            <span className="flex items-center gap-1.5">
              <IconCheck className="w-3 h-3 text-green-400" />
            </span>
          ) : null}
        </div>

        <button
          onClick={handleReset}
          className="p-2 rounded-lg bg-muted/50 hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
          title={t("properties.resetDefaults")}
        >
          <IconRefresh className="w-4 h-4" />
        </button>
      </div>

      {/* Properties list */}
      <div className="flex-1 overflow-y-auto p-4 space-y-1">
        {Object.entries(GROUPS).map(([groupKey, groupInfo]) => {
          const defs = groupedDefs[groupKey]
          if (!defs || defs.length === 0) return null
          const isExpanded = expandedGroups.has(groupKey)

          return (
            <div key={groupKey} className="rounded-xl border border-border bg-card overflow-hidden">
              <button
                onClick={() => toggleGroup(groupKey)}
                className="w-full flex items-center gap-2.5 px-4 py-2.5 bg-muted/20 hover:bg-muted/40 transition-colors text-left"
              >
                {isExpanded ? (
                  <IconChevronDown className="w-4 h-4 text-muted-foreground flex-shrink-0" />
                ) : (
                  <IconChevronRight className="w-4 h-4 text-muted-foreground flex-shrink-0" />
                )}
                <span className="flex-shrink-0 text-primary"><groupInfo.icon className="w-4 h-4" strokeWidth={1.75} /></span>
                <span className="text-sm font-medium text-foreground">{t(groupInfo.labelKey)}</span>
                <span className="text-xs text-muted-foreground ml-auto">{defs.length}</span>
              </button>

              {isExpanded && (
                <div className="divide-y divide-border">
                  {defs.map(def => (
                    <PropertyRow
                      key={def.key}
                      def={def}
                      value={properties?.[def.key] ?? def.default}
                      onChange={handleChange}
                    />
                  ))}
                </div>
              )}
            </div>
          )
        })}

        {filteredDefs.length === 0 && (
          <div className="flex flex-col items-center justify-center py-12 text-center">
            <IconSearch className="w-8 h-8 text-muted-foreground/40 mb-2" />
            <p className="text-sm text-muted-foreground">{t("properties.noResults")}</p>
          </div>
        )}
      </div>
    </div>
  )
}

function PropertyRow({ def, value, onChange }: { def: PropDef; value: string; onChange: (key: string, value: string) => void }) {
  const { t } = useTranslation()
  const isDefault = value === def.default

  return (
    <div className="flex items-center gap-4 px-4 py-3 hover:bg-muted/20 transition-colors">
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-sm font-mono font-medium text-foreground truncate">{def.key}</span>
          {isDefault && (
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-muted/60 text-muted-foreground flex-shrink-0">
              default
            </span>
          )}
        </div>
        <p className="text-xs text-muted-foreground mt-0.5 line-clamp-1">{t(def.description)}</p>
      </div>

      <div className="flex-shrink-0">
        {def.type === "boolean" && (
          <PropToggle value={value === "true"} onChange={v => onChange(def.key, v ? "true" : "false")} />
        )}
        {def.type === "string" && (
          <input
            value={value}
            onChange={e => onChange(def.key, e.target.value)}
            className="w-48 px-3 py-1.5 rounded-lg bg-muted/50 border border-border text-foreground text-sm font-mono focus:outline-none focus:border-primary transition-colors"
          />
        )}
        {def.type === "integer" && (
          <input
            type="number"
            value={value}
            onChange={e => onChange(def.key, e.target.value)}
            min={def.min}
            max={def.max}
            className="w-32 px-3 py-1.5 rounded-lg bg-muted/50 border border-border text-foreground text-sm font-mono focus:outline-none focus:border-primary transition-colors"
          />
        )}
        {def.type === "enum" && def.options && (
          <Select value={value} onValueChange={v => onChange(def.key, v)}>
            <SelectTrigger size="sm" className="min-w-[160px] font-mono">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {def.options.map(opt => (
                <SelectItem key={opt} value={opt}>{opt.replace(/\\:/g, ":")}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
      </div>
    </div>
  )
}

function PropToggle({ value, onChange }: { value: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      onClick={() => onChange(!value)}
      className={cn(
        "relative w-11 h-6 rounded-full transition-colors flex-shrink-0",
        value ? "bg-primary" : "bg-muted"
      )}
    >
      <div className={cn(
        "absolute top-0.5 w-5 h-5 rounded-full bg-white transition-transform shadow-sm",
        value ? "translate-x-5.5" : "translate-x-0.5"
      )} />
    </button>
  )
}
