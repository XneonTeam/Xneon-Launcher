export interface ServerStatus {
  online: boolean
  ip: string
  port: number
  players_online: number
  players_max: number
  motd_raw?: string
  motd_clean?: string
  version: string
  latency_ms: number
  icon?: string
}

export interface ServerEntry {
  name: string
  ip: string
  status: ServerStatus | null
  loading: boolean
  error: string | null
  isFavorite: boolean
}

export interface MotdExtraEntry {
  text?: string
  extra?: Array<MotdExtraEntry | string>
  color?: string
  bold?: boolean
  italic?: boolean
  underlined?: boolean
  strikethrough?: boolean
}
