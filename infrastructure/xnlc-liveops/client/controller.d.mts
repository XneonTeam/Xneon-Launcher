import type { LiveopsThemeRef, Theme } from "@xnlc/types"

/** Типизированная граница существующего JS-клиента; сервер этот модуль не импортирует. */
export interface EventThemeStorage {
  loadState(): Promise<unknown>
  saveState(state: unknown): Promise<void>
  readPackage(digest: string): Promise<Uint8Array | null | undefined>
  writePackage(digest: string, bytes: Uint8Array): Promise<void>
  prunePackages(keep: string | null): Promise<void>
}

export interface EventThemeControllerOptions {
  baseURL: string
  storage: EventThemeStorage
  selected: LiveopsThemeRef
  apply(ref: LiveopsThemeRef, theme: Theme | null): Promise<void>
  exists?(ref: LiveopsThemeRef): boolean
  fetcher?(input: string | URL | Request, init?: RequestInit): Promise<Response>
  now?(): number
  onError?(error: unknown): void
  defaultTheme?: LiveopsThemeRef
  /** Настройка читается перед оценкой автоматики; ручной выбор не ограничивается. */
  autoApply?(): boolean | Promise<boolean>
}

export function createEventThemeController(options: EventThemeControllerOptions): Promise<{
  tick(): Promise<void>
  select(ref: LiveopsThemeRef): Promise<void>
  stop(): void
  themes(presets: Theme[], custom: Theme[]): { standard: Theme[]; custom: Theme[] }
}>

export function limitedResponse(response: Response, limit: number): Promise<Buffer>
