const ESC = "\x1b"
const SGR_RE = /\x1b\[([0-9;]*)m/g
const STRIP_RE = /\x1b\[[0-9;]*[A-HJKSTfn]/g
const OSC_RE = /\x1b\]8;[^\x07]*\x07/g
const CLEAN_RE = /\x1b[^\[]/g

interface AnsiSpan {
  text: string
  color?: string
  bg?: string
  bold?: boolean
  italic?: boolean
  underline?: boolean
  dim?: boolean
  strikethrough?: boolean
}

const FG_NORMAL = [30, 31, 32, 33, 34, 35, 36, 37]
const FG_BRIGHT = [90, 91, 92, 93, 94, 95, 96, 97]
const BG_NORMAL = [40, 41, 42, 43, 44, 45, 46, 47]
const BG_BRIGHT = [100, 101, 102, 103, 104, 105, 106, 107]

const FG_8 = [
  "#000000", "#cc0000", "#00cc00", "#cccc00",
  "#0000cc", "#cc00cc", "#00cccc", "#cccccc",
]

const FG_8_BRIGHT = [
  "#555555", "#ff5555", "#55ff55", "#ffff55",
  "#5555ff", "#ff55ff", "#55ffff", "#ffffff",
]

const BG_8 = [
  "#000000", "#cc0000", "#00cc00", "#cccc00",
  "#0000cc", "#cc00cc", "#00cccc", "#cccccc",
]

const BG_8_BRIGHT = [
  "#555555", "#ff5555", "#55ff55", "#ffff55",
  "#5555ff", "#ff55ff", "#55ffff", "#ffffff",
]

function ansi256Color(n: number): string {
  if (n < 8) return FG_8[n]
  if (n < 16) return FG_8_BRIGHT[n - 8]
  if (n < 232) {
    const idx = n - 16
    const r = Math.floor(idx / 36)
    const g = Math.floor((idx % 36) / 6)
    const b = idx % 6
    const conv = (v: number) => (v === 0 ? 0 : 55 + v * 40)
    return `#${conv(r).toString(16).padStart(2, "0")}${conv(g).toString(16).padStart(2, "0")}${conv(b).toString(16).padStart(2, "0")}`
  }
  const gray = 8 + (n - 232) * 10
  const hex = gray.toString(16).padStart(2, "0")
  return `#${hex}${hex}${hex}`
}

function ansi256Bg(n: number): string {
  if (n < 8) return BG_8[n]
  if (n < 16) return BG_8_BRIGHT[n - 8]
  if (n < 232) {
    const idx = n - 16
    const r = Math.floor(idx / 36)
    const g = Math.floor((idx % 36) / 6)
    const b = idx % 6
    const conv = (v: number) => (v === 0 ? 0 : 55 + v * 40)
    return `#${conv(r).toString(16).padStart(2, "0")}${conv(g).toString(16).padStart(2, "0")}${conv(b).toString(16).padStart(2, "0")}`
  }
  const gray = 8 + (n - 232) * 10
  const hex = gray.toString(16).padStart(2, "0")
  return `#${hex}${hex}${hex}`
}

function hasAnsi(text: string): boolean {
  return ESC_RE.test(text)
}

const ESC_RE = /\x1b\[/

export function parseAnsi(text: string): AnsiSpan[] {
  const spans: AnsiSpan[] = []
  let fg: string | undefined
  let bg: string | undefined
  let bold = false
  let dim = false
  let italic = false
  let underline = false
  let strikethrough = false

  let last = 0

  SGR_RE.lastIndex = 0
  let match: RegExpExecArray | null

  while ((match = SGR_RE.exec(text)) !== null) {
    if (match.index > last) {
      spans.push({ text: text.slice(last, match.index), color: fg, bg, bold, dim, italic, underline, strikethrough })
    }

    const codes = match[1].split(";").map(Number)
    let i = 0
    while (i < codes.length) {
      const c = codes[i]
      if (c === 0 || isNaN(c)) {
        fg = undefined; bg = undefined
        bold = false; dim = false; italic = false; underline = false; strikethrough = false
      } else if (c === 1) { bold = true }
      else if (c === 2) { dim = true }
      else if (c === 3) { italic = true }
      else if (c === 4) { underline = true }
      else if (c === 9) { strikethrough = true }
      else if (c === 22) { bold = false; dim = false }
      else if (c === 23) { italic = false }
      else if (c === 24) { underline = false }
      else if (c === 29) { strikethrough = false }
      else if (c === 39) { fg = undefined }
      else if (c === 49) { bg = undefined }
      else if (FG_NORMAL.includes(c)) { fg = FG_8[c - 30] }
      else if (FG_BRIGHT.includes(c)) { fg = FG_8_BRIGHT[c - 90] }
      else if (BG_NORMAL.includes(c)) { bg = BG_8[c - 40] }
      else if (BG_BRIGHT.includes(c)) { bg = BG_8_BRIGHT[c - 100] }
      else if (c === 38 && codes[i + 1] === 5 && codes[i + 2] !== undefined) { fg = ansi256Color(codes[i + 2]); i += 2 }
      else if (c === 48 && codes[i + 1] === 5 && codes[i + 2] !== undefined) { bg = ansi256Bg(codes[i + 2]); i += 2 }
      else if (c === 38 && codes[i + 1] === 2 && codes[i + 4] !== undefined) {
        fg = `#${(codes[i + 2] ?? 0).toString(16).padStart(2, "0")}${(codes[i + 3] ?? 0).toString(16).padStart(2, "0")}${(codes[i + 4] ?? 0).toString(16).padStart(2, "0")}`
        i += 4
      }
      else if (c === 48 && codes[i + 1] === 2 && codes[i + 4] !== undefined) {
        bg = `#${(codes[i + 2] ?? 0).toString(16).padStart(2, "0")}${(codes[i + 3] ?? 0).toString(16).padStart(2, "0")}${(codes[i + 4] ?? 0).toString(16).padStart(2, "0")}`
        i += 4
      }
      i++
    }
    last = match.index + match[0].length
  }

  if (last < text.length) {
    spans.push({ text: text.slice(last), color: fg, bg, bold, dim, italic, underline, strikethrough })
  }

  if (spans.length === 0 && text) {
    spans.push({ text })
  }

  return spans
}

export function stripAnsi(text: string): string {
  return text
    .replace(OSC_RE, "")
    .replace(STRIP_RE, "")
    .replace(CLEAN_RE, "")
}

export function hasAnsiCodes(text: string): boolean {
  SGR_RE.lastIndex = 0
  return SGR_RE.test(text)
}
