// ============================================================
// Minecraft MOTD renderer
// Shared between the "Servers" tab and the home Quick Play section.
// Handles the modern JSON chat format (text/extra/color/bold/…)
// as well as legacy §-codes.
// ============================================================

import type { CSSProperties, ReactNode } from "react"

const COLOR_MAP: Record<string, string> = {
  "0": "#000000",
  "1": "#0000AA",
  "2": "#00AA00",
  "3": "#00AAAA",
  "4": "#AA0000",
  "5": "#AA00AA",
  "6": "#FFAA00",
  "7": "#AAAAAA",
  "8": "#555555",
  "9": "#5555FF",
  a: "#55FF55",
  b: "#55FFFF",
  c: "#FF5555",
  d: "#FF55FF",
  e: "#FFFF55",
  f: "#FFFFFF",
  black: "#000000",
  dark_blue: "#0000AA",
  dark_green: "#00AA00",
  dark_aqua: "#00AAAA",
  dark_red: "#AA0000",
  dark_purple: "#AA00AA",
  gold: "#FFAA00",
  gray: "#AAAAAA",
  dark_gray: "#555555",
  blue: "#5555FF",
  green: "#55FF55",
  aqua: "#55FFFF",
  red: "#FF5555",
  light_purple: "#FF55FF",
  yellow: "#FFFF55",
  white: "#FFFFFF",
}

const FORMATTING_MAP: Record<string, string> = {
  l: "font-weight:bold",
  m: "text-decoration:line-through",
  n: "text-decoration:underline",
  o: "font-style:italic",
}

const DEFAULT_COLOR = "#AAAAAA"

export interface MotdExtraEntry {
  text?: string
  extra?: Array<MotdExtraEntry | string>
  color?: string
  bold?: boolean
  italic?: boolean
  underlined?: boolean
  strikethrough?: boolean
}

function resolveMinecraftColor(color: string | undefined, fallback: string) {
  if (!color) return fallback
  if (color.startsWith("#")) return color
  return COLOR_MAP[color.toLowerCase()] || fallback
}

function renderExtraEntry(
  entry: MotdExtraEntry | string,
  inheritedColor: string,
  inheritedBold: boolean,
  inheritedItalic: boolean,
  inheritedUnderline: boolean,
  inheritedStrikethrough: boolean,
  keyPrefix: string,
  keyIdx: number
): ReactNode {
  if (typeof entry === "string") {
    if (entry === "\n") return <br key={`${keyPrefix}-br-${keyIdx}`} />
    return (
      <span
        key={`${keyPrefix}-${keyIdx}`}
        style={{
          color: inheritedColor,
          fontWeight: inheritedBold ? "bold" : "normal",
          fontStyle: inheritedItalic ? "italic" : "normal",
          textDecoration: [
            inheritedUnderline ? "underline" : "",
            inheritedStrikethrough ? "line-through" : "",
          ]
            .filter(Boolean)
            .join(" ") || "none",
          textShadow: inheritedBold ? `0 0 2px ${inheritedColor}40, 0 0 6px ${inheritedColor}20` : "none",
        }}
      >
        {entry}
      </span>
    )
  }

  if (entry.text === "\n") {
    return <br key={`${keyPrefix}-br-${keyIdx}`} />
  }

  const color = resolveMinecraftColor(entry.color, inheritedColor)
  const bold = entry.bold !== undefined ? entry.bold : inheritedBold
  const italic = entry.italic !== undefined ? entry.italic : inheritedItalic
  const underline = entry.underlined !== undefined ? entry.underlined : inheritedUnderline
  const strikethrough = entry.strikethrough !== undefined ? entry.strikethrough : inheritedStrikethrough

  const children: ReactNode[] = []

  if (entry.text && entry.text !== "\n") {
    children.push(
      <span
        key={`${keyPrefix}-${keyIdx}`}
        style={{
          color,
          fontWeight: bold ? "bold" : "normal",
          fontStyle: italic ? "italic" : "normal",
          textDecoration: [underline ? "underline" : "", strikethrough ? "line-through" : ""]
            .filter(Boolean)
            .join(" ") || "none",
          textShadow: bold ? `0 0 2px ${color}40, 0 0 6px ${color}20` : "none",
        }}
      >
        {entry.text}
      </span>
    )
  }

  if (entry.extra) {
    entry.extra.forEach((child, childIdx) => {
      children.push(
        renderExtraEntry(child, color, bold, italic, underline, strikethrough, `${keyPrefix}-${keyIdx}`, childIdx)
      )
    })
  }

  return <span key={`${keyPrefix}-wrap-${keyIdx}`}>{children}</span>
}

/**
 * Render a raw MOTD (either a JSON chat component or a legacy §-coded string)
 * into styled React nodes.
 */
export function parseMotd(raw: string): ReactNode[] {
  if (!raw) return []

  try {
    const parsed = JSON.parse(raw) as MotdExtraEntry | MotdExtraEntry[] | string

    // Description may be a plain JSON string ({"description":"..."} packs as "\"...\"")
    if (typeof parsed === "string") {
      return parseMotd(parsed)
    }

    if (Array.isArray(parsed)) {
      return [
        <div key="motd-json-array" className="leading-tight text-xs whitespace-pre-wrap break-words">
          {parsed.map((entry, idx) =>
            renderExtraEntry(entry, DEFAULT_COLOR, false, false, false, false, "motd-array", idx)
          )}
        </div>,
      ]
    }

    if (parsed && typeof parsed === "object") {
      if (parsed.text && /\u00A7[0-9a-fk-or]/i.test(parsed.text)) {
        return parseMotd(parsed.text)
      }
      const entries: Array<MotdExtraEntry | string> = []
      if (parsed.text) entries.push({ text: parsed.text, color: parsed.color, bold: parsed.bold, italic: parsed.italic, underlined: parsed.underlined, strikethrough: parsed.strikethrough })
      if (parsed.extra) entries.push(...parsed.extra)

      return [
        <div key="motd-json-object" className="leading-tight text-xs whitespace-pre-wrap break-words">
          {entries.map((entry, idx) =>
            renderExtraEntry(entry, DEFAULT_COLOR, false, false, false, false, "motd-object", idx)
          )}
        </div>,
      ]
    }
  } catch {
    // Not JSON, fall back to legacy parsing
  }

  const lines = raw.split(/\r?\n/)
  return lines.map((line, lineIdx) => {
    const parts = line.split(/\u00A7([0-9a-fk-or])/gi)
    const rendered: ReactNode[] = []
    let color = DEFAULT_COLOR
    let bold = false
    let italic = false
    let underline = false
    let strikethrough = false

    for (let i = 0; i < parts.length; i++) {
      const segment = parts[i]
      if (i % 2 === 1) {
        const code = segment.toLowerCase()
        if (code === "r") {
          color = DEFAULT_COLOR
          bold = false
          italic = false
          underline = false
          strikethrough = false
        } else if (COLOR_MAP[code]) {
          color = COLOR_MAP[code]
          bold = false
          italic = false
          underline = false
          strikethrough = false
        } else {
          const style = FORMATTING_MAP[code]
          if (style) {
            if (style.includes("bold")) bold = true
            if (style.includes("italic")) italic = true
            if (style.includes("underline")) underline = true
            if (style.includes("line-through")) strikethrough = true
          }
        }
      } else if (segment) {
        const styleObj: CSSProperties = {
          color,
          fontWeight: bold ? "bold" : "normal",
          fontStyle: italic ? "italic" : "normal",
          textShadow: bold ? `0 0 2px ${color}40, 0 0 6px ${color}20` : "none",
        }
        const decoration = [
          underline ? "underline" : "",
          strikethrough ? "line-through" : "",
        ]
          .filter(Boolean)
          .join(" ")
        if (decoration) styleObj.textDecoration = decoration

        rendered.push(
          <span key={`${lineIdx}-${i}`} style={styleObj}>
            {segment}
          </span>
        )
      }
    }

    return (
      <div key={lineIdx} className="leading-tight text-xs whitespace-pre-wrap break-words">
        {rendered}
      </div>
    )
  })
}