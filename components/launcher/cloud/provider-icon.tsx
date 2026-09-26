// ============================================================
// Иконки облачных провайдеров — одна точка правды.
// Раньше карта иконок жила внутри `cloud-provider-card.tsx`, поэтому шапка
// подключённого провайдера (`cloud/index.tsx`) рисовала общий Tabler `IconCloud`
// вместо логотипа провайдера.
// ============================================================

import { IconBrandGoogleDrive, IconBrandDropbox, IconServer, IconCloud, IconDatabase } from "@tabler/icons-react"

function YandexDiskIcon({ className, style }: { className?: string; style?: React.CSSProperties }) {
  return (
    <svg viewBox="0 0 192 192" fill="none" xmlns="http://www.w3.org/2000/svg" className={className} style={style}>
      <path d="M46.362 16.429c-1.872-2.065-6.739-3.241-10.036-3.448a20.128 20.128 0 0 1-4.333-.762 20.562 20.562 0 0 1-1.902-.645c-2.772-1.1-7.345-2.158-12.28-.138-.157.069-.31.123-.453.198-.152.055-.306.133-.463.202-4.826 2.246-7.164 6.323-8.24 9.106a20.385 20.385 0 0 1-.819 1.834 19.96 19.96 0 0 1-2.373 3.693c-2.092 2.55-4.514 6.977-4.284 9.749" stroke="currentColor" strokeWidth="3.7174" strokeLinecap="round" strokeLinejoin="round" transform="translate(18.297 14.818) scale(3.22807)"/>
      <path d="M46.681 16.918c2.105 4.713-6.419 13.004-18.953 18.482-12.534 5.478-24.744 6.23-26.439 1.355C.085 33.293 8.103 24.05 20.637 18.573c12.534-5.477 24.621-4.841 26.044-1.655Z" stroke="currentColor" strokeWidth="3.7174" strokeLinecap="round" strokeLinejoin="round" transform="translate(18.297 14.818) scale(3.22807)"/>
      <path d="M13.285 32.228c-.881-2.016 3.511-5.881 9.811-8.635 6.3-2.754 12.12-3.35 13.001-1.334.881 2.016-3.511 5.88-9.811 8.635-6.3 2.754-12.12 3.35-13.001 1.334z" stroke="currentColor" strokeWidth="3.7174" strokeLinecap="round" strokeLinejoin="round" transform="translate(18.297 14.818) scale(3.22807)"/>
    </svg>
  )
}

function OneDriveIcon({ className, style }: { className?: string; style?: React.CSSProperties }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className} style={style} xmlns="http://www.w3.org/2000/svg">
      <path stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" d="M18.391 17.993c2.199 0 4.109 -1.79 4.109 -4.016S20.59 9.96 18.391 9.96h-0.264c-0.702 -2.308 -2.742 -4.017 -5.114 -4.39 -2.383 -0.373 -4.861 0.633 -6.263 2.605h-0.228c-2.687 0 -5.022 2.188 -5.022 4.909 0 2.72 2.335 4.908 5.022 4.908h11.87Z" strokeWidth="1" />
      <path stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" d="M6.75 8.176a6.924 6.924 0 0 1 3.424 0.893l11.87 6.675" strokeWidth="1" />
      <path stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" d="M18.127 9.96a7.953 7.953 0 0 0 -3.114 0.634L2.468 15.95" strokeWidth="1" />
    </svg>
  )
}

type ProviderIconEntry = {
  icon?: React.FC<{ className?: string; strokeWidth?: number; style?: React.CSSProperties }>
  svg?: React.FC<{ className?: string; style?: React.CSSProperties }>
  color: string
}

export const PROVIDER_ICONS: Record<string, ProviderIconEntry> = {
  "google-drive": { icon: IconBrandGoogleDrive, color: "#4285F4" },
  "dropbox": { icon: IconBrandDropbox, color: "#0061FF" },
  "yandex-disk": { svg: YandexDiskIcon, color: "#FC3F1D" },
  "webdav": { icon: IconServer, color: "#8b5cf6" },
  "onedrive": { svg: OneDriveIcon, color: "#0078D4" },
  "s3": { icon: IconDatabase, color: "#FF9900" },
}

const FALLBACK: ProviderIconEntry = { icon: IconCloud, color: "#8b5cf6" }

export function providerColor(id: string): string {
  return (PROVIDER_ICONS[id] ?? FALLBACK).color
}

/** Иконка провайдера по его id; для неизвестного — общее облако. */
export function ProviderIcon({ id, className, style, strokeWidth = 1.5 }: {
  id: string
  className?: string
  style?: React.CSSProperties
  strokeWidth?: number
}) {
  const info = PROVIDER_ICONS[id] ?? FALLBACK
  const TablerIcon = info.icon
  const SvgIcon = info.svg
  if (TablerIcon) return <TablerIcon className={className} style={{ color: info.color, ...style }} strokeWidth={strokeWidth} />
  if (SvgIcon) return <SvgIcon className={className} style={{ color: info.color, ...style }} />
  return null
}