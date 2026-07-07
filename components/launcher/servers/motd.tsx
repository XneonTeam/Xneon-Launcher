import { type CSSProperties, type ReactNode } from "react"
import type { MotdExtraEntry } from "./types"

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
          ].filter(Boolean).join(" ") || "none",
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

export function parseMotd(raw: string): ReactNode[] {
  if (!raw) return []

  try {
    const parsed = JSON.parse(raw) as MotdExtraEntry | MotdExtraEntry[]

    if (Array.isArray(parsed)) {
      return [
        <div key="motd-json-array" className="leading-tight text-xs whitespace-pre-wrap break-words">
          {parsed.map((entry, idx) =>
            renderExtraEntry(entry, "#AAAAAA", false, false, false, false, "motd-array", idx)
          )}
        </div>,
      ]
    }

    if (parsed && typeof parsed === "object") {
      if (parsed.text && /§[0-9a-fk-or]/i.test(parsed.text)) {
        return parseMotd(parsed.text)
      }

      const entries: Array<MotdExtraEntry | string> = []
      if (parsed.text) {
        entries.push({
          text: parsed.text,
          color: parsed.color,
          bold: parsed.bold,
          italic: parsed.italic,
          underlined: parsed.underlined,
          strikethrough: parsed.strikethrough,
        })
      }
      if (parsed.extra) {
        entries.push(...parsed.extra)
      }

      return [
        <div key="motd-json-object" className="leading-tight text-xs whitespace-pre-wrap break-words">
          {entries.map((entry, idx) =>
            renderExtraEntry(entry, "#AAAAAA", false, false, false, false, "motd-object", idx)
          )}
        </div>,
      ]
    }
  } catch {
    // fall back to legacy section-code parsing
  }

  const lines = raw.split(/\r?\n/)
  return lines.map((line, lineIdx) => {
    const parts = line.split(/§([0-9a-fk-or])/gi)
    const rendered: ReactNode[] = []
    let color = "#AAAAAA"
    let bold = false
    let italic = false
    let underline = false
    let strikethrough = false

    for (let index = 0; index < parts.length; index += 1) {
      const segment = parts[index]
      if (index % 2 === 1) {
        const code = segment.toLowerCase()
        if (code === "r") {
          color = "#AAAAAA"
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
        const decoration = [underline ? "underline" : "", strikethrough ? "line-through" : ""]
          .filter(Boolean)
          .join(" ")
        if (decoration) {
          styleObj.textDecoration = decoration
        }

        rendered.push(
          <span key={`${lineIdx}-${index}`} style={styleObj}>
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
