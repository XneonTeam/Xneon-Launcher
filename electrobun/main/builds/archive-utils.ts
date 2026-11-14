export type AdmZipToBuffer = {
  (): Buffer
  (
    onSuccess: (data: Buffer) => void,
    onFail: (error: Error) => void,
    onItemStart?: (name: string) => void,
    onItemEnd?: (name: string) => void,
  ): void
}

export type AdmZipType = {
  getEntries(): { entryName: string; isDirectory: boolean; getData(): Buffer }[]
  getEntry(name: string): { getData(): Buffer } | null
  addLocalFolder(localPath: string, readstream?: unknown, filter?: (entryPath: string) => boolean): void
  addLocalFolderAsync(
    localPath: string,
    callback: (result?: boolean, errorMessage?: string) => void,
    zipPath?: string,
    filter?: (entryPath: string) => boolean,
  ): void
  addFile(entryName: string, content: Buffer): void
  writeZip(outputPath: string, keepOrder?: boolean): void
  toBuffer: AdmZipToBuffer
}

export type AdmZipConstructor = new (data?: Buffer) => AdmZipType

let admZipPromise: Promise<AdmZipConstructor> | null = null
export function loadAdmZip(): Promise<AdmZipConstructor> {
  if (!admZipPromise) {
    admZipPromise = import("adm-zip").then(m => m.default as unknown as AdmZipConstructor)
  }
  return admZipPromise
}
