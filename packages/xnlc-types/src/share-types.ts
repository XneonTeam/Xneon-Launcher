import type { Manifest, Repository, RepositoryCommand } from "@xnlc/share"
import type { ScanResult, UpdatePreview } from "@xnlc/share"
export type { Manifest, Repository, RepositoryCommand, ScanResult, UpdatePreview }
export interface ShareContentPresentation {
  name: string
  version?: string
  author?: string
  iconUrl?: string
  source?: "local" | "modrinth" | "curseforge"
}
export interface ShareLink { repositoryId: string; branch: string; applied: string; latest: string; userId: string; role: "owner" | "editor" | "viewer"; status: "not_ready" | "up_to_date" | "update_available" | "applying" | "error" }
export type ShareRequest = (
  | { action: "session" }
  | { action: "pendingInvitation" }
  | { action: "checkLaunch"; buildId: string }
  | { action: "invitationPreview"; invitation: string }
  | { action: "installInvite"; previewId: string; name: string }
  | { action: "status"; buildId: string }
  | { action: "deletePublication"; buildId: string; repositoryId: string }
  | { action: "scan"; buildId: string; selected?: string[]; exclusions?: string[] }
  | { action: "history"; buildId: string; commit: string }
  | { action: "publish"; buildId: string; previewId: string; message: string; selected?: string[] }
  | { action: "push"; buildId: string; previewId: string; message: string; selected?: string[] }
  | { action: "preview"; buildId: string; resolutions?: Record<string, "current" | "incoming">; branch?: string; stash?: string; commit?: string }
  | { action: "apply"; buildId: string; previewId: string }
  | { action: "restoreApply"; buildId: string; previewId: string; message: string }
  | { action: "connect"; buildId: string; repositoryId: string; branch: string }
  | { action: "command"; buildId: string; command: RepositoryCommand }
  | { action: "createBranch"; buildId: string; name: string; source: string; independent: boolean }
  | { action: "invite"; buildId: string; role: "viewer" | "editor"; maxUses: number }
  | { action: "acceptInvite"; token: string }
  | { action: "stash"; buildId: string; previewId: string; name: string }
  | { action: "restore"; buildId: string; commit: string; message: string }
  | { action: "mergePreview"; buildId: string; source: string; target?: string; resolutions?: Record<string, "current" | "incoming">; pullRequest?: string }
  | { action: "merge"; buildId: string; source: string; target?: string; sourceHead?: string; expected: string; message: string; resolutions?: Record<string, "current" | "incoming">; pullRequest?: string }
) & { requestId?: string }
export interface ShareResponse {
  detached?: boolean
  history?: { commitId: string; changes: import("@xnlc/share").DiffEntry[]; presentation: Record<string, ShareContentPresentation> }
  contentPresentation?: Record<string, ShareContentPresentation>
  eligible?: boolean; username?: string; memberNames?: Record<string, string>
  serviceAvailable?: boolean; signedIn?: boolean; wrongAccount?: boolean; buildId?: string
  pendingInvitation?: string
  invitationPreview?: { owner: string; manifest: Manifest; repositoryId: string; branch: string; head: string }
  configured?: boolean; user?: string; link?: ShareLink; repository?: Repository
  scan?: ScanResult; preview?: UpdatePreview; previewId?: string
  uploadedBytes?: number; reusedBytes?: number; metadataBytes?: number
  invitation?: { token: string; expiresAt: number }; repositoryId?: string
  merge?: { current: string; incoming: string; base: string; manifest: Manifest; conflicts: import("@xnlc/share").MergeConflict[]; diff: import("@xnlc/share").DiffEntry[] }
}
export type ShareResult = { success: true; data: ShareResponse } | { success: false; error: { code: string; message: string; filePath?: string } }
