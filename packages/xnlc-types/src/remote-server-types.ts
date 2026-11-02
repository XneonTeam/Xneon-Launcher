import type { McServerInfo } from "./server-types.js"
import type { XnConnectState, XnConnectUsage } from "./server-types.js"
import type { JavaDetectResult } from "./domain-types.js"
export type ServerHostSettingsCommand = { action: "get" } | { action: "java"; path: string | null } | { action: "relay"; enabled: boolean }
export interface ServerHostSettings { javaPath: string | null; resolvedJavaPath: string | null; javaInstallations: JavaDetectResult[]; memoryTotalMb: number; relayEnabled: boolean; relayState: XnConnectState; usage: XnConnectUsage | null }
export type { ServerPermissions, ServerPermission } from "@xnlc/share"
import type { ServerPermissions } from "@xnlc/share"
export interface RemoteServerMember { id: string; name: string; owner: boolean; permissions: ServerPermissions }
export interface RemoteServerAccess {
  id: string
  owner: string
  ownerName: string
  isOwner: boolean
  permissions: ServerPermissions
  info: McServerInfo
  members?: RemoteServerMember[]
  invites?: { id: string; permissions: ServerPermissions; expiresAt: number; uses: number; maxUses: number }[]
}
export type RemoteServerRequest =
  | { action: "enable" | "disable" | "access"; serverId: string }
  | { action: "invite"; serverId: string; permissions: ServerPermissions }
  | { action: "member"; serverId: string; memberId: string; permissions: ServerPermissions }
  | { action: "removeMember"; serverId: string; memberId: string }
  | { action: "revokeInvite"; serverId: string; inviteId: string }
  | { action: "join"; code: string }
  | { action: "leave"; serverId: string }
export interface RemoteServerResponse { access?: RemoteServerAccess; code?: string; server?: McServerInfo; enabled?: boolean }
