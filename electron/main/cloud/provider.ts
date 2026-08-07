export type CloudProviderId = "google-drive" | "dropbox" | "yandex-disk" | "webdav" | "onedrive"

export type CloudFileInfo = {
  id: string
  name: string
  size: number
  mimeType?: string
  modifiedAt?: string
  path: string
  isDir: boolean
  category?: string
}

export type CloudStorageQuota = {
  used: number
  total: number
}

export type CloudAuthResult = {
  success: boolean
  error?: string
  provider?: CloudProviderId
}

export type CloudFileListResult = {
  success: boolean
  files?: CloudFileInfo[]
  error?: string
}

export type CloudUploadResult = {
  success: boolean
  id?: string
  name?: string
  error?: string
}

export type CloudDownloadResult = {
  success: boolean
  localPath?: string
  error?: string
}

export interface CloudProvider {
  readonly id: CloudProviderId
  readonly name: string

  authenticate(authData?: Record<string, string>): Promise<CloudAuthResult>
  isAuthenticated(): Promise<boolean>
  logout(): Promise<void>

  ensureBaseFolder(): Promise<void>

  listFiles(folderPath?: string): Promise<CloudFileListResult>
  uploadFile(localPath: string, remotePath: string): Promise<CloudUploadResult>
  downloadFile(remotePath: string, localPath: string): Promise<CloudDownloadResult>
  deleteFile(remotePath: string): Promise<{ success: boolean; error?: string }>

  getStorageQuota(): Promise<CloudStorageQuota | null>
}
