export type AiProtocol = "openai" | "anthropic" | "gemini" | "ollama"
export interface AgentHardware {
  os: { platform: string; arch: string; release: string; version: string }
  cpu: { model: string; logicalCores: number; speedMHz: number }
  memory: { totalBytes: number; freeBytes: number }
  gpu: Array<{ name: string; vendorId?: number; deviceId?: number; active?: boolean }> | null
  displays: Array<{ width: number; height: number; scaleFactor: number; refreshRate: number; primary: boolean }>
  storage: { availableBytes: number; totalBytes: number } | null
  launcherVersion: string
}
export interface AiModelConfig { id: string; contextWindow: number; supportsImages: boolean }
export interface AiConfig { endpoint: string; model: string; protocol?: AiProtocol; models?: AiModelConfig[] }
export interface AiConfigStatus extends AiConfig { hasApiKey: boolean }
export interface AiConfigUpdate extends AiConfig { apiKey?: string }
export interface AiModelDiscovery { apiKey?: string; endpoint?: string; protocol?: AiProtocol }

/** User-configured Model Context Protocol connection. Exactly one of command/url is required. */
export interface AgentMcpServerConfig {
  name: string
  command?: string
  args?: string[]
  env?: Record<string, string>
  url?: string
  headers?: Record<string, string>
  enabled?: boolean
}
export interface AgentMcpToolInfo {
  server: string
  name: string
  description: string
  inputSchema: Record<string, unknown>
}
export interface AgentMcpServerState extends AgentMcpServerConfig {
  connected: boolean
  tools: string[]
  error?: string
}
export interface AgentMcpServerSummary {
  name: string
  transport: "stdio" | "http"
  connected: boolean
  tools: string[]
  error?: string
}

export interface AgentToolCall {
  id: string
  type: "function"
  function: { name: string; arguments: string }
}

export interface AgentWireMessage {
  role: "system" | "user" | "assistant" | "tool"
  content: string | null
  tool_calls?: AgentToolCall[]
  tool_call_id?: string
  images?: string[]
  providerParts?: unknown[]
}

export interface AgentToolSpec {
  type: "function"
  function: { name: string; description: string; parameters: Record<string, unknown> }
}

export interface AgentTurnRequest {
  purpose?: "compact"
  mode?: "questions"
  requestId: string
  messages: AgentWireMessage[]
  tools: AgentToolSpec[]
  language: string
}

export interface AgentTurnResult {
  text: string
  calls: AgentToolCall[]
  usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number }
  providerParts?: unknown[]
}

export interface AgentAttachment {
  id: string
  kind: "file" | "build" | "project" | "server"
  name: string
  content: string
  source?: "modrinth" | "curseforge" | "ftb"
  projectId?: string
  iconUrl?: string
  imageUrl?: string
}

export interface AgentTimelineItem {
  id: string
  kind: "user" | "assistant" | "tool" | "error" | "stopped"
  text: string
  attachments?: AgentAttachment[]
  toolName?: string
  input?: string
  output?: string
  status?: "running" | "approval" | "done" | "error" | "denied"
}

export interface AgentChatSummary { id: string; title: string; updatedAt: number; archived?: boolean }

export interface AgentChat extends AgentChatSummary {
  toolGroups?: string[]
  contextUsage?: { model: string; tokens: number; estimatedTokens?: number; scope?: string; messageCount?: number; prefixHash?: string; overheadTokens?: number }
  messages: AgentWireMessage[]
  timeline: AgentTimelineItem[]
  draft: string
  attachments: AgentAttachment[]
  mode: "questions" | "confirm" | "auto"
}

export interface AgentBuildFileRequest {
  buildId: string
  path: string
  operation: "list" | "read" | "write"
  content?: string
}
