export interface SharedLaunchSettings {
  javaOverride: boolean
  memoryMin: string
  memoryMax: string
  javaArgs: string
  java: { path?: string; major?: number; vendor?: string } | null
  windowOverride: boolean
  windowWidth: number | null
  windowHeight: number | null
  account: { type: string; username: string; uuid?: string; serverUrl?: string } | null
  serverOverride?: boolean
  server?: string
  serverPort?: string
  group?: string
  preLaunchCommand?: string
  postLaunchCommand?: string
  wrapperCommand?: string
  customEnv?: string
}
export interface InstanceMetadata {
  name: string
  description: string
  gameVersion: string
  loader: string
  loaderVersion: string
  icon?: string
  coverImage?: string
  launchSettings?: SharedLaunchSettings
}
export interface SourceReference { provider: string; projectId: string; versionId: string; fileId: string }
export interface ContentEntry {
  path: string
  kind: "mod" | "resourcepack" | "shader" | "config" | "external"
  sha256: string
  size: number
  enabled: boolean
  source?: SourceReference
  object?: string
}
export interface Manifest { schemaVersion: 1; instance: InstanceMetadata; entries: ContentEntry[]; exclusions: string[] }
export interface Snapshot { id: string; rootHash: string; manifest: Manifest; parent: string | null; createdAt: string; statistics: { managed: number; external: number; bytes: number } }
export interface Commit {
  id: string; repositoryId: string; parents: string[]; author: string; message: string; description: string
  createdAt: string; manifestHash: string; snapshot: Snapshot; type: "INITIAL" | "COMMIT" | "MERGE" | "REVERT"
}
export type Role = "owner" | "editor" | "viewer"
export interface Branch { head: string; owner: string; protected: boolean; base?: string }
export interface PullRequestMerge { targetHead: string; sourceHead: string; commit: string; at: string }
export interface PullRequest { id: string; title: string; description: string; source: string; target: string; author: string; state: "open" | "closed" | "merged"; comments: { author: string; text: string; at: string }[]; merge?: PullRequestMerge }
export interface Repository {
  id: string; owner: string; members: Record<string, Role>; branches: Record<string, Branch>
  commits: Record<string, Commit>; defaultBranch: string
  stashes: Record<string, { author: string; base: string; manifest: Manifest }>
  pullRequests: Record<string, PullRequest>
  releases: Record<string, { commit: string; description: string; author: string }>
}
export interface FileInfo { path: string; size: number; fingerprint: string }
export interface Hashes { sha256: string; sha512: string; sha1?: string }
export interface Worktree {
  list(): Promise<FileInfo[]>
  read(path: string): Promise<Uint8Array>
  hash(path: string): Promise<Hashes>
  apply(changes: { path: string; bytes: Uint8Array | null; expected: string | null }[]): Promise<void>
}
export interface HashPort { digest(bytes: Uint8Array, algorithm?: "SHA-256" | "SHA-512"): Promise<string> }
export interface ResolvedFile { source: SourceReference; size: number; sha512?: string; sha256?: string; url: string; dependencies: string[] }
export interface ContentSourceAdapter {
  readonly id: string
  identify(hashes: Hashes, hint?: SourceReference): Promise<ResolvedFile | null>
  identifyMany?(hashes: Hashes[], force?: boolean): Promise<(ResolvedFile | null)[]>
  resolve(source: SourceReference): Promise<ResolvedFile>
  download(file: ResolvedFile): Promise<Uint8Array>
}
export interface SharePorts {
  files: Worktree; hash: HashPort; sources: ContentSourceAdapter[]
  remote: ShareTransport; now(): string
  localSource?(file: FileInfo, hashes: Hashes): Promise<SourceReference | undefined>
  inspectExternal?(bytes: Uint8Array): void
  progress?(event: { stage: string; done: number; total: number; bytes: number }): void
}
export interface ShareTransport {
  create(): Promise<string>
  get(id: string): Promise<Repository>
  mutate(id: string, command: RepositoryCommand): Promise<Repository>
  hasObject(id: string, hash: string): Promise<boolean>
  upload(id: string, hash: string, bytes: Uint8Array, onProgress?: (transferred: number) => void): Promise<void>
  download(id: string, hash: string): Promise<Uint8Array>
}
export type RepositoryCommand =
  | { action: "push"; branch: string; expected: string | null; commit: Commit; pullRequest?: string }
  | { action: "fastForward"; branch: string; expected: string; head: string; pullRequest?: string }
  | { action: "branch"; name: string; from: string; initial?: Commit }
  | { action: "deleteBranch"; name: string }
  | { action: "renameBranch"; name: string; to: string }
  | { action: "protect"; name: string; protected: boolean }
  | { action: "defaultBranch"; name: string }
  | { action: "member"; user: string; role: Role | null }
  | { action: "stash"; id: string; base: string; manifest: Manifest }
  | { action: "dropStash"; id: string }
  | { action: "pr"; id: string; title: string; description: string; source: string; target: string }
  | { action: "comment"; id: string; text: string }
  | { action: "prState"; id: string; state: "open" | "closed" }
export interface DiffEntry { path: string; type: "added" | "removed" | "modified" | "renamed"; before?: ContentEntry; after?: ContentEntry; changes: string[] }
export interface MergeConflict { path: string; base: unknown; current: unknown; incoming: unknown }
export interface MergeResult { manifest: Manifest; conflicts: MergeConflict[] }
export class ShareError extends Error {
  constructor(public code: string, message: string, public filePath?: string) { super(message); this.name = "ShareError" }
}
